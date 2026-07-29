/**
 * Save system — persists the world to localStorage:
 * seed, all player block edits, player position/state, inventory, and time
 * of day. Auto-saves on an interval and on tab close.
 */

import { CONFIG } from './config.js';

export class SaveSystem {
  /**
   * @param storageKey localStorage key for this world (vc_world_<id>), or a
   *        per-server inventory key in multiplayer (see `mpMode`).
   * @param mpMode multiplayer: only the player inventory persists locally —
   *        blocks/chests live in Firebase.
   */
  constructor(world, player, inventory, sky, storageKey, mpMode = false) {
    this.world = world;
    this.player = player;
    this.inventory = inventory;
    this.sky = sky;
    this.key = storageKey || CONFIG.SAVE_KEY;
    this.mpMode = mpMode;
    this.timer = 0;
    this.disabled = false;   // set true when deleting the world (blocks resave on unload)

    this._unload = () => this.save();
    window.addEventListener('beforeunload', this._unload);
  }

  detach() { window.removeEventListener('beforeunload', this._unload); }

  save() {
    if (this.disabled) return false;
    try {
      const data = {
        version: 2,
        seed: this.world.seed,
        edits: this.mpMode ? {} : this.world.edits,
        chests: this.mpMode ? {} : this.world.chests,
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
      localStorage.setItem(this.key, JSON.stringify(data));
      return true;
    } catch (err) {
      console.warn('Save failed:', err);
      return false;
    }
  }

  /** Returns saved data or null for a given storage key. */
  static peek(key = CONFIG.SAVE_KEY) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  /** Apply a saved snapshot to live objects (world must share the seed). */
  restore(data) {
    if (!data) return;
    if (!this.mpMode) {
      this.world.edits = data.edits || {};
      this.world.chests = data.chests || {};
    }
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

  static clear(key = CONFIG.SAVE_KEY) { localStorage.removeItem(key); }

  update(dt) {
    this.timer += dt;
    if (this.timer >= CONFIG.AUTOSAVE_INTERVAL) {
      this.timer = 0;
      this.save();
    }
  }
}
