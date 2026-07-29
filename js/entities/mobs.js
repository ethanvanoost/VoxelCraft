/**
 * Passive mobs (pigs and cows): wander the surface, take melee hits with
 * knockback (swords/axes hit harder), and drop raw meat on death.
 * Mobs are local to your game — not synced in multiplayer.
 */

import * as THREE from 'three';
import { BLOCK, ITEM } from '../core/blocks.js';

const MOB_TYPES = {
  pig: {
    body: 0xeaa0a8, snout: 0xd98a92, health: 10, scale: 1,
    drop: ITEM.RAW_PORKCHOP,
  },
  cow: {
    body: 0x6b4a33, snout: 0xcfc5bb, health: 12, scale: 1.15,
    drop: ITEM.RAW_BEEF,
  },
};

const MAX_MOBS = 10;
const SPAWN_MIN = 20, SPAWN_MAX = 44;
const DESPAWN_DIST = 70;

class Mob {
  constructor(type, pos) {
    this.type = type;
    const def = MOB_TYPES[type];
    this.def = def;
    this.pos = pos.clone();
    this.vel = new THREE.Vector3();
    this.yaw = Math.random() * Math.PI * 2;
    this.health = def.health;
    this.hurtTimer = 0;
    this.aiTimer = 0;
    this.moving = false;
    this.walkPhase = 0;

    // ---- Box model ----
    const s = def.scale;
    const g = new THREE.Group();
    this.bodyMat = new THREE.MeshLambertMaterial({ color: def.body });
    const snoutMat = new THREE.MeshLambertMaterial({ color: def.snout });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.7 * s, 0.55 * s, 1.1 * s), this.bodyMat);
    body.position.y = 0.65 * s;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5 * s, 0.5 * s, 0.45 * s), this.bodyMat);
    head.position.set(0, 0.85 * s, 0.7 * s);
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.24 * s, 0.16 * s, 0.1 * s), snoutMat);
    snout.position.set(0, 0.78 * s, 0.94 * s);
    this.legs = [];
    for (const [lx, lz] of [[-0.22, 0.35], [0.22, 0.35], [-0.22, -0.35], [0.22, -0.35]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18 * s, 0.4 * s, 0.18 * s), this.bodyMat);
      leg.position.set(lx * s, 0.2 * s, lz * s);
      this.legs.push(leg);
      g.add(leg);
    }
    g.add(body, head, snout);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.group = g;
  }

  /** AABB half-extents for collision & hit detection. */
  get halfW() { return 0.4 * this.def.scale; }
  get height() { return 0.95 * this.def.scale; }

  collides(world, p) {
    const hw = this.halfW;
    for (const dx of [-hw, hw]) for (const dz of [-hw, hw]) {
      for (let y = 0.05; y < this.height; y += 0.45) {
        if (world.isSolidAt(p.x + dx, p.y + y, p.z + dz)) return true;
      }
    }
    return false;
  }

  update(dt, world) {
    // ---- Wander AI ----
    this.aiTimer -= dt;
    if (this.aiTimer <= 0) {
      this.aiTimer = 1.5 + Math.random() * 3.5;
      this.moving = Math.random() < 0.6;
      this.yaw += (Math.random() - 0.5) * Math.PI * 1.5;
    }
    this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    this.bodyMat.color.setHex(this.hurtTimer > 0 ? 0xff5050 : this.def.body);

    const speed = this.moving ? 1.3 : 0;
    const kb = this.vel.length() > 2;   // during knockback keep momentum
    if (!kb) {
      this.vel.x = -Math.sin(this.yaw) * speed;
      this.vel.z = -Math.cos(this.yaw) * speed;
    }
    this.vel.y += -26 * dt;
    this.vel.y = Math.max(this.vel.y, -40);

    // ---- Move with per-axis collision + 1-block step-up ----
    const p = this.pos;
    const step = (axis, delta) => {
      p[axis] += delta;
      if (this.collides(world, p)) {
        p.y += 1.02;
        if (!this.collides(world, p)) return;    // stepped up
        p.y -= 1.02;
        p[axis] -= delta;
        if (!kb) this.yaw += Math.PI / 2 + Math.random();  // bounced: turn away
      }
    };
    step('x', this.vel.x * dt);
    step('z', this.vel.z * dt);
    p.y += this.vel.y * dt;
    if (this.collides(world, p)) {
      p.y -= this.vel.y * dt;
      if (this.vel.y < 0) { this.vel.x *= 0.6; this.vel.z *= 0.6; }
      this.vel.y = 0;
    }

    // ---- Animate ----
    this.walkPhase += dt * speed * 5;
    const swing = Math.sin(this.walkPhase) * 0.6 * (speed > 0 ? 1 : 0);
    this.legs[0].rotation.x = swing; this.legs[3].rotation.x = swing;
    this.legs[1].rotation.x = -swing; this.legs[2].rotation.x = -swing;
    this.group.position.copy(p);
    this.group.rotation.y = this.yaw;
  }

  hurt(dmg, knockDir) {
    this.health -= dmg;
    this.hurtTimer = 0.35;
    this.vel.add(knockDir.clone().setY(0).normalize().multiplyScalar(6)).y = 4.5;
    return this.health <= 0;
  }
}

export class MobManager {
  constructor(scene, world, drops, audio) {
    this.scene = scene;
    this.world = world;
    this.drops = drops;
    this.audio = audio;
    this.mobs = [];
    this.spawnTimer = 0;
  }

  update(dt, playerPos) {
    // ---- Spawning on grass around the player ----
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.mobs.length < MAX_MOBS) {
      this.spawnTimer = 2;
      const ang = Math.random() * Math.PI * 2;
      const dist = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
      const x = Math.floor(playerPos.x + Math.cos(ang) * dist);
      const z = Math.floor(playerPos.z + Math.sin(ang) * dist);
      const y = this.world.surfaceHeight(x, z);
      const ground = this.world.getBlock(x, y, z);
      if (ground === BLOCK.GRASS || ground === BLOCK.SNOW_GRASS) {
        const type = Math.random() < 0.5 ? 'pig' : 'cow';
        const mob = new Mob(type, new THREE.Vector3(x + 0.5, y + 1.2, z + 0.5));
        this.scene.add(mob.group);
        this.mobs.push(mob);
      }
    }

    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const mob = this.mobs[i];
      if (mob.pos.distanceTo(playerPos) > DESPAWN_DIST || mob.pos.y < -20) {
        this._remove(i);
        continue;
      }
      mob.update(dt, this.world);
    }
  }

  /**
   * Melee swing: ray-march from origin along dir; first mob AABB hit takes
   * damage + knockback. Returns true if something was hit.
   */
  attack(origin, dir, reach, dmg) {
    for (let t = 0.3; t <= reach; t += 0.25) {
      const px = origin.x + dir.x * t, py = origin.y + dir.y * t, pz = origin.z + dir.z * t;
      for (let i = 0; i < this.mobs.length; i++) {
        const m = this.mobs[i];
        const hw = m.halfW + 0.15;
        if (px > m.pos.x - hw && px < m.pos.x + hw &&
            pz > m.pos.z - hw && pz < m.pos.z + hw &&
            py > m.pos.y - 0.1 && py < m.pos.y + m.height + 0.15) {
          this.audio?.play('hurt');
          if (m.hurt(dmg, dir)) {
            // death: drop 1-2 meat
            const count = 1 + (Math.random() < 0.5 ? 1 : 0);
            this.drops.spawn(m.def.drop, count, m.pos.clone().add(new THREE.Vector3(0, 0.5, 0)));
            this._remove(i);
          }
          return true;
        }
      }
    }
    return false;
  }

  _remove(i) {
    this.scene.remove(this.mobs[i].group);
    this.mobs.splice(i, 1);
  }
}
