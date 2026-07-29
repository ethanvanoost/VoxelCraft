/**
 * Chunk: block storage + mesh builder.
 *
 * Storage is a flat Uint8Array (CHUNK_SIZE × WORLD_HEIGHT × CHUNK_SIZE).
 * Meshing emits only faces adjacent to non-opaque blocks (face culling),
 * merges the whole chunk into one BufferGeometry per material pass
 * (opaque / water), and bakes directional shading + ambient occlusion into
 * per-vertex colors — thousands of visible blocks render as a handful of
 * draw calls.
 */

import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { BLOCK, isOpaque, blockDef, faceTile } from '../core/blocks.js';

const { CHUNK_SIZE, WORLD_HEIGHT } = CONFIG;

/**
 * Face table. For each direction: neighbor offset, 4 corner positions
 * (unit cube), normal, which tex key to use, and base light level
 * (simple directional shading like Minecraft).
 */
const FACES = [
  { // +Y top
    dir: [0, 1, 0], tex: 'top', light: 1.0,
    corners: [[0,1,1],[1,1,1],[1,1,0],[0,1,0]],
  },
  { // -Y bottom
    dir: [0, -1, 0], tex: 'bottom', light: 0.5,
    corners: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]],
  },
  { // +X
    dir: [1, 0, 0], tex: 'side', light: 0.8,
    corners: [[1,0,1],[1,0,0],[1,1,0],[1,1,1]],
  },
  { // -X
    dir: [-1, 0, 0], tex: 'side', light: 0.8,
    corners: [[0,0,0],[0,0,1],[0,1,1],[0,1,0]],
  },
  { // +Z
    dir: [0, 0, 1], tex: 'side', light: 0.65,
    corners: [[0,0,1],[1,0,1],[1,1,1],[0,1,1]],
  },
  { // -Z
    dir: [0, 0, -1], tex: 'side', light: 0.65,
    corners: [[1,0,0],[0,0,0],[0,1,0],[1,1,0]],
  },
];

export class Chunk {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.data = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT);
    this.dirty = true;        // needs remesh
    this.generated = false;
    this.meshes = null;       // { opaque, water } THREE.Mesh, set by World
  }

  static index(x, y, z) {
    return x + z * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE;
  }

  get(x, y, z) {
    if (y < 0 || y >= WORLD_HEIGHT) return BLOCK.AIR;
    return this.data[Chunk.index(x, y, z)];
  }

  set(x, y, z, id) {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    this.data[Chunk.index(x, y, z)] = id;
    this.dirty = true;
  }

  /**
   * Build geometry for this chunk.
   * @param getWorldBlock (wx, wy, wz) => block id, used for cross-chunk culling.
   * @param atlas texture atlas (uv lookup).
   * @returns {{opaque: BufferGeometry|null, water: BufferGeometry|null}}
   */
  buildGeometry(getWorldBlock, atlas) {
    const opaque = { positions: [], normals: [], uvs: [], colors: [], indices: [] };
    const water  = { positions: [], normals: [], uvs: [], colors: [], indices: [] };
    const wx0 = this.cx * CHUNK_SIZE, wz0 = this.cz * CHUNK_SIZE;

    // Local getter that falls back to the world at chunk borders.
    const get = (x, y, z) => {
      if (y < 0) return BLOCK.BEDROCK;   // treat below-world as solid: culls floor
      if (y >= WORLD_HEIGHT) return BLOCK.AIR;
      if (x >= 0 && x < CHUNK_SIZE && z >= 0 && z < CHUNK_SIZE) {
        return this.data[Chunk.index(x, y, z)];
      }
      return getWorldBlock(wx0 + x, y, wz0 + z);
    };

    // Vertex AO: darkens corners where neighboring blocks crowd in.
    const vertexAO = (side1, side2, corner) => {
      if (side1 && side2) return 0.55;
      return 1 - (side1 + side2 + corner) * 0.15;
    };

    for (let y = 0; y < WORLD_HEIGHT; y++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          const id = this.data[Chunk.index(x, y, z)];
          if (id === BLOCK.AIR) continue;
          const def = blockDef(id);
          const isWater = !!def.liquid;
          const target = isWater ? water : opaque;

          for (const face of FACES) {
            const [dx, dy, dz] = face.dir;
            const nId = get(x + dx, y + dy, z + dz);

            // Face culling rules:
            //  - opaque neighbor hides the face
            //  - water only renders against non-water (surface + shores)
            //  - identical transparent blocks (leaves↔leaves) still render,
            //    water↔water does not
            if (isWater) {
              if (nId === BLOCK.WATER || isOpaque(nId)) continue;
            } else {
              if (isOpaque(nId)) continue;
              if (nId === id && !def.opaque) continue; // e.g. glass-like merging
            }

            const base = target.positions.length / 3;
            const tileName = faceTile(id, face.tex);
            const [u0, v0, u1, v1] = atlas.uv(tileName);
            const faceUVs = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];

            for (let i = 0; i < 4; i++) {
              const c = face.corners[i];
              // Water surface sits slightly below the block top
              const yOff = isWater && c[1] === 1 && get(x, y + 1, z) !== BLOCK.WATER ? -0.12 : 0;
              target.positions.push(x + c[0], y + c[1] + yOff, z + c[2]);
              target.normals.push(dx, dy, dz);
              target.uvs.push(faceUVs[i][0], faceUVs[i][1]);

              // --- Ambient occlusion for this vertex ---
              let ao = 1;
              if (!isWater) {
                // Determine the two side neighbors + corner neighbor in the
                // face plane relative to this corner.
                const cx = c[0] ? 1 : -1, cy = c[1] ? 1 : -1, cz2 = c[2] ? 1 : -1;
                let s1, s2, co;
                if (dy !== 0) {
                  s1 = isOpaque(get(x + cx, y + dy, z)) ? 1 : 0;
                  s2 = isOpaque(get(x, y + dy, z + cz2)) ? 1 : 0;
                  co = isOpaque(get(x + cx, y + dy, z + cz2)) ? 1 : 0;
                } else if (dx !== 0) {
                  s1 = isOpaque(get(x + dx, y + cy, z)) ? 1 : 0;
                  s2 = isOpaque(get(x + dx, y, z + cz2)) ? 1 : 0;
                  co = isOpaque(get(x + dx, y + cy, z + cz2)) ? 1 : 0;
                } else {
                  s1 = isOpaque(get(x + cx, y, z + dz)) ? 1 : 0;
                  s2 = isOpaque(get(x, y + cy, z + dz)) ? 1 : 0;
                  co = isOpaque(get(x + cx, y + cy, z + dz)) ? 1 : 0;
                }
                ao = vertexAO(s1, s2, co);
              }
              const l = face.light * ao;
              target.colors.push(l, l, l);
            }
            target.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
          }
        }
      }
    }

    return {
      opaque: makeGeometry(opaque),
      water: makeGeometry(water),
    };
  }
}

function makeGeometry(buf) {
  if (buf.indices.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(buf.positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(buf.normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(buf.colors, 3));
  geo.setIndex(buf.indices);
  geo.computeBoundingSphere();
  return geo;
}
