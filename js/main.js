/**
 * VoxelCraft — main entry point.
 * Boots the renderer, builds the texture atlas, constructs all subsystems,
 * restores any saved world, and runs the game loop.
 */

import * as THREE from 'three';
import { CONFIG } from './core/config.js';
import { BLOCK } from './core/blocks.js';
import { buildAtlas } from './core/textures.js';
import { SaveSystem } from './core/save.js';
import { World } from './world/world.js';
import { Player } from './player/player.js';
import { Interaction } from './player/interaction.js';
import { Inventory } from './ui/inventory.js';
import { HUD } from './ui/hud.js';
import { Settings } from './ui/settings.js';
import { Commands } from './ui/commands.js';
import { Sky } from './environment/sky.js';
import { AudioEngine } from './audio/audio.js';

// ---------------------------------------------------------------- Renderer
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('game').appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const scene = new THREE.Scene();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------- Systems
const atlas = buildAtlas();
const saved = SaveSystem.peek();
const seed = saved?.seed ?? Math.floor(Math.random() * 2 ** 31);

const audio = new AudioEngine();
const world = new World(scene, atlas, seed);
const sky = new Sky(scene, renderer);
const player = new Player(camera, world, audio);
const inventory = new Inventory(atlas, audio);
const interaction = new Interaction(world, player, inventory, atlas, scene, audio);
const hud = new HUD(player, world, interaction);
const commands = new Commands(player, world, inventory, sky);
const saveSystem = new SaveSystem(world, player, inventory, sky);

// Right-clicking a crafting table opens the 3×3 crafting screen
interaction.onUseBlock = (blockId) => {
  if (blockId === BLOCK.CRAFTING_TABLE) {
    inventory.toggle(false, 3);
    setMode('inventory');
    return true;
  }
  return false;
};

const settings = new Settings({
  renderDistance: (v) => { world.renderDistance = v; },
  fov: (v) => { camera.fov = v; camera.updateProjectionMatrix(); },
  sensitivity: (v) => { player.sensitivity = v; },
  volume: (v) => { audio.setVolume(v / 100); },
});

// ---------------------------------------------------------------- Spawn
if (saved) {
  saveSystem.restore(saved);
} else {
  const y = world.surfaceHeight(0, 0) + 2;
  player.position.set(0.5, y, 0.5);
}

// Pre-generate the chunks around the spawn point synchronously so the player
// doesn't fall through ungenerated terrain on the first frames.
{
  const realR = world.renderDistance;
  world.renderDistance = 2;
  for (let i = 0; i < 60 && (world.genQueue.length > 0 || i === 0); i++) {
    world.update(player.position);
  }
  world.renderDistance = realR;
}

// ---------------------------------------------------------------- UI state machine
// Modes: 'menu' (pause/settings), 'playing' (pointer locked), 'inventory', 'chat'
let uiMode = 'menu';
const menuEl = document.getElementById('menu');
const menuMain = document.getElementById('menu-main');
const menuSettings = document.getElementById('menu-settings');

function setMode(mode) {
  uiMode = mode;
  player.enabled = mode === 'playing';
  menuEl.classList.toggle('hidden', mode !== 'menu');
  if (mode === 'playing' && document.pointerLockElement !== renderer.domElement) {
    renderer.domElement.requestPointerLock();
  }
  if (mode !== 'playing' && mode !== 'chat' && document.pointerLockElement) {
    document.exitPointerLock();
  }
}

document.getElementById('btn-play').addEventListener('click', () => setMode('playing'));
document.getElementById('btn-settings').addEventListener('click', () => {
  menuMain.classList.add('hidden');
  menuSettings.classList.remove('hidden');
});
document.getElementById('btn-back').addEventListener('click', () => {
  menuSettings.classList.add('hidden');
  menuMain.classList.remove('hidden');
});
document.getElementById('btn-save').addEventListener('click', (e) => {
  const ok = saveSystem.save();
  e.target.textContent = ok ? 'Saved!' : 'Save failed';
  setTimeout(() => { e.target.textContent = 'Save World'; }, 1200);
});
document.getElementById('btn-reset').addEventListener('click', () => {
  if (confirm('Delete this world and generate a new one?')) {
    saveSystem.disabled = true;   // block the beforeunload auto-save from resaving
    SaveSystem.clear();
    location.reload();
  }
});

// Losing pointer lock while playing (Esc) opens the pause menu
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  if (!locked && uiMode === 'playing') setMode('menu');
  if (locked) setMode('playing');
});

document.addEventListener('keydown', (e) => {
  if (uiMode === 'chat') return;   // chat input handles its own keys
  if (e.code === 'KeyE') {
    if (uiMode === 'playing') { inventory.toggle(); setMode('inventory'); }
    else if (uiMode === 'inventory') { inventory.toggle(true); setMode('playing'); }
  }
  if (e.code === 'Escape' && uiMode === 'inventory') {
    inventory.toggle(true);
    setMode('playing');
  }
  if ((e.code === 'KeyT' || e.code === 'Slash') && uiMode === 'playing') {
    e.preventDefault();
    setMode('chat');
    commands.openChat();
    if (e.code === 'Slash') commands.input.value = '/';
  }
});

// Returning from chat
commands.input.addEventListener('blur', () => {
  if (uiMode === 'chat') setMode('playing');
});

// Water splash sound on entering water
let wasInWater = false;

// ---------------------------------------------------------------- Game loop
const clock = new THREE.Clock();

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.1);
  const running = uiMode !== 'menu';

  if (running) {
    player.creative = commands.creative;
    player.update(dt);
    interaction.update(dt);
    world.update(player.position);
    sky.update(dt, player.position, world.renderDistance);
    saveSystem.update(dt);

    if (player.inWater && !wasInWater) audio.play('splash');
    wasInWater = player.inWater;

    // Underwater visual: dense blue fog
    if (player.headInWater) {
      scene.fog.color.setHex(0x1a3a8a);
      scene.fog.near = 1;
      scene.fog.far = 24;
      scene.background = new THREE.Color(0x1a3a8a);
    }
  } else {
    // Menu open: keep streaming chunks so "Play" starts smoothly
    world.update(player.position);
    sky.update(0, player.position, world.renderDistance);
  }

  hud.update(dt, sky.time);
  renderer.render(scene, camera);
}

frame();

// Expose for console tinkering / debugging
window.VoxelCraft = { world, player, sky, inventory, commands, CONFIG };
