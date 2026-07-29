/**
 * VoxelCraft — main entry point.
 *
 * Boot flow: username screen → title menu → singleplayer world list or
 * multiplayer server browser → game. One game per page load: quitting to
 * title saves and reloads for a clean slate.
 */

import * as THREE from 'three';
import { CONFIG } from './core/config.js';
import { BLOCK } from './core/blocks.js';
import { buildAtlas } from './core/textures.js';
import { SaveSystem } from './core/save.js';
import { World } from './world/world.js';
import { Player } from './player/player.js';
import { Interaction } from './player/interaction.js';
import { Avatar } from './player/avatar.js';
import { Inventory } from './ui/inventory.js';
import { HUD } from './ui/hud.js';
import { Settings } from './ui/settings.js';
import { Commands } from './ui/commands.js';
import { Menu } from './ui/menu.js';
import { Sky } from './environment/sky.js';
import { AudioEngine } from './audio/audio.js';
import { Net } from './net/net.js';

// ---------------------------------------------------------------- Renderer
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('game').appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a1e);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------- Globals
const atlas = buildAtlas();
const audio = new AudioEngine();
const net = new Net();

let game = null;      // active game state, see startGame()
let uiMode = 'title'; // 'title' | 'playing' | 'inventory' | 'chat' | 'pause'

const menu = new Menu(net, {
  startWorld: (meta) => startGame({ type: 'sp', meta }),
  joinServer: (server) => startGame({ type: 'mp', server }),
  resume: () => setMode('playing'),
  quit: () => quitToTitle(),
});

const settings = new Settings({
  renderDistance: (v) => { if (game) game.world.renderDistance = v; },
  fov: (v) => { camera.fov = v; camera.updateProjectionMatrix(); },
  sensitivity: (v) => { if (game) game.player.sensitivity = v; },
  volume: (v) => { audio.setVolume(v / 100); },
});

// ---------------------------------------------------------------- Chest sync helpers
const packChest = (slots) => slots.map((s) => (s ? { i: s.id, c: s.count } : 0));
const unpackChest = (arr) => {
  const out = new Array(27).fill(null);
  if (arr) for (let i = 0; i < 27; i++) { const v = arr[i]; if (v && v.i) out[i] = { id: v.i, count: v.c || 1 }; }
  return out;
};

// ---------------------------------------------------------------- Game lifecycle
async function startGame(opts) {
  if (game) return;
  const isMP = opts.type === 'mp';
  const meta = isMP ? opts.server : opts.meta;
  const seed = meta.seed ?? Math.floor(Math.random() * 2 ** 31);
  const gameMode = meta.mode || 'survival';

  const world = new World(scene, atlas, seed);
  world.renderDistance = settings.values.renderDistance;
  const sky = new Sky(scene, renderer);
  const player = new Player(camera, world, audio);
  player.sensitivity = settings.values.sensitivity;
  const inventory = new Inventory(atlas, audio);
  const interaction = new Interaction(world, player, inventory, atlas, scene, audio);
  const hud = new HUD(player, world, interaction);
  const commands = new Commands(player, world, inventory, sky);
  commands.username = menu.username;

  const saveKey = isMP ? 'vc_server_' + meta.id : 'vc_world_' + meta.id;
  const saveSystem = new SaveSystem(world, player, inventory, sky, saveKey, isMP);

  // Cheats: world setting; on servers the creator can always cheat
  commands.cheatsAllowed = isMP
    ? (!!meta.cheats || (net.uid && meta.creator === net.uid))
    : !!meta.cheats;

  // Own avatar (visible in 2nd/3rd person) + name tag
  const selfAvatar = new Avatar(menu.username, menu.skin);
  scene.add(selfAvatar.group);

  game = {
    world, sky, player, inventory, interaction, hud, commands, saveSystem,
    selfAvatar, gameMode, isMP, meta,
    session: null,
    avatars: new Map(),       // uid -> { avatar, target: {x,y,z,yaw,pitch} }
    openChestKey: null,
    wasInWater: false,
  };

  // ---- Restore / spawn ----
  const saved = SaveSystem.peek(saveKey);
  if (saved && (!saved.seed || saved.seed === seed)) saveSystem.restore(saved);
  else {
    // Spiral out from the origin until we find dry land to spawn on
    let sx = 0, sz = 0;
    outer:
    for (let r = 0; r < 64; r++) {
      for (let a = 0; a < Math.max(1, r * 6); a++) {
        const ang = (a / Math.max(1, r * 6)) * Math.PI * 2;
        const x = Math.round(Math.cos(ang) * r * 8);
        const z = Math.round(Math.sin(ang) * r * 8);
        if (world.gen.column(x, z).height > CONFIG.SEA_LEVEL + 1) { sx = x; sz = z; break outer; }
      }
    }
    player.position.set(sx + 0.5, world.surfaceHeight(sx, sz) + 2, sz + 0.5);
  }

  // ---- Block use: crafting table / chest ----
  interaction.onUseBlock = (blockId) => {
    if (blockId === BLOCK.CRAFTING_TABLE) {
      inventory.toggle(false, 3);
      setMode('inventory');
      return true;
    }
    if (blockId === BLOCK.CHEST) {
      const p = interaction.target.pos;
      const key = `${p.x},${p.y},${p.z}`;
      game.openChestKey = key;
      const slots = world.getChest(key);
      inventory.openChest(slots, () => {
        game.session?.setChest(key, packChest(slots));
      });
      setMode('inventory');
      return true;
    }
    return false;
  };
  interaction.onChestBroken = (key) => game.session?.setChest(key, null);

  // ---- Multiplayer session ----
  if (isMP) {
    const session = await net.joinServer(meta.id, {
      onPlayer(uid, data) {
        if (!data) return;
        let entry = game.avatars.get(uid);
        if (!entry) {
          const avatar = new Avatar(data.name || 'Player', data.skin);
          scene.add(avatar.group);
          entry = { avatar, target: null };
          game.avatars.set(uid, entry);
        }
        entry.target = data;
      },
      onPlayersSweep(seen) {
        for (const [uid, entry] of game.avatars) {
          if (!seen.has(uid)) {
            entry.avatar.dispose(scene);
            game.avatars.delete(uid);
          }
        }
      },
      onEdit(posKey, id) {
        game.world.edits[posKey] = id;
        const [x, y, z] = posKey.split(',').map(Number);
        if (game.world.getBlock(x, y, z) !== id) game.world.setBlock(x, y, z, id, false);
      },
      onChests(all) {
        for (const [key, packed] of Object.entries(all)) {
          const fresh = unpackChest(packed);
          const existing = game.world.chests[key];
          if (existing) {
            for (let i = 0; i < 27; i++) existing[i] = fresh[i]; // keep open-chest reference alive
          } else {
            game.world.chests[key] = fresh;
          }
        }
        if (game.inventory.open && game.inventory.chest) game.inventory.renderAll();
      },
      onChat(m) { game.commands.print(`<${m.name}> ${m.text}`); },
    });
    if (!session) {
      game.commands.print('Could not join server.');
    } else {
      game.session = session;
      game.world.onEdit = (x, y, z, id) => session.sendEdit(`${x},${y},${z}`, id);
      game.commands.onChat = (text) => session.sendChat(menu.username, text);
      game.stateTimer = setInterval(() => {
        const p = game.player;
        session.sendState({
          name: menu.username, skin: menu.skin,
          x: +p.position.x.toFixed(2), y: +p.position.y.toFixed(2), z: +p.position.z.toFixed(2),
          yaw: +p.yaw.toFixed(3), pitch: +p.pitch.toFixed(3), ts: Date.now(),
        });
      }, 120);
      game.commands.print(`Joined "${meta.name}" — say hi with T!`);
    }
  }

  // ---- Creative mode setup ----
  if (gameMode === 'creative') {
    player.creative = true;
    inventory.setCreative(true);
  }

  // Pre-generate spawn area so the player doesn't fall through the world
  {
    const realR = world.renderDistance;
    world.renderDistance = 2;
    for (let i = 0; i < 60 && (world.genQueue.length > 0 || i === 0); i++) {
      world.update(player.position);
    }
    world.renderDistance = realR;
  }

  menu.inGame = true;
  setMode('playing');
}

function quitToTitle() {
  if (!game) return;
  game.saveSystem.save();
  game.session?.leave();
  if (game.stateTimer) clearInterval(game.stateTimer);
  // A reload gives a guaranteed-clean slate (scene, DOM slots, listeners)
  location.reload();
}

// ---------------------------------------------------------------- UI state machine
function setMode(mode) {
  uiMode = mode;
  if (game) game.player.enabled = mode === 'playing';
  if (mode === 'playing') {
    menu.hide();
    // Fullscreen while playing: this is the only state where the browser
    // lets us capture Ctrl+W (Keyboard Lock API) — and it feels right anyway.
    if (!document.fullscreenElement) {
      try { document.documentElement.requestFullscreen()?.catch?.(() => {}); } catch { /* needs gesture */ }
    }
    if (document.pointerLockElement !== renderer.domElement) {
      try { renderer.domElement.requestPointerLock()?.catch?.(() => {}); } catch { /* no gesture yet */ }
    }
  } else if (mode === 'pause') {
    menu.showPause();
  }
  if (mode !== 'playing' && mode !== 'chat' && document.pointerLockElement) {
    document.exitPointerLock();
  }
}

// Losing pointer lock while playing (Esc) opens the pause menu
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  if (!locked && uiMode === 'playing') setMode('pause');
  if (locked && game) setMode('playing');
});

document.addEventListener('keydown', (e) => {
  // F5 / Ctrl+W are game keys, not browser keys, while in game
  if (game && (e.code === 'F5' || (e.ctrlKey && e.code === 'KeyW'))) e.preventDefault();
  if (!game || uiMode === 'chat') return;
  if (e.code === 'KeyE') {
    if (uiMode === 'playing') { game.inventory.toggle(); setMode('inventory'); }
    else if (uiMode === 'inventory') { game.inventory.toggle(true); setMode('playing'); }
  }
  if (e.code === 'Escape' && uiMode === 'inventory') {
    game.inventory.toggle(true);
    setMode('playing');
  }
  if ((e.code === 'KeyT' || e.code === 'Slash') && uiMode === 'playing') {
    e.preventDefault();
    setMode('chat');
    game.commands.openChat();
    if (e.code === 'Slash') game.commands.input.value = '/';
  }
});

// Returning from chat
document.getElementById('chat-input').addEventListener('blur', () => {
  if (uiMode === 'chat') setMode('playing');
});

// ---- Ctrl+W protection (best a web page can do) ----
// 1) Confirmation dialog when closing the tab mid-game:
window.addEventListener('beforeunload', (e) => {
  if (game) {
    e.preventDefault();
    e.returnValue = '';   // triggers the browser's "Leave site?" prompt
  }
});
// 2) In fullscreen, the Keyboard Lock API captures Ctrl+W outright:
if (navigator.keyboard?.lock) {
  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) navigator.keyboard.lock(['KeyW', 'F5']);
    else navigator.keyboard.unlock();
  });
}

// ---------------------------------------------------------------- Game loop
const clock = new THREE.Clock();
const statusBars = document.getElementById('status-bars');

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.1);
  if (!game) { renderer.render(scene, camera); return; }

  const { world, sky, player, interaction, hud, commands, saveSystem, selfAvatar } = game;
  const running = uiMode !== 'pause';

  // Creative can also be toggled via /gamemode (when cheats allow)
  player.creative = game.gameMode === 'creative' || commands.creative;
  game.inventory.setCreative(player.creative);
  statusBars.style.display = player.creative ? 'none' : 'flex';

  if (running) {
    player.update(dt);
    interaction.update(dt);
    world.update(player.position);
    sky.update(dt, player.position, world.renderDistance);
    saveSystem.update(dt);

    if (player.inWater && !game.wasInWater) audio.play('splash');
    game.wasInWater = player.inWater;

    if (player.headInWater) {
      scene.fog.color.setHex(0x1a3a8a);
      scene.fog.near = 1;
      scene.fog.far = 24;
      scene.background = new THREE.Color(0x1a3a8a);
    }
  } else {
    world.update(player.position);
    sky.update(0, player.position, world.renderDistance);
  }

  // Own model: visible in 2nd/3rd person only
  selfAvatar.group.visible = player.cameraMode !== 0;
  selfAvatar.update(player.position, player.yaw, player.pitch, dt);

  // Remote players: smooth toward their latest reported position
  for (const { avatar, target } of game.avatars.values()) {
    if (!target) continue;
    const g = avatar.group.position;
    const k = Math.min(1, dt * 10);
    avatar.update(
      new THREE.Vector3(
        g.x + (target.x - g.x) * k,
        g.y + (target.y - g.y) * k,
        g.z + (target.z - g.z) * k
      ),
      target.yaw || 0, target.pitch || 0, dt
    );
  }

  hud.update(dt, sky.time);
  renderer.render(scene, camera);
}

frame();

// Expose for console tinkering / debugging
window.VoxelCraft = { get game() { return game; }, menu, net, CONFIG };

// Automated smoke test: open the page with #autotest to jump straight into
// a fresh world (used by the headless boot check; harmless otherwise).
if (location.hash === '#autotest') {
  menu.username = 'Tester';
  startGame({ type: 'sp', meta: { id: 'autotest', name: 'Test', seed: 42, mode: 'survival', cheats: true } });
}
