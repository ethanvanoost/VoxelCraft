/**
 * First-person player controller.
 *
 * Handles pointer-lock mouse look, WASD movement (walk / sprint / crouch /
 * fly), voxel AABB collision resolved per axis, jumping, gravity, swimming,
 * fall damage, head bobbing, and the health/hunger stats.
 */

import * as THREE from 'three';
import { CONFIG } from '../core/config.js';

export class Player {
  constructor(camera, world, audio) {
    this.camera = camera;
    this.world = world;
    this.audio = audio;

    this.position = new THREE.Vector3(0.5, 80, 0.5); // feet position
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;

    this.onGround = false;
    this.flying = false;
    this.crouching = false;
    this.sprinting = false;
    this.inWater = false;
    this.headInWater = false;

    this.health = 20;   // half-hearts ×2 (Minecraft style: 20 = 10 hearts)
    this.hunger = 20;
    this.dead = false;

    this.fallStartY = null;
    this.bobPhase = 0;
    this.stepTimer = 0;
    this.hungerTimer = 0;

    this.sensitivity = 1.0;
    this.keys = {};
    this.enabled = false;   // pointer is locked & game running
    /** 0 = first person, 1 = third person (behind), 2 = second person (front) */
    this.cameraMode = 0;

    this._bindInput();
  }

  _bindInput() {
    document.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      this.keys[e.code] = true;
      if (e.code === 'KeyF') this.toggleFly();
      if (e.code === 'F5') {   // camera toggle instead of page refresh
        e.preventDefault();
        this.cameraMode = (this.cameraMode + 1) % 3;
      }
    });
    document.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    document.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      const s = 0.0022 * this.sensitivity;
      this.yaw -= e.movementX * s;
      this.pitch -= e.movementY * s;
      this.pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, this.pitch));
    });
    // Clear held keys when focus is lost (alt-tab, menu open)
    window.addEventListener('blur', () => { this.keys = {}; });
  }

  toggleFly() {
    this.flying = !this.flying;
    if (this.flying) this.velocity.y = 0;
    this.fallStartY = null;
  }

  _tryJump() {
    if (this.flying) return;
    if (this.inWater) return;              // swimming handled in update
    if (this.onGround) {
      this.velocity.y = CONFIG.JUMP_VELOCITY;
      this.onGround = false;
      this.audio?.play('jump');
    }
  }

  /** AABB half-extents (crouching lowers the head). */
  get height() { return this.crouching ? CONFIG.PLAYER_HEIGHT - 0.3 : CONFIG.PLAYER_HEIGHT; }
  get eyeHeight() { return this.crouching ? CONFIG.PLAYER_EYE - 0.3 : CONFIG.PLAYER_EYE; }

  /** True if the player's box intersects any solid block at position p. */
  collides(p) {
    const hw = CONFIG.PLAYER_WIDTH / 2;
    const minX = Math.floor(p.x - hw), maxX = Math.floor(p.x + hw);
    const minY = Math.floor(p.y),      maxY = Math.floor(p.y + this.height - 0.001);
    const minZ = Math.floor(p.z - hw), maxZ = Math.floor(p.z + hw);
    for (let x = minX; x <= maxX; x++)
      for (let y = minY; y <= maxY; y++)
        for (let z = minZ; z <= maxZ; z++)
          if (this.world.isSolidAt(x, y, z)) return true;
    return false;
  }

  update(dt) {
    if (this.dead) return;
    dt = Math.min(dt, 0.05); // clamp huge frames so physics can't tunnel

    // ---- Water state ----
    this.inWater = this.world.isWaterAt(this.position.x, this.position.y + 0.3, this.position.z);
    this.headInWater = this.world.isWaterAt(this.position.x, this.position.y + this.eyeHeight, this.position.z);

    // ---- Movement input (camera-relative on XZ) ----
    const fwd = (this.keys['KeyW'] ? 1 : 0) - (this.keys['KeyS'] ? 1 : 0);
    const strafe = (this.keys['KeyD'] ? 1 : 0) - (this.keys['KeyA'] ? 1 : 0);
    this.crouching = !this.flying && !!(this.keys['ShiftLeft'] || this.keys['ShiftRight']);
    this.sprinting = !!(this.keys['ControlLeft'] || this.keys['ControlRight']) && fwd > 0
                     && !this.crouching && this.hunger > 6;

    let speed = this.flying ? CONFIG.FLY_SPEED
              : this.crouching ? CONFIG.CROUCH_SPEED
              : this.sprinting ? CONFIG.SPRINT_SPEED
              : CONFIG.WALK_SPEED;
    if (this.inWater && !this.flying) speed *= CONFIG.WATER_DRAG;

    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let mx = (-sin * fwd + cos * strafe);
    let mz = (-cos * fwd - sin * strafe);
    const len = Math.hypot(mx, mz);
    if (len > 0) { mx /= len; mz /= len; }

    // Smooth acceleration (sprint ramps up rather than snapping)
    const accel = this.onGround || this.flying ? 12 : 4;
    this.velocity.x += (mx * speed - this.velocity.x) * Math.min(1, accel * dt);
    this.velocity.z += (mz * speed - this.velocity.z) * Math.min(1, accel * dt);

    // Holding Space keeps jumping every time you touch the ground
    if (this.keys['Space']) this._tryJump();

    // ---- Vertical motion ----
    if (this.flying) {
      const up = (this.keys['Space'] ? 1 : 0) - (this.keys['ShiftLeft'] || this.keys['ShiftRight'] ? 1 : 0);
      this.velocity.y += (up * CONFIG.FLY_SPEED - this.velocity.y) * Math.min(1, 12 * dt);
    } else if (this.inWater) {
      this.velocity.y += CONFIG.GRAVITY * 0.25 * dt;         // reduced gravity
      if (this.keys['Space']) this.velocity.y = Math.min(this.velocity.y + 30 * dt, 3.5); // swim up
      this.velocity.y = Math.max(this.velocity.y, -3);        // sink slowly
      this.fallStartY = null;                                 // water resets fall damage
    } else {
      this.velocity.y += CONFIG.GRAVITY * dt;
      this.velocity.y = Math.max(this.velocity.y, -60);       // terminal velocity
    }

    // ---- Per-axis collision resolution ----
    const pos = this.position;
    const wasOnGround = this.onGround;

    // Auto step-up: walking into a 1-block ledge climbs it automatically
    // (not while flying, sneaking, or swimming — sneaking keeps you safe).
    const tryStepUp = () => {
      if (!wasOnGround || this.flying || this.crouching || this.inWater) return false;
      pos.y += 1.05;
      if (!this.collides(pos)) return true;
      pos.y -= 1.05;
      return false;
    };

    pos.x += this.velocity.x * dt;
    if (this.collides(pos) && !tryStepUp()) { pos.x -= this.velocity.x * dt; this.velocity.x = 0; }

    pos.z += this.velocity.z * dt;
    if (this.collides(pos) && !tryStepUp()) { pos.z -= this.velocity.z * dt; this.velocity.z = 0; }

    pos.y += this.velocity.y * dt;
    this.onGround = false;
    if (this.collides(pos)) {
      const falling = this.velocity.y < 0;
      pos.y -= this.velocity.y * dt;
      if (falling) {
        this.onGround = true;
        // snap down to rest exactly on the block below
        pos.y = Math.round(pos.y * 100) / 100;
        this._applyFallDamage();
      }
      this.velocity.y = 0;
    }

    // Track fall distance
    if (!this.onGround && !this.flying && !this.inWater) {
      if (this.velocity.y < 0 && this.fallStartY === null) this.fallStartY = pos.y;
      if (this.fallStartY !== null) this.fallStartY = Math.max(this.fallStartY, pos.y);
    }

    // Safety: void or glitch below bedrock
    if (pos.y < -10) { pos.y = 100; this.velocity.set(0, 0, 0); this.damage(4); }

    // ---- Landing sound ----
    if (this.onGround && !wasOnGround && this.audio) this.audio.play('land');

    // ---- Footsteps ----
    const moving = len > 0 && this.onGround && !this.flying;
    if (moving) {
      this.stepTimer -= dt * (this.sprinting ? 1.6 : this.crouching ? 0.6 : 1);
      if (this.stepTimer <= 0) {
        this.stepTimer = 0.42;
        const below = this.world.getBlock(Math.floor(pos.x), Math.floor(pos.y - 0.5), Math.floor(pos.z));
        this.audio?.step(below);
      }
    }

    // ---- Head bob ----
    if (moving) {
      this.bobPhase += dt * (this.sprinting ? 11 : 8);
    } else {
      this.bobPhase *= Math.max(0, 1 - dt * 8); // settle
    }
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.06;
    const bobX = Math.sin(this.bobPhase) * 0.03;

    // ---- Hunger / regen (creative mode has no survival stats drain) ----
    this.hungerTimer += dt;
    if (!this.creative) {
      const drain = this.sprinting ? 0.045 : 0.008;
      this.hunger = Math.max(0, this.hunger - drain * dt * 10);
      if (this.hungerTimer > 4) {
        this.hungerTimer = 0;
        if (this.hunger >= 18 && this.health < 20) this.health = Math.min(20, this.health + 1);
        if (this.hunger <= 0) this.damage(1);   // starving
      }
    } else if (this.hungerTimer > 4) {
      this.hungerTimer = 0;
    }

    // ---- Drowning (12 s of air, then 1 heart per second) ----
    this.maxAir = 12;
    if (this.headInWater && !this.flying && !this.creative) {
      this.airTimer = (this.airTimer || 0) + dt;
      if (this.airTimer > this.maxAir) {
        this._drownTick = (this._drownTick || 0) + dt;
        if (this._drownTick >= 1) { this._drownTick = 0; this.damage(2); }
      }
    } else {
      this.airTimer = 0;
      this._drownTick = 0;
    }

    // ---- Camera ----
    // Vertical smoothing hides the pop from auto step-up (snaps on teleports)
    if (this._smoothY === undefined || Math.abs(pos.y - this._smoothY) > 3) this._smoothY = pos.y;
    this._smoothY += (pos.y - this._smoothY) * Math.min(1, dt * 14);
    const eyeX = pos.x + bobX * Math.cos(this.yaw);
    const eyeY = this._smoothY + this.eyeHeight + bobY;
    const eyeZ = pos.z + bobX * Math.sin(this.yaw);
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw);
    this.camera.rotateX(this.pitch);

    if (this.cameraMode === 0) {
      this.camera.position.set(eyeX, eyeY, eyeZ);
    } else {
      // 3rd person = behind the head, 2nd person = in front looking back
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      const sign = this.cameraMode === 1 ? -1 : 1;
      // Pull the camera out until it would enter a solid block
      let dist = 4;
      for (let d = 0.5; d <= 4; d += 0.25) {
        const px = eyeX + dir.x * d * sign;
        const py = eyeY + dir.y * d * sign;
        const pz = eyeZ + dir.z * d * sign;
        if (this.world.isSolidAt(px, py, pz)) { dist = Math.max(0.5, d - 0.35); break; }
      }
      this.camera.position.set(
        eyeX + dir.x * dist * sign,
        eyeY + dir.y * dist * sign,
        eyeZ + dir.z * dist * sign
      );
      if (this.cameraMode === 2) this.camera.rotateY(Math.PI); // face the player
    }
  }

  _applyFallDamage() {
    if (this.creative) { this.fallStartY = null; return; }
    if (this.fallStartY === null) return;
    const fell = this.fallStartY - this.position.y;
    this.fallStartY = null;
    if (fell > CONFIG.FALL_DAMAGE_MIN) {
      const dmg = Math.floor(fell - CONFIG.FALL_DAMAGE_MIN);
      if (dmg > 0) this.damage(dmg);
    }
  }

  damage(amount) {
    if (this.dead) return;
    this.health = Math.max(0, this.health - amount);
    this.audio?.play('hurt');
    if (this.health <= 0) this.die();
  }

  die() {
    this.dead = true;
    this.onDeath?.(this.position.clone());   // main.js: scatter inventory as drops
    // Simple respawn after a moment at the surface
    setTimeout(() => {
      const y = this.world.surfaceHeight(0, 0) + 2;
      this.position.set(0.5, y, 0.5);
      this.velocity.set(0, 0, 0);
      this.health = 20;
      this.hunger = 20;
      this.dead = false;
    }, 1200);
  }

  /** Direction the camera looks at (unit vector). */
  getLookDirection() {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    return dir;
  }
}
