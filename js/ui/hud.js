/**
 * HUD: FPS counter, coordinates, F3 debug screen, health & hunger bars.
 */

import { CONFIG } from '../core/config.js';
import { blockDef } from '../core/blocks.js';

export class HUD {
  constructor(player, world, interaction) {
    this.player = player;
    this.world = world;
    this.interaction = interaction;

    this.els = {
      fps: document.getElementById('fps'),
      coords: document.getElementById('coords'),
      debug: document.getElementById('debug'),
      debugText: document.getElementById('debug-text'),
      health: document.getElementById('health-bar'),
      hunger: document.getElementById('hunger-bar'),
    };

    this.debugVisible = false;
    this.frames = 0;
    this.fps = 0;
    this.fpsTimer = 0;

    this._buildBars();
    document.addEventListener('keydown', (e) => {
      if (e.code === 'F3') { e.preventDefault(); this.toggleDebug(); }
    });
  }

  _buildBars() {
    for (let i = 0; i < 10; i++) {
      const h = document.createElement('div');
      h.className = 'heart'; h.textContent = '❤';
      this.els.health.appendChild(h);
      const d = document.createElement('div');
      d.className = 'drumstick'; d.textContent = '🍗';
      this.els.hunger.appendChild(d);
    }
    // Air bubbles: appear above the hunger bar while underwater
    this.els.air = document.createElement('div');
    this.els.air.id = 'air-bar';
    this.els.air.className = 'bar-row';
    for (let i = 0; i < 10; i++) {
      const b = document.createElement('div');
      b.className = 'bubble'; b.textContent = '●';
      this.els.air.appendChild(b);
    }
    document.getElementById('status-bars').appendChild(this.els.air);
  }

  toggleDebug() {
    this.debugVisible = !this.debugVisible;
    this.els.debug.classList.toggle('hidden', !this.debugVisible);
    // simple info hides while the full debug screen is up
    document.getElementById('info').style.display = this.debugVisible ? 'none' : 'block';
  }

  update(dt, timeOfDay) {
    // ---- FPS ----
    this.frames++;
    this.fpsTimer += dt;
    if (this.fpsTimer >= 0.5) {
      this.fps = Math.round(this.frames / this.fpsTimer);
      this.frames = 0;
      this.fpsTimer = 0;
    }

    const p = this.player.position;
    const cx = Math.floor(p.x / CONFIG.CHUNK_SIZE), cz = Math.floor(p.z / CONFIG.CHUNK_SIZE);

    if (this.debugVisible) {
      const t = this.interaction.target;
      const biome = this.world.gen.getBiome(Math.floor(p.x), Math.floor(p.z));
      const hours = (timeOfDay * 24 + 6) % 24; // timeOfDay 0 = 6:00
      this.els.debugText.textContent =
        `VoxelCraft (F3 debug)\n` +
        `FPS: ${this.fps}\n` +
        `XYZ: ${p.x.toFixed(2)} / ${p.y.toFixed(2)} / ${p.z.toFixed(2)}\n` +
        `Block: ${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)}\n` +
        `Chunk: ${cx} ${cz}\n` +
        `Biome: ${biome}\n` +
        `Time: ${Math.floor(hours)}:${String(Math.floor((hours % 1) * 60)).padStart(2, '0')}\n` +
        `Chunks loaded: ${this.world.loadedChunkCount}\n` +
        `Seed: ${this.world.seed}\n` +
        `Mode: ${this.player.flying ? 'Flying' : this.player.inWater ? 'Swimming' : 'Walking'}\n` +
        `Looking at: ${t ? `${t.pos.x} ${t.pos.y} ${t.pos.z} (${blockDef(t.id).name})` : '—'}`;
    } else {
      this.els.fps.textContent = `FPS: ${this.fps}`;
      this.els.coords.textContent =
        `XYZ: ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}  |  Chunk: ${cx},${cz}`;
    }

    // ---- Air bubbles (only while holding breath) ----
    const underwater = this.player.headInWater || (this.player.airTimer || 0) > 0;
    this.els.air.style.display = underwater && !this.player.creative ? 'flex' : 'none';
    if (underwater) {
      const frac = Math.max(0, 1 - (this.player.airTimer || 0) / (this.player.maxAir || 12));
      const bubbles = Math.ceil(frac * 10);
      [...this.els.air.children].forEach((el, i) => {
        el.className = 'bubble' + (i < bubbles ? '' : ' empty');
      });
    }

    // ---- Health / hunger ----
    const hearts = this.els.health.children;
    const food = this.els.hunger.children;
    for (let i = 0; i < 10; i++) {
      const hp = this.player.health - i * 2;
      hearts[i].className = 'heart' + (hp <= 0 ? ' empty' : hp === 1 ? ' half' : '');
      const fd = this.player.hunger - i * 2;
      food[i].className = 'drumstick' + (fd <= 0 ? ' empty' : '');
    }
  }
}
