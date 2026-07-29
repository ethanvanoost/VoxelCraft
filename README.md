# VoxelCraft

A Minecraft-inspired voxel game built with **Three.js and vanilla ES6 modules** — no build step, no game engine, zero image/audio assets (all 16×16 pixel-art textures and every sound effect are generated procedurally at runtime).

## Running

**Easiest:** just double-click `index.html` (or `standalone.html`). Browsers block module *files* on `file://` pages, so `index.html` detects this and hops to `standalone.html` — the whole game bundled into one file, which runs fine from disk.

**Recommended:** double-click `Start VoxelCraft.bat` — it starts a tiny local server (`serve.ps1`, built into Windows) and opens http://localhost:8080/ with the modular version.

Note: saves live in browser localStorage per origin, so worlds from the double-click (`file://`) version and the server (`localhost`) version are separate.

After editing anything in `js/` or `css/`, regenerate the single-file build:

```
powershell -ExecutionPolicy Bypass -File build-standalone.ps1
```

## Controls

| Input | Action |
|---|---|
| WASD | Move |
| Mouse | Look (pointer lock) |
| Space | Jump / fly up |
| Ctrl | Sprint |
| Shift | Crouch / fly down |
| F | Toggle fly mode |
| Left click (hold) | Break block (cracking animation, per-block mining speed) |
| Right click | Place block / open crafting table |
| 1–9 / scroll wheel | Select hotbar slot |
| E | Inventory & 2×2 crafting (drag & drop, right-click to split/place-one) |
| T or / | Command console |
| F3 | Debug screen |
| Esc | Pause menu / settings |

### Commands
`/tp x y z` · `/time set day|night|noon|midnight|0..1` · `/give <block> [count]` · `/gamemode creative|survival` · `/seed` · `/clear`

## Getting started (survival)

You start with an **empty inventory**. Punch a tree (hold left click on a log), then:

1. Open your inventory (**E**) — it has a 2×2 crafting grid.
2. 1 log → 4 planks · 4 planks → **crafting table**.
3. Place the table and **right-click** it for the full 3×3 grid.

### Recipes

All Minecraft recipes expressible with this world's materials are implemented with authentic shapes and yields (`js/core/recipes.js`). Ores drop their refined material directly (no smelting step yet). Recipes needing farming/mob/redstone materials are omitted until those exist.

- **Wood:** log → 4 planks · 2 planks (stacked) → 4 sticks · 4 planks → crafting table · 8 planks ring → chest
- **Stone:** 8 cobblestone ring → furnace · 4 stone → 4 stone bricks · 4 sand → sandstone
- **Storage blocks:** 9 coal/iron/gold/diamond ↔ 1 block (both directions)
- **Tools (25):** wooden/stone/iron/golden/diamond × pickaxe/axe/shovel/sword/hoe, classic patterns (e.g. pickaxe = 3 material over 2 sticks). Matching tools mine faster: wood ×2, stone ×4, iron ×6, diamond ×8, gold ×12. Tools don't stack.

Shaped recipes match anywhere in the grid (axe/hoe accept both mirror orientations); crafting consumes one item per occupied cell.

## Features

- **Infinite procedural terrain** — seeded simplex noise; oceans, rivers, beaches, plains, forests, deserts, hills, mountains, snow biomes; caves (intersecting 3D noise ridges); depth-gated ores (coal → iron → gold → diamond); trees that cross chunk borders without popping.
- **Chunked rendering** — 16×256×16 chunks streamed in a circle around the player, face-culled meshes with baked directional shading + per-vertex ambient occlusion, one draw call per chunk per pass, frustum culling, budgeted per-frame generation/remeshing, render-distance setting.
- **Physics** — per-axis AABB voxel collision, gravity, jumping, sprint acceleration, crouching, swimming (water slows movement, resets fall damage), fall damage, fly mode, head bobbing.
- **Day/night cycle** — orbiting sun with soft PCF shadows, keyframed sky/fog colors (sunrise → noon → sunset → night), stars, drifting instanced clouds, sun/moon discs.
- **Survival stats** — health + hunger bars; sprinting drains hunger, high hunger regenerates health, starvation and drowning damage.
- **Persistence** — world seed, every player edit, position, inventory, and time of day saved to localStorage; auto-save every 60 s and on tab close.
- **Audio** — Web Audio-synthesized footsteps (per block material), dig/break/place, jump/land, hurt, splash, ambient wind.
- **Settings** — render distance, FOV, mouse sensitivity, volume, fullscreen (persisted).

## Architecture

```
js/
  main.js               entry point + game loop + UI state machine
  core/
    config.js           all tunables (single source of truth)
    noise.js            seeded simplex noise (2D/3D + fBm)
    blocks.js           block registry — add new blocks here
    textures.js         procedural 16×16 tile painters + atlas builder
    save.js             localStorage persistence + auto-save
  world/
    worldgen.js         biomes, heightmap, caves, ores, trees (pure/deterministic)
    chunk.js            block storage + mesh builder (culling + AO)
    world.js            chunk streaming, edits log, dirty remeshing
  player/
    player.js           first-person controller, physics, stats
    interaction.js      voxel raycast, break/place, crack overlay
  ui/
    inventory.js        hotbar + inventory model & DOM
    hud.js              FPS, coords, F3 debug, health/hunger
    settings.js         settings panel (persisted)
    commands.js         chat command console
  environment/
    sky.js              day/night, sun/shadows, clouds, stars, fog
  audio/
    audio.js            procedural Web Audio engine
```

### Adding a block
1. Add an id to `BLOCK` and an entry in `BLOCK_DEFS` (`js/core/blocks.js`).
2. Add a tile painter in `js/core/textures.js` if it needs a new texture.
3. Optionally list it in `INVENTORY_BLOCKS`.

Meshing, mining, sounds, icons, saving, and `/give` all pick it up automatically.
