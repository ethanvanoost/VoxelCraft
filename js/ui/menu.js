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

    this._migrateOldSave();
    this._bind();
    this.show(this.username ? 'main' : 'username');
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
    $('btn-world-create').addEventListener('click', () => this._createWorld());
    $('btn-worlds-back').addEventListener('click', () => this.show('main'));

    // ---- servers ----
    $('btn-server-create').addEventListener('click', () => this._createServer());
    $('btn-servers-back').addEventListener('click', () => this.show('main'));

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
    if (!worlds.length) {
      list.innerHTML = '<div class="list-empty">No worlds yet — create one below.</div>';
      return;
    }
    for (const w of worlds) {
      const item = document.createElement('div');
      item.className = 'list-item';
      const label = document.createElement('div');
      label.innerHTML = `<b>${escapeHtml(w.name)}</b>` +
        `<span class="sub">${w.mode === 'creative' ? 'Creative' : 'Survival'}` +
        `${w.cheats ? ' · cheats' : ''} · seed ${w.seed}</span>`;
      const del = document.createElement('span');
      del.className = 'del';
      del.textContent = '✕';
      del.title = 'Delete world';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`Delete world "${w.name}" forever?`)) {
          localStorage.removeItem('vc_world_' + w.id);
          this._saveWorlds(this.worlds().filter((x) => x.id !== w.id));
          this._renderWorlds();
        }
      });
      item.appendChild(label);
      item.appendChild(del);
      item.addEventListener('click', () => this.hooks.startWorld(w));
      list.appendChild(item);
    }
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
    status.textContent = servers.length ? `${servers.length} server(s) online` : '';
    if (!servers.length) {
      list.innerHTML = '<div class="list-empty">No servers yet — create the first one!</div>';
      return;
    }
    for (const s of servers) {
      const item = document.createElement('div');
      item.className = 'list-item';
      item.innerHTML = `<div><b>${escapeHtml(s.name)}</b>` +
        `<span class="sub">${s.mode === 'creative' ? 'Creative' : 'Survival'}` +
        `${s.cheats ? ' · cheats for all' : ''} · by ${escapeHtml(s.creatorName || '?')}</span></div>` +
        `<span>Join →</span>`;
      item.addEventListener('click', () => this.hooks.joinServer(s));
      list.appendChild(item);
    }
  }

  async _createServer() {
    if (!this.net.available) return;
    const name = $('server-name').value.trim() || `${this.username}'s server`;
    $('server-status').textContent = 'Creating server…';
    const id = await this.net.createServer({
      name,
      mode: $('server-mode').value,
      cheats: $('server-cheats').checked,
      username: this.username,
    });
    if (!id) { $('server-status').textContent = 'Failed to create server.'; return; }
    const servers = await this.net.listServers();
    const mine = servers.find((s) => s.id === id);
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
