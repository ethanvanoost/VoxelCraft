/**
 * Texture atlas builder.
 *
 * All block textures are generated procedurally as 16×16 pixel-art tiles on a
 * canvas at startup (so the game needs zero image assets), packed into one
 * atlas, and uploaded once as a THREE.CanvasTexture using NearestFilter for a
 * crisp, unfiltered Minecraft look.
 */

import * as THREE from 'three';
import { mulberry32 } from './noise.js';

export const TILE = 16;            // authoring resolution (painters draw at 16×16)
export const OUT = 32;             // final atlas tile resolution (32×32 per block)
export const ATLAS_COLS = 8;       // tiles per atlas row

/** Utility: seeded per-tile RNG so textures are stable across sessions. */
function rng(seed) { return mulberry32(seed); }

/** Fill a tile with base color plus per-pixel brightness noise ("dithered" look). */
function noisyFill(ctx, x0, y0, base, variance, seed) {
  const rand = rng(seed);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const v = (rand() - 0.5) * 2 * variance;
      const r = Math.max(0, Math.min(255, base[0] + v));
      const g = Math.max(0, Math.min(255, base[1] + v));
      const b = Math.max(0, Math.min(255, base[2] + v));
      ctx.fillStyle = `rgb(${r|0},${g|0},${b|0})`;
      ctx.fillRect(x0 + x, y0 + y, 1, 1);
    }
  }
}

/** Scatter random single pixels of a color over a tile. */
function speckle(ctx, x0, y0, color, count, seed, size = 1) {
  const rand = rng(seed);
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rand() * (TILE - size + 1));
    const y = Math.floor(rand() * (TILE - size + 1));
    ctx.fillRect(x0 + x, y0 + y, size, size);
  }
}

/** Draw ore blobs (2x2-ish clusters) over a stone background. */
function oreBlobs(ctx, x0, y0, color, highlight, seed) {
  const rand = rng(seed);
  for (let i = 0; i < 4; i++) {
    const x = 1 + Math.floor(rand() * 12);
    const y = 1 + Math.floor(rand() * 12);
    ctx.fillStyle = color;
    ctx.fillRect(x0 + x, y0 + y, 2, 2);
    ctx.fillRect(x0 + x + (rand() > 0.5 ? 1 : -1), y0 + y + 1, 1, 1);
    ctx.fillStyle = highlight;
    ctx.fillRect(x0 + x, y0 + y, 1, 1);
  }
}

/**
 * Tile painters — one function per texture name.
 * Each receives (ctx, x0, y0) = atlas context and tile pixel origin.
 */
const PAINTERS = {
  grass_top(ctx, x, y) {
    noisyFill(ctx, x, y, [98, 160, 58], 22, 101);
    speckle(ctx, x, y, 'rgb(72,128,44)', 26, 102);
    speckle(ctx, x, y, 'rgb(120,182,72)', 14, 103);
  },
  grass_side(ctx, x, y) {
    noisyFill(ctx, x, y, [134, 96, 67], 18, 104);            // dirt body
    // grass fringe on top with an uneven edge
    const rand = rng(105);
    for (let px = 0; px < TILE; px++) {
      const depth = 2 + Math.floor(rand() * 3);
      for (let py = 0; py < depth; py++) {
        ctx.fillStyle = py < depth - 1 ? 'rgb(98,160,58)' : 'rgb(80,138,48)';
        ctx.fillRect(x + px, y + py, 1, 1);
      }
    }
  },
  dirt(ctx, x, y) {
    noisyFill(ctx, x, y, [134, 96, 67], 20, 106);
    speckle(ctx, x, y, 'rgb(110,78,52)', 22, 107);
    speckle(ctx, x, y, 'rgb(155,114,80)', 12, 108);
  },
  stone(ctx, x, y) {
    noisyFill(ctx, x, y, [125, 125, 125], 14, 109);
    speckle(ctx, x, y, 'rgb(105,105,105)', 20, 110, 2);
    speckle(ctx, x, y, 'rgb(140,140,140)', 10, 111);
  },
  cobblestone(ctx, x, y) {
    noisyFill(ctx, x, y, [110, 110, 110], 18, 112);
    // rough stone lumps outlined in dark grout
    const rand = rng(113);
    ctx.fillStyle = 'rgb(70,70,70)';
    for (let i = 0; i < 7; i++) {
      const bx = Math.floor(rand() * 12), by = Math.floor(rand() * 12);
      const w = 3 + Math.floor(rand() * 3), h = 3 + Math.floor(rand() * 3);
      ctx.strokeStyle = 'rgb(70,70,70)';
      ctx.strokeRect(x + bx + 0.5, y + by + 0.5, w, h);
    }
  },
  sand(ctx, x, y) {
    noisyFill(ctx, x, y, [219, 207, 163], 12, 114);
    speckle(ctx, x, y, 'rgb(196,182,133)', 18, 115);
  },
  sandstone(ctx, x, y) {
    noisyFill(ctx, x, y, [212, 200, 158], 8, 116);
    ctx.fillStyle = 'rgb(190,178,138)';
    ctx.fillRect(x, y + 3, TILE, 1);
    ctx.fillRect(x, y + 9, TILE, 1);
    ctx.fillRect(x, y + 13, TILE, 1);
  },
  gravel(ctx, x, y) {
    noisyFill(ctx, x, y, [131, 127, 126], 26, 117);
    speckle(ctx, x, y, 'rgb(90,86,85)', 16, 118, 2);
    speckle(ctx, x, y, 'rgb(160,156,155)', 12, 119, 2);
  },
  snow(ctx, x, y) {
    noisyFill(ctx, x, y, [240, 246, 250], 8, 120);
    speckle(ctx, x, y, 'rgb(220,228,236)', 14, 121);
  },
  snow_side(ctx, x, y) {
    noisyFill(ctx, x, y, [134, 96, 67], 18, 122);
    const rand = rng(123);
    for (let px = 0; px < TILE; px++) {
      const depth = 3 + Math.floor(rand() * 2);
      for (let py = 0; py < depth; py++) {
        ctx.fillStyle = 'rgb(238,244,248)';
        ctx.fillRect(x + px, y + py, 1, 1);
      }
    }
  },
  water(ctx, x, y) {
    noisyFill(ctx, x, y, [52, 92, 200], 16, 124);
    speckle(ctx, x, y, 'rgba(90,130,225,0.9)', 20, 125, 2);
  },
  bedrock(ctx, x, y) {
    noisyFill(ctx, x, y, [70, 70, 70], 35, 126);
    speckle(ctx, x, y, 'rgb(30,30,30)', 24, 127, 2);
    speckle(ctx, x, y, 'rgb(120,120,120)', 12, 128, 2);
  },
  log_side(ctx, x, y) {
    noisyFill(ctx, x, y, [104, 82, 50], 12, 129);
    const rand = rng(130);
    // vertical bark grooves
    for (let i = 0; i < 5; i++) {
      const gx = Math.floor(rand() * TILE);
      ctx.fillStyle = 'rgb(80,62,36)';
      for (let py = 0; py < TILE; py++) {
        if (rand() > 0.25) ctx.fillRect(x + gx, y + py, 1, 1);
      }
    }
  },
  log_top(ctx, x, y) {
    noisyFill(ctx, x, y, [104, 82, 50], 8, 131);
    // growth rings
    ctx.fillStyle = 'rgb(160,132,86)';
    ctx.fillRect(x + 3, y + 3, 10, 10);
    ctx.fillStyle = 'rgb(120,96,60)';
    ctx.fillRect(x + 5, y + 5, 6, 6);
    ctx.fillStyle = 'rgb(160,132,86)';
    ctx.fillRect(x + 7, y + 7, 2, 2);
  },
  leaves(ctx, x, y) {
    ctx.clearRect(x, y, TILE, TILE);
    const rand = rng(132);
    for (let py = 0; py < TILE; py++) {
      for (let px = 0; px < TILE; px++) {
        if (rand() > 0.16) {  // some transparent holes
          const shade = 40 + Math.floor(rand() * 60);
          ctx.fillStyle = `rgb(${20 + shade * 0.4 | 0},${70 + shade},${20 + shade * 0.35 | 0})`;
          ctx.fillRect(x + px, y + py, 1, 1);
        }
      }
    }
  },
  planks(ctx, x, y) {
    noisyFill(ctx, x, y, [162, 130, 78], 10, 133);
    ctx.fillStyle = 'rgb(120,94,54)';
    for (const py of [0, 4, 8, 12]) ctx.fillRect(x, y + py, TILE, 1);
    ctx.fillRect(x + 8, y + 1, 1, 3);
    ctx.fillRect(x + 3, y + 5, 1, 3);
    ctx.fillRect(x + 12, y + 9, 1, 3);
    ctx.fillRect(x + 6, y + 13, 1, 3);
  },
  coal_ore(ctx, x, y)    { PAINTERS.stone(ctx, x, y); oreBlobs(ctx, x, y, 'rgb(35,35,35)', 'rgb(70,70,70)', 134); },
  iron_ore(ctx, x, y)    { PAINTERS.stone(ctx, x, y); oreBlobs(ctx, x, y, 'rgb(216,175,147)', 'rgb(240,205,180)', 135); },
  gold_ore(ctx, x, y)    { PAINTERS.stone(ctx, x, y); oreBlobs(ctx, x, y, 'rgb(250,220,80)', 'rgb(255,245,160)', 136); },
  diamond_ore(ctx, x, y) { PAINTERS.stone(ctx, x, y); oreBlobs(ctx, x, y, 'rgb(90,220,215)', 'rgb(170,255,250)', 137); },
  crafting_top(ctx, x, y) {
    PAINTERS.planks(ctx, x, y);
    // dark work-surface border + center grid, like Minecraft's table top
    ctx.fillStyle = 'rgb(96,72,40)';
    ctx.fillRect(x, y, TILE, 2); ctx.fillRect(x, y + 14, TILE, 2);
    ctx.fillRect(x, y, 2, TILE); ctx.fillRect(x + 14, y, 2, TILE);
    ctx.fillStyle = 'rgb(80,60,34)';
    ctx.fillRect(x + 7, y + 2, 2, 12);
    ctx.fillRect(x + 2, y + 7, 12, 2);
  },
  crafting_side(ctx, x, y) {
    PAINTERS.planks(ctx, x, y);
    // saw + hammer silhouettes as simple dark pixel shapes
    ctx.fillStyle = 'rgb(70,52,30)';
    ctx.fillRect(x + 2, y + 3, 5, 4);      // hammer head
    ctx.fillRect(x + 4, y + 7, 1, 5);      // hammer handle
    ctx.fillStyle = 'rgb(150,150,150)';
    ctx.fillRect(x + 9, y + 4, 5, 2);      // saw blade
    ctx.fillStyle = 'rgb(70,52,30)';
    ctx.fillRect(x + 9, y + 6, 2, 3);      // saw handle
    ctx.fillStyle = 'rgb(96,72,40)';
    ctx.fillRect(x, y, TILE, 2);           // table top edge
  },
  stone_bricks(ctx, x, y) {
    noisyFill(ctx, x, y, [122, 122, 122], 10, 141);
    ctx.fillStyle = 'rgb(88,88,88)';
    // mortar: two brick rows, offset like real brickwork
    ctx.fillRect(x, y, TILE, 1);
    ctx.fillRect(x, y + 7, TILE, 1);
    ctx.fillRect(x, y + 15, TILE, 1);
    ctx.fillRect(x + 7, y + 1, 1, 6);      // top row vertical joint
    ctx.fillRect(x + 3, y + 8, 1, 7);      // bottom row joints (offset)
    ctx.fillRect(x + 11, y + 8, 1, 7);
    ctx.fillStyle = 'rgb(140,140,140)';
    ctx.fillRect(x + 1, y + 1, 6, 1);      // highlight top of a brick
    ctx.fillRect(x + 8, y + 8, 3, 1);
  },
  glowstone(ctx, x, y) {
    noisyFill(ctx, x, y, [230, 190, 110], 30, 138);
    speckle(ctx, x, y, 'rgb(255,235,170)', 24, 139, 2);
    speckle(ctx, x, y, 'rgb(180,140,70)', 14, 140);
  },
};

// ---- New utility / storage blocks ----
PAINTERS.furnace_front = (ctx, x, y) => {
  PAINTERS.cobblestone(ctx, x, y);
  ctx.fillStyle = 'rgb(30,30,30)';
  ctx.fillRect(x + 4, y + 8, 8, 6);          // dark opening
  ctx.fillStyle = 'rgb(255,140,30)';
  ctx.fillRect(x + 5, y + 12, 2, 2);         // embers
  ctx.fillRect(x + 9, y + 11, 2, 3);
};
PAINTERS.chest_front = (ctx, x, y) => {
  noisyFill(ctx, x, y, [148, 106, 56], 10, 150);
  ctx.strokeStyle = 'rgb(96,66,30)';
  ctx.strokeRect(x + 0.5, y + 0.5, 15, 15);  // frame
  ctx.fillStyle = 'rgb(96,66,30)';
  ctx.fillRect(x, y + 6, TILE, 1);           // lid seam
  ctx.fillStyle = 'rgb(140,140,140)';
  ctx.fillRect(x + 7, y + 5, 2, 3);          // latch
};
PAINTERS.chest_top = (ctx, x, y) => {
  noisyFill(ctx, x, y, [148, 106, 56], 10, 151);
  ctx.strokeStyle = 'rgb(96,66,30)';
  ctx.strokeRect(x + 0.5, y + 0.5, 15, 15);
};
PAINTERS.coal_block = (ctx, x, y) => {
  noisyFill(ctx, x, y, [38, 38, 38], 12, 152);
  speckle(ctx, x, y, 'rgb(60,60,60)', 14, 153, 2);
};
PAINTERS.iron_block = (ctx, x, y) => {
  noisyFill(ctx, x, y, [216, 216, 216], 8, 154);
  ctx.fillStyle = 'rgb(190,190,190)';
  ctx.fillRect(x, y + 12, TILE, 4);          // beveled bottom edge
  ctx.fillStyle = 'rgb(240,240,240)';
  ctx.fillRect(x, y, TILE, 2);
};
PAINTERS.gold_block = (ctx, x, y) => {
  noisyFill(ctx, x, y, [250, 216, 70], 10, 155);
  ctx.fillStyle = 'rgb(220,180,40)';
  ctx.fillRect(x, y + 12, TILE, 4);
  ctx.fillStyle = 'rgb(255,240,140)';
  ctx.fillRect(x, y, TILE, 2);
};
PAINTERS.diamond_block = (ctx, x, y) => {
  noisyFill(ctx, x, y, [98, 220, 212], 10, 156);
  ctx.fillStyle = 'rgb(70,190,185)';
  ctx.fillRect(x, y + 12, TILE, 4);
  ctx.fillStyle = 'rgb(170,255,250)';
  ctx.fillRect(x, y, TILE, 2);
};

// ---- Item sprites (flat, transparent background) ----
PAINTERS.stick = (ctx, x, y) => {
  ctx.clearRect(x, y, TILE, TILE);
  ctx.fillStyle = 'rgb(104,82,50)';
  for (let i = 0; i < 9; i++) ctx.fillRect(x + 3 + i, y + 12 - i, 2, 2);
};
PAINTERS.coal_item = (ctx, x, y) => {
  ctx.clearRect(x, y, TILE, TILE);
  ctx.fillStyle = 'rgb(40,40,40)';
  ctx.fillRect(x + 4, y + 5, 8, 7);
  ctx.fillRect(x + 6, y + 3, 5, 2);
  ctx.fillRect(x + 3, y + 7, 1, 4);
  ctx.fillStyle = 'rgb(75,75,75)';
  ctx.fillRect(x + 5, y + 5, 2, 2);
};
function ingotPainter(bright, mid, dark) {
  return (ctx, x, y) => {
    ctx.clearRect(x, y, TILE, TILE);
    ctx.fillStyle = mid;
    ctx.fillRect(x + 2, y + 6, 12, 5);       // bar body
    ctx.fillStyle = bright;
    ctx.fillRect(x + 3, y + 5, 11, 2);       // top face
    ctx.fillStyle = dark;
    ctx.fillRect(x + 2, y + 10, 12, 1);      // bottom shade
  };
}
PAINTERS.iron_ingot = ingotPainter('rgb(240,240,240)', 'rgb(205,205,205)', 'rgb(150,150,150)');
PAINTERS.gold_ingot = ingotPainter('rgb(255,240,140)', 'rgb(245,208,60)', 'rgb(190,150,30)');
PAINTERS.diamond_item = (ctx, x, y) => {
  ctx.clearRect(x, y, TILE, TILE);
  ctx.fillStyle = 'rgb(90,220,215)';
  ctx.fillRect(x + 5, y + 4, 6, 3);          // crown
  ctx.fillRect(x + 4, y + 7, 8, 2);
  ctx.fillRect(x + 6, y + 9, 4, 2);          // point
  ctx.fillRect(x + 7, y + 11, 2, 2);
  ctx.fillStyle = 'rgb(190,255,252)';
  ctx.fillRect(x + 6, y + 5, 2, 2);          // sparkle
};

PAINTERS.wool = (ctx, x, y) => {
  noisyFill(ctx, x, y, [235, 235, 235], 12, 160);
  speckle(ctx, x, y, 'rgb(210,210,210)', 20, 161, 2);
  speckle(ctx, x, y, 'rgb(250,250,250)', 14, 162);
};
PAINTERS.bed_top = (ctx, x, y) => {
  // red blanket with a white pillow end
  noisyFill(ctx, x, y, [170, 40, 40], 10, 163);
  ctx.fillStyle = 'rgb(235,235,235)';
  ctx.fillRect(x + 1, y + 1, 14, 4);          // pillow
  ctx.fillStyle = 'rgb(200,200,200)';
  ctx.fillRect(x + 1, y + 4, 14, 1);
  ctx.fillStyle = 'rgb(140,30,30)';
  ctx.fillRect(x + 1, y + 6, 14, 1);          // blanket fold
};
PAINTERS.bed_side = (ctx, x, y) => {
  noisyFill(ctx, x, y, [170, 40, 40], 10, 164);
  ctx.fillStyle = 'rgb(120,90,55)';
  ctx.fillRect(x, y + 10, TILE, 6);           // wooden frame
  ctx.fillStyle = 'rgb(96,70,40)';
  ctx.fillRect(x, y + 10, TILE, 1);
};

// ---- Food sprites ----
function meatPainter(rawR, rawG, rawB, cooked) {
  return (ctx, x, y) => {
    ctx.clearRect(x, y, TILE, TILE);
    const base = cooked ? [146, 92, 50] : [rawR, rawG, rawB];
    ctx.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
    ctx.fillRect(x + 3, y + 5, 10, 7);         // meat body
    ctx.fillRect(x + 5, y + 3, 6, 2);
    ctx.fillStyle = cooked ? 'rgb(180,120,70)' : 'rgb(240,190,190)';
    ctx.fillRect(x + 5, y + 6, 4, 2);          // fat / sear marks
    ctx.fillRect(x + 10, y + 9, 2, 2);
    ctx.fillStyle = cooked ? 'rgb(100,60,30)' : `rgb(${base[0] - 40},${base[1] - 20},${base[2] - 20})`;
    ctx.fillRect(x + 3, y + 11, 10, 1);        // bottom shade
  };
}
PAINTERS.raw_porkchop = meatPainter(240, 130, 140, false);
PAINTERS.cooked_porkchop = meatPainter(0, 0, 0, true);
PAINTERS.raw_beef = meatPainter(200, 60, 60, false);
PAINTERS.steak = meatPainter(0, 0, 0, true);

// ---- Tool sprites: 8×8 pixel maps scaled ×2. H = head, S = handle ----
const TOOL_SHAPES = {
  pickaxe: [
    '.HHHHH..',
    'H..S..H.',
    '...S..H.',
    '...S....',
    '...S....',
    '...S....',
    '...S....',
    '........',
  ],
  axe: [
    '..HH....',
    '.HHHH...',
    '.HHS....',
    '...S....',
    '...S....',
    '...S....',
    '...S....',
    '........',
  ],
  shovel: [
    '...HH...',
    '..HHHH..',
    '..HHHH..',
    '...S....',
    '...S....',
    '...S....',
    '...S....',
    '........',
  ],
  sword: [
    '.....HH.',
    '....HH..',
    '...HH...',
    '..HH....',
    '.SS.....',
    'SS.S....',
    'S.......',
    '........',
  ],
  hoe: [
    '..HHHH..',
    '..H.....',
    '...S....',
    '...S....',
    '...S....',
    '...S....',
    '...S....',
    '........',
  ],
};
const TOOL_TIER_COLORS = {
  wooden:  'rgb(162,130,78)',
  stone:   'rgb(130,130,130)',
  iron:    'rgb(220,220,220)',
  golden:  'rgb(250,216,70)',
  diamond: 'rgb(90,220,215)',
};
for (const [tier, color] of Object.entries(TOOL_TIER_COLORS)) {
  for (const [type, shape] of Object.entries(TOOL_SHAPES)) {
    PAINTERS[`${tier}_${type}`] = (ctx, x, y) => {
      ctx.clearRect(x, y, TILE, TILE);
      shape.forEach((row, ry) => {
        [...row].forEach((ch, rx) => {
          if (ch === '.') return;
          ctx.fillStyle = ch === 'H' ? color : 'rgb(104,82,50)';
          ctx.fillRect(x + rx * 2, y + ry * 2, 2, 2);
        });
      });
    };
  }
}

/** Crack overlay stages (0..4) appended after the named tiles. */
const CRACK_STAGES = 5;

function paintCrack(ctx, x, y, stage) {
  ctx.clearRect(x, y, TILE, TILE);
  const rand = rng(200 + stage);
  ctx.fillStyle = 'rgba(20,20,20,0.85)';
  const cracks = 2 + stage * 2;
  for (let c = 0; c < cracks; c++) {
    // random walk from center outward = crack line
    let px = 8, py = 8;
    const len = 4 + stage * 3;
    for (let i = 0; i < len; i++) {
      ctx.fillRect(x + px, y + py, 1, 1);
      px += Math.floor(rand() * 3) - 1;
      py += Math.floor(rand() * 3) - 1;
      px = Math.max(0, Math.min(15, px));
      py = Math.max(0, Math.min(15, py));
    }
  }
}

/**
 * Builds the atlas. Returns:
 *   texture   — THREE.CanvasTexture (NearestFilter)
 *   uv(name)  — [u0, v0, u1, v1] for a tile name
 *   crackUV(stage), CRACK_STAGES
 *   tileCanvas(name) — standalone 16×16 canvas (for inventory icons)
 */
export function buildAtlas() {
  const names = Object.keys(PAINTERS);
  const total = names.length + CRACK_STAGES;
  const rows = Math.ceil(total / ATLAS_COLS);
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLS * OUT;
  canvas.height = rows * OUT;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // Painters draw at 16×16 on this scratch canvas; each tile is then blitted
  // to 32×32 (crisp nearest-neighbor) and refined with a per-pixel grain pass
  // at full 32× resolution for extra surface detail.
  const scratch = document.createElement('canvas');
  scratch.width = TILE; scratch.height = TILE;
  const sctx = scratch.getContext('2d');

  const blit = (painter, col, row, seed, grain = true) => {
    sctx.clearRect(0, 0, TILE, TILE);
    painter(sctx, 0, 0);
    ctx.clearRect(col * OUT, row * OUT, OUT, OUT);
    ctx.drawImage(scratch, 0, 0, TILE, TILE, col * OUT, row * OUT, OUT, OUT);
    if (!grain) return;
    const img = ctx.getImageData(col * OUT, row * OUT, OUT, OUT);
    const rand = mulberry32(seed);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = (rand() - 0.5) * 16;
      if (d[i + 3] === 0) continue;   // keep transparency (leaves, items)
      d[i]     = Math.max(0, Math.min(255, d[i] + v));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + v));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + v));
    }
    ctx.putImageData(img, col * OUT, row * OUT);
  };

  const index = {};
  names.forEach((name, i) => {
    const col = i % ATLAS_COLS, row = Math.floor(i / ATLAS_COLS);
    blit(PAINTERS[name], col, row, 5000 + i);
    index[name] = [col, row];
  });
  const crackIndex = [];
  for (let s = 0; s < CRACK_STAGES; s++) {
    const i = names.length + s;
    const col = i % ATLAS_COLS, row = Math.floor(i / ATLAS_COLS);
    blit((c, x, y) => paintCrack(c, x, y, s), col, row, 0, false);
    crackIndex.push([col, row]);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;

  const cols = ATLAS_COLS;
  function tileUV([col, row]) {
    // tiny inset avoids atlas bleeding at tile edges
    const e = 0.02 / OUT;
    const u0 = col / cols + e, v1 = 1 - row / rows - e;
    const u1 = (col + 1) / cols - e, v0 = 1 - (row + 1) / rows + e;
    return [u0, v0, u1, v1];
  }

  return {
    texture,
    CRACK_STAGES,
    uv: (name) => tileUV(index[name] || index.stone),
    crackUV: (stage) => tileUV(crackIndex[Math.max(0, Math.min(CRACK_STAGES - 1, stage))]),
    tileCanvas(name) {
      const c = document.createElement('canvas');
      c.width = OUT; c.height = OUT;
      const [col, row] = index[name] || index.stone;
      c.getContext('2d').drawImage(canvas, col * OUT, row * OUT, OUT, OUT, 0, 0, OUT, OUT);
      return c;
    },
  };
}
