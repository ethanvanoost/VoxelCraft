/**
 * Crafting recipes — every Minecraft recipe expressible with the materials
 * that exist in VoxelCraft, with authentic shapes and yields
 * (reference: minecraft.tools/en/crafting.php).
 *
 * Recipes that need farming, mobs, redstone or nether materials (bread, beds,
 * TNT, rails, ...) are omitted until those materials exist in the world.
 *
 * Two kinds:
 *  - shapeless: { shapeless: [ids...], result }  — any arrangement
 *  - shaped:    { shape: [[row], [row]], result } — exact pattern (0 = empty),
 *               matched anywhere in the grid (position-independent)
 *
 * A craft consumes ONE item from every occupied grid cell.
 */

import { BLOCK, ITEM, TOOL_TIERS } from './blocks.js';

const { LOG, PLANKS, SAND, SANDSTONE, STONE, STONE_BRICKS, COBBLESTONE,
        CRAFTING_TABLE, FURNACE, CHEST, WOOL, BED,
        COAL_BLOCK, IRON_BLOCK, GOLD_BLOCK, DIAMOND_BLOCK } = BLOCK;
const { STICK, COAL, IRON_INGOT, GOLD_INGOT, DIAMOND } = ITEM;

/** What each tool tier is crafted from. */
const TOOL_MATERIAL = {
  wooden: PLANKS,
  stone: COBBLESTONE,      // stone tools use cobblestone, like Minecraft
  iron: IRON_INGOT,
  golden: GOLD_INGOT,
  diamond: DIAMOND,
};

/** Tool patterns as functions of (M)aterial and (S)tick. */
const TOOL_PATTERNS = {
  pickaxe: (M, S) => [[[M, M, M], [0, S, 0], [0, S, 0]]],
  shovel:  (M, S) => [[[M], [S], [S]]],
  sword:   (M, S) => [[[M], [M], [S]]],
  // axe and hoe are asymmetric — both mirror orientations are valid
  axe: (M, S) => [
    [[M, M], [M, S], [0, S]],
    [[M, M], [S, M], [S, 0]],
  ],
  hoe: (M, S) => [
    [[M, M], [0, S], [0, S]],
    [[M, M], [S, 0], [S, 0]],
  ],
};

export const RECIPES = [
  // ---------------- Wood ----------------
  { shapeless: [LOG], result: { id: PLANKS, count: 4 } },
  { shape: [[PLANKS], [PLANKS]], result: { id: STICK, count: 4 } },
  { shape: [[PLANKS, PLANKS], [PLANKS, PLANKS]], result: { id: CRAFTING_TABLE, count: 1 } },
  { shape: [
      [PLANKS, PLANKS, PLANKS],
      [PLANKS, 0,      PLANKS],
      [PLANKS, PLANKS, PLANKS],
    ], result: { id: CHEST, count: 1 } },

  // ---------------- Stone ----------------
  { shape: [
      [COBBLESTONE, COBBLESTONE, COBBLESTONE],
      [COBBLESTONE, 0,           COBBLESTONE],
      [COBBLESTONE, COBBLESTONE, COBBLESTONE],
    ], result: { id: FURNACE, count: 1 } },
  { shape: [[STONE, STONE], [STONE, STONE]], result: { id: STONE_BRICKS, count: 4 } },
  { shape: [[SAND, SAND], [SAND, SAND]], result: { id: SANDSTONE, count: 1 } },

  // Bed — authentic recipe: 3 wool over 3 planks (needs a crafting table)
  { shape: [
      [WOOL, WOOL, WOOL],
      [PLANKS, PLANKS, PLANKS],
    ], result: { id: BED, count: 1 } },

  // ---------------- Mineral storage blocks (9 ↔ block) ----------------
  { shape: fill3x3(COAL), result: { id: COAL_BLOCK, count: 1 } },
  { shape: fill3x3(IRON_INGOT), result: { id: IRON_BLOCK, count: 1 } },
  { shape: fill3x3(GOLD_INGOT), result: { id: GOLD_BLOCK, count: 1 } },
  { shape: fill3x3(DIAMOND), result: { id: DIAMOND_BLOCK, count: 1 } },
  { shapeless: [COAL_BLOCK], result: { id: COAL, count: 9 } },
  { shapeless: [IRON_BLOCK], result: { id: IRON_INGOT, count: 9 } },
  { shapeless: [GOLD_BLOCK], result: { id: GOLD_INGOT, count: 9 } },
  { shapeless: [DIAMOND_BLOCK], result: { id: DIAMOND, count: 9 } },
];

// ---------------- Tools: 5 tiers × 5 types ----------------
for (const tier of TOOL_TIERS) {
  const M = TOOL_MATERIAL[tier];
  for (const [type, patterns] of Object.entries(TOOL_PATTERNS)) {
    const itemId = ITEM[`${tier.toUpperCase()}_${type.toUpperCase()}`];
    for (const shape of patterns(M, STICK)) {
      RECIPES.push({ shape, result: { id: itemId, count: 1 } });
    }
  }
}

function fill3x3(id) {
  return [[id, id, id], [id, id, id], [id, id, id]];
}

/**
 * Match the crafting grid against all recipes.
 * @param cells flat array (size*size) of ids, 0/undefined = empty
 * @param size  2 or 3
 * @returns result {id, count} or null
 */
export function matchRecipe(cells, size) {
  // Collect occupied cells + bounding box
  const items = [];
  let minR = size, minC = size, maxR = -1, maxC = -1;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const id = cells[r * size + c] || 0;
      if (id) {
        items.push(id);
        minR = Math.min(minR, r); maxR = Math.max(maxR, r);
        minC = Math.min(minC, c); maxC = Math.max(maxC, c);
      }
    }
  }
  if (items.length === 0) return null;

  for (const recipe of RECIPES) {
    if (recipe.shapeless) {
      if (sameMultiset(items, recipe.shapeless)) return { ...recipe.result };
    } else {
      const shape = recipe.shape;
      const h = shape.length, w = shape[0].length;
      if (h > size || w > size) continue;                       // needs a bigger grid
      if (maxR - minR + 1 !== h || maxC - minC + 1 !== w) continue;
      let ok = true;
      for (let r = 0; r < h && ok; r++) {
        for (let c = 0; c < w && ok; c++) {
          const id = cells[(minR + r) * size + (minC + c)] || 0;
          if (id !== (shape[r][c] || 0)) ok = false;
        }
      }
      if (ok) return { ...recipe.result };
    }
  }
  return null;
}

function sameMultiset(a, b) {
  if (a.length !== b.length) return false;
  const sa = [...a].sort(), sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}
