/**
 * Ground item drops: mined blocks and thrown/death items become small
 * spinning entities that fall, bob, and are magnetically picked up when the
 * player walks near. (Drops are local — not synced in multiplayer.)
 */

import * as THREE from 'three';
import { faceTile, itemDef, isPlaceable } from '../core/blocks.js';

const GRAVITY = -18;
const PICKUP_DIST = 1.1;
const MAGNET_DIST = 2.2;
const DESPAWN = 300;      // seconds

export class Drops {
  constructor(scene, world, atlas, audio) {
    this.scene = scene;
    this.world = world;
    this.atlas = atlas;
    this.audio = audio;
    this.items = [];
    this._matCache = new Map();
    this._blockGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
  }

  _material(id) {
    if (this._matCache.has(id)) return this._matCache.get(id);
    let entry;
    if (isPlaceable(id)) {
      const tex = new THREE.CanvasTexture(this.atlas.tileCanvas(faceTile(id, 'side')));
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      entry = { block: true, mat: new THREE.MeshLambertMaterial({ map: tex }) };
    } else {
      const tex = new THREE.CanvasTexture(this.atlas.tileCanvas(itemDef(id).icon || 'stone'));
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      entry = { block: false, mat: new THREE.SpriteMaterial({ map: tex, transparent: true }) };
    }
    this._matCache.set(id, entry);
    return entry;
  }

  /**
   * Spawn a drop.
   * @param vel optional initial velocity (thrown items)
   * @param noPickupFor seconds before the player can pick it up
   */
  spawn(id, count, pos, vel = null, noPickupFor = 0.6) {
    const { block, mat } = this._material(id);
    let mesh;
    if (block) {
      mesh = new THREE.Mesh(this._blockGeo, mat);
      mesh.castShadow = true;
    } else {
      mesh = new THREE.Sprite(mat);
      mesh.scale.set(0.45, 0.45, 1);
    }
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.items.push({
      id, count, mesh,
      pos: pos.clone(),
      vel: vel ? vel.clone() : new THREE.Vector3((Math.random() - 0.5) * 2, 3, (Math.random() - 0.5) * 2),
      age: 0,
      noPickupFor,
      spin: Math.random() * Math.PI * 2,
    });
  }

  /** Throw one unit of the selected hotbar item in the look direction. */
  throwFromPlayer(player, inventory) {
    const slot = inventory.selectedItem();
    if (!slot) return;
    const dir = player.getLookDirection();
    const pos = player.camera.position.clone().addScaledVector(dir, 0.4);
    this.spawn(slot.id, 1, pos, dir.clone().multiplyScalar(7).add(new THREE.Vector3(0, 2, 0)), 1.4);
    inventory.consumeSelected();
    this.audio?.play('click');
  }

  /** Scatter an entire inventory at a position (death). */
  scatterAll(inventory, pos) {
    for (let i = 0; i < inventory.slots.length; i++) {
      const s = inventory.slots[i];
      if (!s) continue;
      const vel = new THREE.Vector3((Math.random() - 0.5) * 5, 3 + Math.random() * 3, (Math.random() - 0.5) * 5);
      this.spawn(s.id, s.count, pos.clone().add(new THREE.Vector3(0, 1, 0)), vel, 2);
      inventory.slots[i] = null;
    }
    inventory.renderAll();
  }

  update(dt, player, inventory) {
    const ppos = player.position;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const d = this.items[i];
      d.age += dt;
      if (d.age > DESPAWN) { this._remove(i); continue; }

      // Physics: gravity + simple voxel collision
      d.vel.y += GRAVITY * dt;
      const next = d.pos.clone().addScaledVector(d.vel, dt);
      if (this.world.isSolidAt(next.x, d.pos.y + 0.1, next.z)) { d.vel.x = 0; d.vel.z = 0; }
      else { d.pos.x = next.x; d.pos.z = next.z; }
      if (this.world.isSolidAt(d.pos.x, next.y, d.pos.z)) {
        d.vel.y = 0;
        d.vel.x *= 0.7; d.vel.z *= 0.7;                  // ground friction
        d.pos.y = Math.floor(next.y) + 1.001;
      } else {
        d.pos.y = next.y;
      }
      if (d.pos.y < -20) { this._remove(i); continue; }  // fell out of world

      // Magnet + pickup
      const target = new THREE.Vector3(ppos.x, ppos.y + 0.6, ppos.z);
      const dist = d.pos.distanceTo(target);
      if (d.age > d.noPickupFor && !player.dead) {
        if (dist < PICKUP_DIST) {
          const leftover = inventory.add(d.id, d.count);
          if (leftover > 0) d.count = leftover;          // inventory full: keep the rest
          else { this._remove(i); this.audio?.play('pop'); continue; }
        } else if (dist < MAGNET_DIST) {
          d.pos.addScaledVector(target.clone().sub(d.pos).normalize(), dt * 5);
        }
      }

      // Visuals: spin + bob
      d.spin += dt * 2;
      d.mesh.position.set(d.pos.x, d.pos.y + 0.2 + Math.sin(d.age * 2.5) * 0.06, d.pos.z);
      if (d.mesh.isMesh) d.mesh.rotation.y = d.spin;
    }
  }

  _remove(i) {
    this.scene.remove(this.items[i].mesh);
    this.items.splice(i, 1);
  }
}
