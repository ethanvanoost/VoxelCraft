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
  sheep: {
    body: 0xe8e8e8, snout: 0xd9b8a6, health: 8, scale: 1.05,
    drop: BLOCK.WOOL,
  },
  zombie: {
    body: 0x3f8f3f, snout: 0x2f6f2f, health: 20, scale: 1,
    humanoid: true, hostile: true, dmg: 3, speed: 1.7,
    drop: null,
  },
  skeleton: {
    body: 0xd6d6d6, snout: 0xb8b8b8, health: 14, scale: 0.95,
    humanoid: true, hostile: true, dmg: 2, speed: 2.1,
    drop: ITEM.STICK,        // bones, basically
  },
};

const PASSIVE = ['pig', 'cow', 'sheep'];
const HOSTILE = ['zombie', 'skeleton'];
const MAX_PASSIVE = 10;
const MAX_HOSTILE = 6;
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
    this.legs = [];

    if (def.humanoid) {
      // Zombie / skeleton: upright, player-like proportions
      const w = type === 'skeleton' ? 0.7 : 1;   // skeletons are bony
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.5 * s, 0.5 * s, 0.5 * s), this.bodyMat);
      head.position.y = 1.55 * s;
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.5 * s * w, 0.7 * s, 0.26 * s * w), this.bodyMat);
      body.position.y = 0.95 * s;
      // arms stretched forward, classic zombie pose
      for (const lx of [-0.36, 0.36]) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16 * s, 0.16 * s, 0.7 * s), snoutMat);
        arm.position.set(lx * s * w, 1.2 * s, 0.35 * s);
        g.add(arm);
      }
      for (const lx of [-0.12, 0.12]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2 * s * w, 0.75 * s, 0.2 * s * w), this.bodyMat);
        leg.position.set(lx * s, 0.375 * s, 0);
        this.legs.push(leg);
        g.add(leg);
      }
      // dummy entries so the 4-leg animation code works unchanged
      this.legs.push(this.legs[0], this.legs[1]);
      g.add(head, body);
    } else {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.7 * s, 0.55 * s, 1.1 * s), this.bodyMat);
      body.position.y = 0.65 * s;
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.5 * s, 0.5 * s, 0.45 * s), this.bodyMat);
      head.position.set(0, 0.85 * s, 0.7 * s);
      const snout = new THREE.Mesh(new THREE.BoxGeometry(0.24 * s, 0.16 * s, 0.1 * s), snoutMat);
      snout.position.set(0, 0.78 * s, 0.94 * s);
      for (const [lx, lz] of [[-0.22, 0.35], [0.22, 0.35], [-0.22, -0.35], [0.22, -0.35]]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18 * s, 0.4 * s, 0.18 * s), this.bodyMat);
        leg.position.set(lx * s, 0.2 * s, lz * s);
        this.legs.push(leg);
        g.add(leg);
      }
      g.add(body, head, snout);
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.group = g;
    this.attackCooldown = 0;
  }

  /** AABB half-extents for collision & hit detection. */
  get halfW() { return (this.def.humanoid ? 0.32 : 0.4) * this.def.scale; }
  get height() { return (this.def.humanoid ? 1.85 : 0.95) * this.def.scale; }

  collides(world, p) {
    const hw = this.halfW;
    for (const dx of [-hw, hw]) for (const dz of [-hw, hw]) {
      for (let y = 0.05; y < this.height; y += 0.45) {
        if (world.isSolidAt(p.x + dx, p.y + y, p.z + dz)) return true;
      }
    }
    return false;
  }

  update(dt, world, playerPos) {
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);

    // ---- AI: hostiles chase the player, everyone else wanders ----
    const distToPlayer = playerPos ? this.pos.distanceTo(playerPos) : Infinity;
    let chasing = false;
    if (this.def.hostile && distToPlayer < 18) {
      chasing = true;
      this.yaw = Math.atan2(playerPos.x - this.pos.x, playerPos.z - this.pos.z);
      this.moving = distToPlayer > 1.0;
    } else {
      this.aiTimer -= dt;
      if (this.aiTimer <= 0) {
        this.aiTimer = 1.5 + Math.random() * 3.5;
        this.moving = Math.random() < 0.6;
        this.yaw += (Math.random() - 0.5) * Math.PI * 1.5;
      }
    }
    this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    this.bodyMat.color.setHex(this.hurtTimer > 0 ? 0xff5050 : this.def.body);

    const speed = this.moving ? (chasing ? this.def.speed : 1.3) : 0;
    const kb = this.vel.length() > 2;   // during knockback keep momentum
    if (!kb) {
      // model's snout faces +z, so forward = +(sin yaw, cos yaw)
      this.vel.x = Math.sin(this.yaw) * speed;
      this.vel.z = Math.cos(this.yaw) * speed;
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
    // gentle shove, not a launch
    this.vel.add(knockDir.clone().setY(0).normalize().multiplyScalar(2.2)).y = 2.8;
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

  /**
   * @param player Player instance (position + damage)
   * @param daylight 0 (midnight) .. 1 (noon) from the sky
   */
  update(dt, player, daylight = 1) {
    const playerPos = player.position;
    const night = daylight < 0.2;

    // ---- Spawning ----
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 2;
      const ang = Math.random() * Math.PI * 2;
      const dist = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
      const x = Math.floor(playerPos.x + Math.cos(ang) * dist);
      const z = Math.floor(playerPos.z + Math.sin(ang) * dist);
      const surface = this.world.surfaceHeight(x, z);
      const passiveCount = this.mobs.filter((m) => !m.def.hostile).length;
      const hostileCount = this.mobs.length - passiveCount;

      // Passive animals: daytime, on grass
      if (passiveCount < MAX_PASSIVE) {
        const ground = this.world.getBlock(x, surface, z);
        if (ground === BLOCK.GRASS || ground === BLOCK.SNOW_GRASS) {
          this._spawn(PASSIVE[Math.floor(Math.random() * PASSIVE.length)],
            x + 0.5, surface + 1.2, z + 0.5);
        }
      }

      // Hostiles: at night on the surface, or any time in caves
      if (hostileCount < MAX_HOSTILE) {
        const type = HOSTILE[Math.floor(Math.random() * HOSTILE.length)];
        if (night && this.world.getBlock(x, surface, z) !== BLOCK.AIR) {
          this._spawn(type, x + 0.5, surface + 1.2, z + 0.5);
        } else {
          // find an air pocket underground (a lit-up loaded cave)
          for (let y = surface - 8; y > 8; y -= 2) {
            if (this.world.getBlock(x, y, z) === BLOCK.AIR &&
                this.world.getBlock(x, y + 1, z) === BLOCK.AIR &&
                this.world.getBlock(x, y - 1, z) !== BLOCK.AIR) {
              this._spawn(type, x + 0.5, y + 0.2, z + 0.5);
              break;
            }
          }
        }
      }
    }

    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const mob = this.mobs[i];
      const surface = this.world.surfaceHeight(Math.floor(mob.pos.x), Math.floor(mob.pos.z));
      // Hostiles on the surface disappear at daybreak (no burning animation yet)
      const daybreakGone = mob.def.hostile && daylight > 0.25 && mob.pos.y > surface - 3;
      if (mob.pos.distanceTo(playerPos) > DESPAWN_DIST || mob.pos.y < -20 || daybreakGone) {
        this._remove(i);
        continue;
      }
      mob.update(dt, this.world, playerPos);

      // Hostile contact damage (with knockback on the player)
      if (mob.def.hostile && !player.creative && !player.dead &&
          mob.attackCooldown <= 0 &&
          mob.pos.distanceTo(playerPos) < 1.4) {
        mob.attackCooldown = 1.0;
        player.damage(mob.def.dmg);
        const push = playerPos.clone().sub(mob.pos).setY(0).normalize().multiplyScalar(4);
        player.velocity.x += push.x;
        player.velocity.z += push.z;
        player.velocity.y = Math.max(player.velocity.y, 3);
      }
    }
  }

  _spawn(type, x, y, z) {
    const mob = new Mob(type, new THREE.Vector3(x, y, z));
    this.scene.add(mob.group);
    this.mobs.push(mob);
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
            if (m.def.drop) {   // death: drop 1-2 of the mob's loot
              const count = 1 + (Math.random() < 0.5 ? 1 : 0);
              this.drops.spawn(m.def.drop, count, m.pos.clone().add(new THREE.Vector3(0, 0.5, 0)));
            }
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
