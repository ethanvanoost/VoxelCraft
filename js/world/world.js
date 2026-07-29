/**
 * World: owns all chunks, streams them around the player, tracks player
 * edits (for saving), and rebuilds dirty chunk meshes with a per-frame
 * budget so the frame rate stays smooth.
 */

import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { BLOCK, isSolid, isLiquid } from '../core/blocks.js';
import { Chunk } from './chunk.js';
import { WorldGen } from './worldgen.js';

const { CHUNK_SIZE, WORLD_HEIGHT } = CONFIG;

export class World {
  /**
   * @param scene THREE.Scene to add chunk meshes to
   * @param atlas texture atlas from buildAtlas()
   * @param seed  world seed
   */
  constructor(scene, atlas, seed) {
    this.scene = scene;
    this.atlas = atlas;
    this.seed = seed;
    this.gen = new WorldGen(seed);
    this.chunks = new Map();          // "cx,cz" -> Chunk
    this.edits = {};                  // "x,y,z" -> block id (player modifications)
    this.chests = {};                 // "x,y,z" -> array(27) of {id,count}|null
    this.onEdit = null;               // hook: (x, y, z, id) after a player edit (multiplayer sync)
    this.renderDistance = CONFIG.RENDER_DISTANCE;
    this.genQueue = [];               // chunks waiting for generation+mesh

    // ---- Shared materials (one draw call per chunk per pass) ----
    this.opaqueMat = new THREE.MeshLambertMaterial({
      map: atlas.texture,
      vertexColors: true,
      alphaTest: 0.5,                 // leaves have transparent holes
      side: THREE.FrontSide,
    });
    this.waterMat = new THREE.MeshLambertMaterial({
      map: atlas.texture,
      vertexColors: true,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,         // visible when swimming under the surface
      depthWrite: false,
    });
  }

  key(cx, cz) { return cx + ',' + cz; }

  getChunk(cx, cz) { return this.chunks.get(this.key(cx, cz)); }

  /** Block id at world coords (0 = air; ungenerated chunks report terrain would-be air). */
  getBlock(x, y, z) {
    if (y < 0 || y >= WORLD_HEIGHT) return BLOCK.AIR;
    const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    const chunk = this.getChunk(cx, cz);
    if (!chunk || !chunk.generated) return BLOCK.AIR;
    return chunk.get(x - cx * CHUNK_SIZE, y, z - cz * CHUNK_SIZE);
  }

  /**
   * Set a block at world coords. Records the edit for persistence and marks
   * the chunk (and border-adjacent neighbors) dirty for remeshing.
   * @param record whether to store in the edits log (false when loading saves)
   */
  setBlock(x, y, z, id, record = true) {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    const chunk = this.getChunk(cx, cz);
    if (!chunk) return;
    const lx = x - cx * CHUNK_SIZE, lz = z - cz * CHUNK_SIZE;
    chunk.set(lx, y, lz, id);
    if (record) {
      this.edits[`${x},${y},${z}`] = id;
      this.onEdit?.(x, y, z, id);
    }

    // Neighbor chunks need remeshing if the edit touches their border
    if (lx === 0) this.markDirty(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1) this.markDirty(cx + 1, cz);
    if (lz === 0) this.markDirty(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1) this.markDirty(cx, cz + 1);
  }

  markDirty(cx, cz) {
    const c = this.getChunk(cx, cz);
    if (c) c.dirty = true;
  }

  /** Solid (collidable) test used by physics. */
  isSolidAt(x, y, z) {
    return isSolid(this.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)));
  }

  isWaterAt(x, y, z) {
    return isLiquid(this.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)));
  }

  /** Highest solid block Y in a column (for spawning). */
  surfaceHeight(x, z) {
    return this.gen.column(Math.floor(x), Math.floor(z)).height;
  }

  /**
   * Called every frame: streams chunks around the player and rebuilds a
   * budgeted number of dirty meshes (nearest first).
   */
  update(playerPos) {
    const pcx = Math.floor(playerPos.x / CHUNK_SIZE);
    const pcz = Math.floor(playerPos.z / CHUNK_SIZE);
    const R = this.renderDistance;

    // ---- Load: collect missing chunks in radius, nearest first ----
    if (this.genQueue.length === 0) {
      for (let dz = -R; dz <= R; dz++) {
        for (let dx = -R; dx <= R; dx++) {
          if (dx * dx + dz * dz > R * R + 2) continue;   // circular radius
          const cx = pcx + dx, cz = pcz + dz;
          if (!this.chunks.has(this.key(cx, cz))) {
            const chunk = new Chunk(cx, cz);
            this.chunks.set(this.key(cx, cz), chunk);
            this.genQueue.push(chunk);
          }
        }
      }
      this.genQueue.sort((a, b) =>
        (Math.abs(a.cx - pcx) + Math.abs(a.cz - pcz)) -
        (Math.abs(b.cx - pcx) + Math.abs(b.cz - pcz)));
    }

    // ---- Generate: a few chunks per frame ----
    let budget = CONFIG.CHUNKS_PER_FRAME;
    while (budget > 0 && this.genQueue.length > 0) {
      const chunk = this.genQueue.shift();
      if (!this.chunks.has(this.key(chunk.cx, chunk.cz))) continue; // was unloaded
      this.generateChunk(chunk);
      budget--;
    }

    // ---- Remesh dirty chunks (player edits), nearest first ----
    let meshBudget = CONFIG.CHUNKS_PER_FRAME;
    const dirty = [];
    for (const chunk of this.chunks.values()) {
      if (chunk.generated && chunk.dirty) dirty.push(chunk);
    }
    dirty.sort((a, b) =>
      (Math.abs(a.cx - pcx) + Math.abs(a.cz - pcz)) -
      (Math.abs(b.cx - pcx) + Math.abs(b.cz - pcz)));
    for (const chunk of dirty) {
      if (meshBudget-- <= 0) break;
      this.buildChunkMesh(chunk);
    }

    // ---- Unload far chunks ----
    const unloadR = R + 2;
    for (const [key, chunk] of this.chunks) {
      const dx = chunk.cx - pcx, dz = chunk.cz - pcz;
      if (dx * dx + dz * dz > unloadR * unloadR + 4) {
        this.disposeChunk(chunk);
        this.chunks.delete(key);
      }
    }
  }

  generateChunk(chunk) {
    // Terrain
    this.gen.generateChunk(chunk.cx, chunk.cz, (lx, y, lz, id, soft) => {
      if (soft && chunk.get(lx, y, lz) !== BLOCK.AIR) return;
      chunk.data[Chunk.index(lx, y, lz)] = id;
    });
    // Re-apply saved player edits inside this chunk
    const x0 = chunk.cx * CHUNK_SIZE, z0 = chunk.cz * CHUNK_SIZE;
    for (const key in this.edits) {
      const [x, y, z] = key.split(',').map(Number);
      if (x >= x0 && x < x0 + CHUNK_SIZE && z >= z0 && z < z0 + CHUNK_SIZE) {
        chunk.data[Chunk.index(x - x0, y, z - z0)] = this.edits[key];
      }
    }
    chunk.generated = true;
    chunk.dirty = true;
    // Neighbors may have culled faces against this previously-missing chunk
    this.markDirty(chunk.cx - 1, chunk.cz);
    this.markDirty(chunk.cx + 1, chunk.cz);
    this.markDirty(chunk.cx, chunk.cz - 1);
    this.markDirty(chunk.cx, chunk.cz + 1);
  }

  buildChunkMesh(chunk) {
    this.disposeChunk(chunk, true);

    const getWorldBlock = (x, y, z) => this.getBlock(x, y, z);
    const { opaque, water } = chunk.buildGeometry(getWorldBlock, this.atlas);
    const x0 = chunk.cx * CHUNK_SIZE, z0 = chunk.cz * CHUNK_SIZE;

    chunk.meshes = {};
    if (opaque) {
      const mesh = new THREE.Mesh(opaque, this.opaqueMat);
      mesh.position.set(x0, 0, z0);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.scene.add(mesh);
      chunk.meshes.opaque = mesh;
    }
    if (water) {
      const mesh = new THREE.Mesh(water, this.waterMat);
      mesh.position.set(x0, 0, z0);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.renderOrder = 1;
      this.scene.add(mesh);
      chunk.meshes.water = mesh;
    }
    chunk.dirty = false;
  }

  disposeChunk(chunk, keepData = false) {
    if (chunk.meshes) {
      for (const mesh of Object.values(chunk.meshes)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
      }
      chunk.meshes = null;
    }
    if (!keepData) chunk.generated = false;
  }

  /** Chest contents at a position (created empty on first open). */
  getChest(posKey) {
    if (!this.chests[posKey]) this.chests[posKey] = new Array(27).fill(null);
    return this.chests[posKey];
  }

  removeChest(posKey) {
    const contents = this.chests[posKey] || [];
    delete this.chests[posKey];
    return contents.filter(Boolean);
  }

  /** Number of chunk draw objects currently in the scene (debug). */
  get loadedChunkCount() { return this.chunks.size; }
}
