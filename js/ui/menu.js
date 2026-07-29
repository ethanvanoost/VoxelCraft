/**
 * Menu system: username screen → title → singleplayer world list /
 * multiplayer server browser / skin editor / pause.
 *
 * Worlds live in localStorage:
 *   vc_username           your name (per browser)
 *   vc_skin               skin colors
 *   vc_worlds             [{id, name, seed, mode, cheats, created}]
 *   vc_world_<id>         world save data (SaveSystem)
 */

import { DEFAULT_SKIN, drawSkinPreview } from '../player/avatar.js';

const $ = (id) => document.getElementById(id);

export class Menu {
  /**
   * @param net Net instance (Firebase wrapper)
   * @param hooks { startWorld(worldMeta), joinServer(serverInfo), resume(), quit(), settingsChanged() }
   */
  constructor(net, hooks) {
    this.net = net;
    this.hooks = hooks;
    this.username = localStorage.getItem('vc_username') || '';
    this.skin = this._loadSkin();
    this.inGame = false;

    this.selectedWorld = null;
    this.selectedServer = null;
    this._servers = [];

    this._paintBackground();
    this._migrateOldSave();
    this._bind();
    this.show(this.username ? 'main' : 'username');

    // A name picked before Firebase was configured only exists locally —
    // claim it globally in the background on launch.
    if (this.username && this.net.available) {
      this.net.claimUsername(this.username).then((r) => {
        if (r === 'taken') {
          // Someone else owns this name globally — ask for a new one
          localStorage.removeItem('vc_username');
          this.username = '';
          this.show('username');
          const status = $('username-status');
          status.textContent = 'Your old name is taken globally — pick a new one.';
          status.className = 'menu-note err';
        }
      });
    }
  }

  /** Minecraft-style tiled dark dirt background, generated on a canvas. */
  _paintBackground() {
    const c = document.createElement('canvas');
    c.width = 16; c.height = 16;
    const ctx = c.getContext('2d');
    let s = 1234;
    const rand = () => { s = (Math.imul(s, 48271) % 2147483647 + 2147483647) % 2147483647; return s / 2147483647; };
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const v = 28 + Math.floor(rand() * 22);
        ctx.fillStyle = `rgb(${v + 8},${Math.floor(v * 0.72)},${Math.floor(v * 0.5)})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    $('menu').style.backgroundImage = `url(${c.toDataURL()})`;
  }

  // ---------------- storage ----------------

  _loadSkin() {
    try { return { ...DEFAULT_SKIN, ...(JSON.parse(localStorage.getItem('vc_skin')) || {}) }; }
    catch { return { ...DEFAULT_SKIN }; }
  }

  worlds() {
    try { return JSON.parse(localStorage.getItem('vc_worlds')) || []; }
    catch { return []; }
  }

  _saveWorlds(list) { localStorage.setItem('vc_worlds', JSON.stringify(list)); }

  /** Old single-world saves become "My World" in the new system. */
  _migrateOldSave() {
    const old = localStorage.getItem('voxelcraft_world');
    if (!old || this.worlds().length) return;
    try {
      const data = JSON.parse(old);
      const id = 'w' + Date.now();
      const meta = { id, name: 'My World', seed: data.seed, mode: 'survival', cheats: true, created: Date.now() };
      localStorage.setItem('vc_world_' + id, old);
      this._saveWorlds([meta]);
      localStorage.removeItem('voxelcraft_world');
    } catch { /* ignore broken old save */ }
  }

  // ---------------- screens ----------------

  show(name) {
    for (const s of document.querySelectorAll('#menu-window .screen')) s.classList.add('hidden');
    $('menu-settings').classList.add('hidden');
    $('menu').classList.remove('hidden');
    if (name === 'settings') { $('menu-settings').classList.remove('hidden'); return; }
    $('screen-' + name)?.classList.remove('hidden');
    if (name === 'main') $('hello-user').textContent = `Logged in as ${this.username} (this browser)`;
    if (name === 'worlds') this._renderWorlds();
    if (name === 'servers') this._renderServers();
    if (name === 'skin') this._renderSkin();
    this._settingsReturn = name === 'settings' ? this._settingsReturn : name;
  }

  hide() { $('menu').classList.add('hidden'); }

  _bind() {
    // ---- username ----
    $('btn-username-ok').addEventListener('click', () => this._submitUsername());
    $('username-input').addEventListener('keydown', (e) => {
      if (e.code === 'Enter') this._submitUsername();
      e.stopPropagation();
    });

    // ---- title ----
    $('btn-singleplayer').addEventListener('click', () => this.show('worlds'));
    $('btn-multiplayer').addEventListener('click', () => this.show('servers'));
    $('btn-skin').addEventListener('click', () => this.show('skin'));
    $('btn-settings').addEventListener('click', () => this.show('settings'));
    $('btn-back').addEventListener('click', () =>
      this.show(this.inGame ? 'pause' : (this._settingsReturn === 'settings' ? 'main' : this._settingsReturn || 'main')));

    // ---- worlds ----
    $('btn-world-play').addEventListener('click', () => {
      const w = this.worlds().find((x) => x.id === this.selectedWorld);
      if (w) this.hooks.startWorld(w);
    });
    $('btn-world-new').addEventListener('click', () => this.show('world-create'));
    $('btn-world-delete').addEventListener('click', () => {
      const w = this.worlds().find((x) => x.id === this.selectedWorld);
      if (w && confirm(`Delete world "${w.name}" forever?`)) {
        localStorage.removeItem('vc_world_' + w.id);
        this._saveWorlds(this.worlds().filter((x) => x.id !== w.id));
        this.selectedWorld = null;
        this._renderWorlds();
      }
    });
    $('btn-worlds-back').addEventListener('click', () => this.show('main'));
    $('btn-world-create').addEventListener('click', () => this._createWorld());
    $('btn-world-cancel').addEventListener('click', () => this.show('worlds'));

    // ---- servers ----
    $('btn-server-join').addEventListener('click', () => {
      const s = this._servers.find((x) => x.id === this.selectedServer);
      if (s) this.hooks.joinServer(s);
    });
    $('btn-server-refresh').addEventListener('click', () => this._renderServers());
    $('btn-server-new').addEventListener('click', () => this.show('server-create'));
    $('btn-servers-back').addEventListener('click', () => this.show('main'));
    $('btn-server-create').addEventListener('click', () => this._createServer());
    $('btn-server-cancel').addEventListener('click', () => this.show('servers'));

    // ---- skin ----
    for (const part of ['head', 'body', 'arms', 'legs', 'eyes']) {
      $('skin-' + part).addEventListener('input', () => {
        this.skin[part] = $('skin-' + part).value;
        drawSkinPreview($('skin-preview'), this.skin);
      });
    }
    $('btn-skin-save').addEventListener('click', () => {
      localStorage.setItem('vc_skin', JSON.stringify(this.skin));
      this.show('main');
    });
    $('btn-skin-back').addEventListener('click', () => { this.skin = this._loadSkin(); this.show('main'); });

    // ---- pause ----
    $('btn-resume').addEventListener('click', () => this.hooks.resume());
    $('btn-pause-settings').addEventListener('click', () => this.show('settings'));
    $('btn-quit').addEventListener('click', () => this.hooks.quit());
  }

  // ---------------- username ----------------

  async _submitUsername() {
    const input = $('username-input');
    const status = $('username-status');
    const name = input.value.trim().replace(/[^A-Za-z0-9_]/g, '').slice(0, 16);
    if (name.length < 3) {
      status.textContent = 'Name must be 3–16 letters/numbers/underscores.';
      status.className = 'menu-note err';
      return;
    }
    status.textContent = 'Checking availability…';
    status.className = 'menu-note';
    const result = this.net.available ? await this.net.claimUsername(name) : 'offline';
    if (result === 'taken') {
      status.textContent = `"${name}" is already taken — try another.`;
      status.className = 'menu-note err';
      return;
    }
    this.username = name;
    localStorage.setItem('vc_username', name);
    if (result === 'offline' && this.net.available) {
      status.textContent = 'Could not reach Firebase — name saved locally.';
    }
    this.show('main');
  }

  // ---------------- singleplayer ----------------

  _renderWorlds() {
    const list = $('world-list');
    list.innerHTML = '';
    const worlds = this.worlds();
    this._syncWorldButtons();
    if (!worlds.length) {
      list.innerHTML = '<div class="list-empty">No worlds yet.<br>Click "Create New World" to start.</div>';
      return;
    }
    for (const w of worlds) {
      const item = document.createElement('div');
      item.className = 'list-item' + (w.id === this.selectedWorld ? ' selected' : '');
      item.innerHTML = `<div><b>${escapeHtml(w.name)}</b>` +
        `<span class="sub">${w.mode === 'creative' ? 'Creative Mode' : 'Survival Mode'}` +
        `${w.cheats ? ' · Cheats' : ''} · Seed: ${w.seed}</span></div>`;
      // click selects (Minecraft-style); double-click plays
      item.addEventListener('click', () => {
        this.selectedWorld = w.id;
        this._renderWorlds();
      });
      item.addEventListener('dblclick', () => this.hooks.startWorld(w));
      list.appendChild(item);
    }
  }

  _syncWorldButtons() {
    const has = !!this.selectedWorld;
    $('btn-world-play').disabled = !has;
    $('btn-world-delete').disabled = !has;
  }

  _createWorld() {
    const name = $('world-name').value.trim() || 'New World';
    const seedText = $('world-seed').value.trim();
    const seed = seedText ? (Number.isNaN(+seedText) ? hashString(seedText) : Math.abs(+seedText) | 0)
                          : Math.floor(Math.random() * 2 ** 31);
    const meta = {
      id: 'w' + Date.now(),
      name,
      seed,
      mode: $('world-mode').value,
      cheats: $('world-cheats').checked,
      created: Date.now(),
    };
    this._saveWorlds([meta, ...this.worlds()]);
    $('world-name').value = '';
    $('world-seed').value = '';
    this.hooks.startWorld(meta);
  }

  _syncServerButtons() {
    $('btn-server-join').disabled = !this.selectedServer;
  }

  // ---------------- multiplayer ----------------

  async _renderServers() {
    const status = $('server-status');
    const list = $('server-list');
    list.innerHTML = '';
    if (!this.net.available) {
      status.textContent = 'Multiplayer needs Firebase — see firebase-rules.md for the 5-minute setup, then paste your config into js/net/firebase-config.js.';
      status.className = 'menu-note err';
      return;
    }
    status.textContent = 'Loading servers…';
    status.className = 'menu-note';
    const servers = await this.net.listServers();
    if (servers === null) {
      status.textContent = 'Could not reach Firebase. Check your config and internet.';
      status.className = 'menu-note err';
      return;
    }
    this._servers = servers;
    this._syncServerButtons();
    status.textContent = servers.length ? `${servers.length} server(s) found` : '';
    if (!servers.length) {
      list.innerHTML = '<div class="list-empty">No servers yet.<br>Click "Create Server" to host the first one!</div>';
      return;
    }
    for (const s of servers) {
      const item = document.createElement('div');
      item.className = 'list-item' + (s.id === this.selectedServer ? ' selected' : '');
      item.innerHTML = `<div><b>${escapeHtml(s.name)}</b>` +
        `<span class="sub">${s.mode === 'creative' ? 'Creative Mode' : 'Survival Mode'}` +
        `${s.cheats ? ' · Cheats for all' : ''} · by ${escapeHtml(s.creatorName || '?')}</span></div>` +
        `<span class="online-dot">●</span>`;
      item.addEventListener('click', () => {
        this.selectedServer = s.id;
        this._renderServersSelectionOnly();
      });
      item.addEventListener('dblclick', () => this.hooks.joinServer(s));
      list.appendChild(item);
    }
  }

  /** Re-highlight selection without refetching from Firebase. */
  _renderServersSelectionOnly() {
    const list = $('server-list');
    [...list.children].forEach((el, i) => {
      const s = this._servers[i];
      if (s) el.classList.toggle('selected', s.id === this.selectedServer);
    });
    this._syncServerButtons();
  }

  async _createServer() {
    if (!this.net.available) return;
    const status = $('server-create-status');
    const btn = $('btn-server-create');
    const name = $('server-name').value.trim() || `${this.username}'s server`;
    btn.disabled = true;
    status.textContent = 'Creating server…';
    status.className = 'menu-note';
    const id = await this.net.createServer({
      name,
      mode: $('server-mode').value,
      cheats: $('server-cheats').checked,
      username: this.username,
    });
    btn.disabled = false;
    if (!id) {
      status.textContent = 'Failed — are the Firebase rules published? (see firebase-rules.md)';
      status.className = 'menu-note err';
      return;
    }
    const servers = await this.net.listServers();
    const mine = (servers || []).find((s) => s.id === id);
    if (mine) this.hooks.joinServer(mine);
  }

  // ---------------- pause ----------------

  showPause() { this.inGame = true; this.show('pause'); }
  backToTitle() { this.inGame = false; this.show('main'); }

  _renderSkin() {
    for (const part of ['head', 'body', 'arms', 'legs', 'eyes']) {
      $('skin-' + part).value = this.skin[part];
    }
    drawSkinPreview($('skin-preview'), this.skin);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
