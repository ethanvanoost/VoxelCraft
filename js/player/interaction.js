/**
 * Block interaction: targeting (voxel DDA raycast), breaking with a timed
 * cracking animation, and placing with correct-face placement and player
 * collision prevention.
 */

import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { BLOCK, blockDef, blockDrop, isSolid, itemDef, isPlaceable, toolClassFor, attackDamage } from '../core/blocks.js';

export class Interaction {
  constructor(world, player, inventory, atlas, scene, audio) {
    this.world = world;
    this.player = player;
    this.inventory = inventory;
    this.atlas = atlas;
    this.scene = scene;
    this.audio = audio;

    this.target = null;         // { pos: {x,y,z}, normal: {x,y,z}, id }
    this.breaking = false;
    this.breakProgress = 0;     // seconds spent mining current block
    this.breakTarget = null;    // key of block currently being mined
    this.buttons = { left: false, right: false };
    this.placeCooldown = 0;
    /** Optional hook: (blockId) => true if the block was "used" (e.g. opens
     *  a crafting table UI). Set by main.js. Crouching bypasses it. */
    this.onUseBlock = null;
    /** Optional hook: (damage) => true if a mob was hit (set by main.js). */
    this.onAttack = null;
    /** Optional hook: (id, count, blockPos) — spawn a ground drop instead of
     *  direct inventory pickup. Set by main.js. */
    this.onBlockDrop = null;

    // ---- Selection wireframe ----
    const boxGeo = new THREE.BoxGeometry(1.002, 1.002, 1.002);
    this.selectionBox = new THREE.LineSegments(
      new THREE.EdgesGeometry(boxGeo),
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6 })
    );
    this.selectionBox.visible = false;
    scene.add(this.selectionBox);

    // ---- Crack overlay (textured cube, swapped through crack stages) ----
    this.crackMats = [];
    for (let s = 0; s < atlas.CRACK_STAGES; s++) {
      const [u0, v0, u1, v1] = atlas.crackUV(s);
      const tex = atlas.texture.clone();
      tex.needsUpdate = true;
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -1,
      });
      this.crackMats.push({ mat, uv: [u0, v0, u1, v1] });
    }
    const crackGeo = new THREE.BoxGeometry(1.001, 1.001, 1.001);
    // Remap the cube's UVs to the crack tile region for each stage lazily
    this.crackMesh = new THREE.Mesh(crackGeo, this.crackMats[0].mat);
    this.crackMesh.visible = false;
    scene.add(this.crackMesh);
    this._crackStage = -1;

    this._bindInput();
  }

  _bindInput() {
    document.addEventListener('mousedown', (e) => {
      if (!this.player.enabled) return;
      if (e.button === 0) {
        // A swing first checks for a mob — hitting one doesn't mine the
        // block behind it
        const dmg = attackDamage(this.inventory.selectedItem()?.id);
        if (this.onAttack?.(dmg)) { this._resetBreaking(); return; }
        this.buttons.left = true;
      }
      if (e.button === 2) { this.buttons.right = true; this.tryPlace(); }
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) { this.buttons.left = false; this._resetBreaking(); }
      if (e.button === 2) this.buttons.right = false;
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /**
   * Voxel raycast (Amanatides & Woo DDA) from the camera.
   * Returns { pos, normal, id } of the first solid block hit, or null.
   */
  raycast() {
    const origin = this.player.camera.position;
    const dir = this.player.getLookDirection();

    let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
    const stepX = Math.sign(dir.x), stepY = Math.sign(dir.y), stepZ = Math.sign(dir.z);
    const tDeltaX = stepX !== 0 ? Math.abs(1 / dir.x) : Infinity;
    const tDeltaY = stepY !== 0 ? Math.abs(1 / dir.y) : Infinity;
    const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dir.z) : Infinity;
    let tMaxX = stepX > 0 ? (x + 1 - origin.x) * tDeltaX : stepX < 0 ? (origin.x - x) * tDeltaX : Infinity;
    let tMaxY = stepY > 0 ? (y + 1 - origin.y) * tDeltaY : stepY < 0 ? (origin.y - y) * tDeltaY : Infinity;
    let tMaxZ = stepZ > 0 ? (z + 1 - origin.z) * tDeltaZ : stepZ < 0 ? (origin.z - z) * tDeltaZ : Infinity;

    let normal = { x: 0, y: 0, z: 0 };
    let t = 0;
    while (t <= CONFIG.REACH) {
      const id = this.world.getBlock(x, y, z);
      if (id !== BLOCK.AIR && isSolid(id)) {
        return { pos: { x, y, z }, normal, id };
      }
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        x += stepX; t = tMaxX; tMaxX += tDeltaX;
        normal = { x: -stepX, y: 0, z: 0 };
      } else if (tMaxY < tMaxZ) {
        y += stepY; t = tMaxY; tMaxY += tDeltaY;
        normal = { x: 0, y: -stepY, z: 0 };
      } else {
        z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ;
        normal = { x: 0, y: 0, z: -stepZ };
      }
    }
    return null;
  }

  update(dt) {
    this.placeCooldown -= dt;
    this.target = this.raycast();

    // Selection outline
    if (this.target) {
      const { x, y, z } = this.target.pos;
      this.selectionBox.position.set(x + 0.5, y + 0.5, z + 0.5);
      this.selectionBox.visible = true;
    } else {
      this.selectionBox.visible = false;
      this._resetBreaking();
    }

    // Held right click = repeat placement (like Minecraft)
    if (this.buttons.right && this.placeCooldown <= 0) this.tryPlace();

    // Breaking
    if (this.buttons.left && this.target) {
      const key = `${this.target.pos.x},${this.target.pos.y},${this.target.pos.z}`;
      if (this.breakTarget !== key) {
        this.breakTarget = key;
        this.breakProgress = 0;
      }
      const def = blockDef(this.target.id);

      // Creative mode: instant break, anything goes
      if (this.player.creative) {
        this.breakBlock(this.target.pos, this.target.id);
        this._resetBreaking();
        this.buttons.left = false;   // one block per click
        return;
      }
      if (def.hardness === Infinity) { this._updateCrack(-1); return; }

      // Matching tool in hand mines faster (e.g. pickaxe on stone)
      const held = this.inventory.selectedItem();
      const tool = held ? itemDef(held.id).tool : null;
      const mult = tool && tool.type === toolClassFor(this.target.id) ? tool.speed : 1;

      this.breakProgress += dt * mult;
      const frac = def.hardness <= 0 ? 1 : this.breakProgress / def.hardness;

      // mining tick sound
      this._digTimer = (this._digTimer || 0) - dt;
      if (this._digTimer <= 0) { this._digTimer = 0.25; this.audio?.dig(this.target.id); }

      if (frac >= 1) {
        this.breakBlock(this.target.pos, this.target.id);
        this._resetBreaking();
      } else {
        this._updateCrack(Math.floor(frac * this.atlas.CRACK_STAGES));
      }
    } else {
      this._resetBreaking();
    }
  }

  _updateCrack(stage) {
    if (stage < 0 || !this.target) { this.crackMesh.visible = false; this._crackStage = -1; return; }
    const { x, y, z } = this.target.pos;
    this.crackMesh.position.set(x + 0.5, y + 0.5, z + 0.5);
    this.crackMesh.visible = true;
    if (stage !== this._crackStage) {
      this._crackStage = stage;
      const { mat, uv } = this.crackMats[Math.min(stage, this.crackMats.length - 1)];
      const [u0, v0, u1, v1] = uv;
      // Restrict the cube's default 0..1 UVs to the crack tile in the atlas
      mat.map.offset.set(u0, v0);
      mat.map.repeat.set(u1 - u0, v1 - v0);
      mat.map.needsUpdate = true;
      this.crackMesh.material = mat;
    }
  }

  _resetBreaking() {
    this.breakProgress = 0;
    this.breakTarget = null;
    this.crackMesh.visible = false;
    this._crackStage = -1;
  }

  breakBlock(pos, id) {
    this.world.setBlock(pos.x, pos.y, pos.z, BLOCK.AIR);

    const give = (itemId, count) => {
      if (this.onBlockDrop) this.onBlockDrop(itemId, count, pos);
      else this.inventory.add(itemId, count);
    };

    // Breaking a chest/furnace spills its contents
    if (id === BLOCK.CHEST) {
      const key = `${pos.x},${pos.y},${pos.z}`;
      for (const s of this.world.removeChest(key)) give(s.id, s.count);
      this.onChestBroken?.(key);
    }
    if (id === BLOCK.FURNACE) {
      const key = `${pos.x},${pos.y},${pos.z}`;
      for (const s of this.world.removeFurnace(key)) give(s.id, s.count);
    }

    // Creative mode breaks silently into nothing (like Minecraft)
    if (!this.player.creative) give(blockDrop(id), 1);
    this.audio?.breakBlock(id);
  }

  tryPlace() {
    // Eating works anywhere, even pointing at the sky
    const held = this.inventory.selectedItem();
    if (held && itemDef(held.id).food && this.player.hunger < 19.5) {
      this.player.hunger = Math.min(20, this.player.hunger + itemDef(held.id).food);
      this.inventory.consumeSelected();
      this.audio?.play('eat');
      this.placeCooldown = 0.45;
      return;
    }

    if (!this.target) return;

    // Interactive blocks (crafting table) open on right click unless crouching
    if (this.onUseBlock && !this.player.crouching && this.onUseBlock(this.target.id)) {
      this.buttons.right = false;
      this.placeCooldown = 0.3;
      return;
    }

    const item = this.inventory.selectedItem();
    if (!item || item.count <= 0) return;
    if (!isPlaceable(item.id)) return;   // tools/materials can't be placed

    const { pos, normal } = this.target;
    const px = pos.x + normal.x, py = pos.y + normal.y, pz = pos.z + normal.z;
    if (py < 0 || py >= CONFIG.WORLD_HEIGHT) return;

    // Only place into air/water
    const existing = this.world.getBlock(px, py, pz);
    if (existing !== BLOCK.AIR && existing !== BLOCK.WATER) return;

    // Collision prevention: don't place a solid block inside the player
    if (isSolid(item.id) && this._intersectsPlayer(px, py, pz)) return;

    this.world.setBlock(px, py, pz, item.id);
    this.inventory.consumeSelected();
    this.audio?.place(item.id);
    this.placeCooldown = 0.22;
  }

  _intersectsPlayer(bx, by, bz) {
    const p = this.player.position;
    const hw = CONFIG.PLAYER_WIDTH / 2;
    return (
      bx + 1 > p.x - hw && bx < p.x + hw &&
      bz + 1 > p.z - hw && bz < p.z + hw &&
      by + 1 > p.y && by < p.y + this.player.height
    );
  }
}
