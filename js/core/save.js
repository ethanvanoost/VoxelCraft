/**
 * Save system — persists the world to localStorage:
 * seed, all player block edits, player position/state, inventory, and time
 * of day. Auto-saves on an interval and on tab close.
 */

import { CONFIG } from './config.js';

export class SaveSystem {
  constructor(world, player, inventory, sky) {
    this.world = world;
    this.player = player;
    this.inventory = inventory;
    this.sky = sky;
    this.timer = 0;
    this.disabled = false;   // set true when deleting the world (blocks resave on unload)

    window.addEventListener('beforeunload', () => this.save());
  }

  save() {
    if (this.disabled) return false;
    try {
      const data = {
        version: 1,
        seed: this.world.seed,
        edits: this.world.edits,
        time: this.sky.time,
        player: {
          pos: this.player.position.toArray(),
          yaw: this.player.yaw,
          pitch: this.player.pitch,
          health: this.player.health,
          hunger: this.player.hunger,
          flying: this.player.flying,
        },
        inventory: this.inventory.serialize(),
      };
      localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(data));
      return true;
    } catch (err) {
      console.warn('Save failed:', err);
      return false;
    }
  }

  /** Returns saved data or null. Call before constructing the world to get the seed. */
  static peek() {
    try {
      const raw = localStorage.getItem(CONFIG.SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  /** Apply a saved snapshot to live objects (world must share the seed). */
  restore(data) {
    if (!data) return;
    this.world.edits = data.edits || {};
    if (data.time !== undefined) this.sky.time = data.time;
    if (data.player) {
      this.player.position.fromArray(data.player.pos);
      this.player.yaw = data.player.yaw || 0;
      this.player.pitch = data.player.pitch || 0;
      this.player.health = data.player.health ?? 20;
      this.player.hunger = data.player.hunger ?? 20;
      this.player.flying = !!data.player.flying;
    }
    this.inventory.load(data.inventory);
  }

  static clear() { localStorage.removeItem(CONFIG.SAVE_KEY); }

  update(dt) {
    this.timer += dt;
    if (this.timer >= CONFIG.AUTOSAVE_INTERVAL) {
      this.timer = 0;
      this.save();
    }
  }
}
