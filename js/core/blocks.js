/**
 * Block registry.
 *
 * To add a new block:
 *   1. Add an entry to BLOCK (unique numeric id, ids must stay < 256).
 *   2. Register it in BLOCK_DEFS with its per-face texture tile names.
 *   3. Add tile painters for any new textures in textures.js.
 * Everything else (meshing, inventory icons, mining, saving) picks it up
 * automatically.
 */

export const BLOCK = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  GRAVEL: 5,
  SNOW: 6,
  WATER: 7,
  BEDROCK: 8,
  LOG: 9,
  LEAVES: 10,
  PLANKS: 11,
  COAL_ORE: 12,
  IRON_ORE: 13,
  GOLD_ORE: 14,
  DIAMOND_ORE: 15,
  SANDSTONE: 16,
  COBBLESTONE: 17,
  GLOWSTONE: 18,
  SNOW_GRASS: 19,
  CRAFTING_TABLE: 20,
  STONE_BRICKS: 21,
  FURNACE: 22,
  CHEST: 23,
  COAL_BLOCK: 24,
  IRON_BLOCK: 25,
  GOLD_BLOCK: 26,
  DIAMOND_BLOCK: 27,
};

/**
 * Non-placeable items (crafting materials + tools). Ids start at 256 so
 * `id < 256` cleanly separates blocks from items everywhere.
 */
export const ITEM = {
  STICK: 256,
  COAL: 257,
  IRON_INGOT: 258,
  GOLD_INGOT: 259,
  DIAMOND: 260,
};

/**
 * Per-block definition.
 *  tex:        {top, bottom, side} tile names in the atlas (see textures.js)
 *  solid:      participates in collision
 *  opaque:     hides neighboring faces (face culling)
 *  hardness:   seconds to mine (0 = instant, Infinity = unbreakable)
 *  sound:      footstep/dig sound family for the audio engine
 *  emissive:   0..1 self-illumination (torch-like blocks)
 */
export const BLOCK_DEFS = {
  [BLOCK.AIR]:        { name: 'Air',          solid: false, opaque: false, hardness: 0 },
  [BLOCK.GRASS]:      { name: 'Grass Block',  tex: { top: 'grass_top', bottom: 'dirt', side: 'grass_side' }, solid: true, opaque: true, hardness: 0.6, sound: 'grass', drops: 2 /* dirt */ },
  [BLOCK.DIRT]:       { name: 'Dirt',         tex: { all: 'dirt' }, solid: true, opaque: true, hardness: 0.5, sound: 'grass' },
  [BLOCK.STONE]:      { name: 'Stone',        tex: { all: 'stone' }, solid: true, opaque: true, hardness: 1.5, sound: 'stone', drops: 17 /* cobblestone */ },
  [BLOCK.SAND]:       { name: 'Sand',         tex: { all: 'sand' }, solid: true, opaque: true, hardness: 0.5, sound: 'sand' },
  [BLOCK.GRAVEL]:     { name: 'Gravel',       tex: { all: 'gravel' }, solid: true, opaque: true, hardness: 0.6, sound: 'sand' },
  [BLOCK.SNOW]:       { name: 'Snow Block',   tex: { all: 'snow' }, solid: true, opaque: true, hardness: 0.2, sound: 'snow' },
  [BLOCK.WATER]:      { name: 'Water',        tex: { all: 'water' }, solid: false, opaque: false, hardness: Infinity, sound: 'water', liquid: true },
  [BLOCK.BEDROCK]:    { name: 'Bedrock',      tex: { all: 'bedrock' }, solid: true, opaque: true, hardness: Infinity, sound: 'stone' },
  [BLOCK.LOG]:        { name: 'Oak Log',      tex: { top: 'log_top', bottom: 'log_top', side: 'log_side' }, solid: true, opaque: true, hardness: 2, sound: 'wood' },
  [BLOCK.LEAVES]:     { name: 'Oak Leaves',   tex: { all: 'leaves' }, solid: true, opaque: false, hardness: 0.2, sound: 'grass' },
  [BLOCK.PLANKS]:     { name: 'Oak Planks',   tex: { all: 'planks' }, solid: true, opaque: true, hardness: 2, sound: 'wood' },
  [BLOCK.COAL_ORE]:   { name: 'Coal Ore',     tex: { all: 'coal_ore' }, solid: true, opaque: true, hardness: 3, sound: 'stone' },
  [BLOCK.IRON_ORE]:   { name: 'Iron Ore',     tex: { all: 'iron_ore' }, solid: true, opaque: true, hardness: 3, sound: 'stone' },
  [BLOCK.GOLD_ORE]:   { name: 'Gold Ore',     tex: { all: 'gold_ore' }, solid: true, opaque: true, hardness: 3, sound: 'stone' },
  [BLOCK.DIAMOND_ORE]:{ name: 'Diamond Ore',  tex: { all: 'diamond_ore' }, solid: true, opaque: true, hardness: 3, sound: 'stone' },
  [BLOCK.SANDSTONE]:  { name: 'Sandstone',    tex: { all: 'sandstone' }, solid: true, opaque: true, hardness: 0.8, sound: 'stone' },
  [BLOCK.COBBLESTONE]:{ name: 'Cobblestone',  tex: { all: 'cobblestone' }, solid: true, opaque: true, hardness: 2, sound: 'stone' },
  [BLOCK.GLOWSTONE]:  { name: 'Glowstone',    tex: { all: 'glowstone' }, solid: true, opaque: true, hardness: 0.3, sound: 'stone', emissive: 1 },
  [BLOCK.SNOW_GRASS]: { name: 'Snowy Grass',  tex: { top: 'snow', bottom: 'dirt', side: 'snow_side' }, solid: true, opaque: true, hardness: 0.6, sound: 'snow', drops: 2 },
  [BLOCK.CRAFTING_TABLE]: { name: 'Crafting Table', tex: { top: 'crafting_top', bottom: 'planks', side: 'crafting_side' }, solid: true, opaque: true, hardness: 2, sound: 'wood' },
  [BLOCK.STONE_BRICKS]: { name: 'Stone Bricks', tex: { all: 'stone_bricks' }, solid: true, opaque: true, hardness: 2, sound: 'stone' },
  [BLOCK.FURNACE]:    { name: 'Furnace',       tex: { top: 'cobblestone', bottom: 'cobblestone', side: 'furnace_front' }, solid: true, opaque: true, hardness: 3.5, sound: 'stone' },
  [BLOCK.CHEST]:      { name: 'Chest',         tex: { top: 'chest_top', bottom: 'chest_top', side: 'chest_front' }, solid: true, opaque: true, hardness: 2.5, sound: 'wood' },
  [BLOCK.COAL_BLOCK]: { name: 'Block of Coal', tex: { all: 'coal_block' }, solid: true, opaque: true, hardness: 5, sound: 'stone' },
  [BLOCK.IRON_BLOCK]: { name: 'Block of Iron', tex: { all: 'iron_block' }, solid: true, opaque: true, hardness: 5, sound: 'stone' },
  [BLOCK.GOLD_BLOCK]: { name: 'Block of Gold', tex: { all: 'gold_block' }, solid: true, opaque: true, hardness: 3, sound: 'stone' },
  [BLOCK.DIAMOND_BLOCK]: { name: 'Block of Diamond', tex: { all: 'diamond_block' }, solid: true, opaque: true, hardness: 5, sound: 'stone' },
};

/**
 * Item definitions. Tools carry {type, speed}: the mining-speed multiplier
 * applied when the tool type matches the block's tool class.
 */
export const ITEM_DEFS = {
  [ITEM.STICK]:      { name: 'Stick',      icon: 'stick' },
  [ITEM.COAL]:       { name: 'Coal',       icon: 'coal_item' },
  [ITEM.IRON_INGOT]: { name: 'Iron Ingot', icon: 'iron_ingot' },
  [ITEM.GOLD_INGOT]: { name: 'Gold Ingot', icon: 'gold_ingot' },
  [ITEM.DIAMOND]:    { name: 'Diamond',    icon: 'diamond_item' },
};

export const TOOL_TIERS = ['wooden', 'stone', 'iron', 'golden', 'diamond'];
export const TOOL_TYPES = ['pickaxe', 'axe', 'shovel', 'sword', 'hoe'];
const TOOL_SPEED = { wooden: 2, stone: 4, iron: 6, golden: 12, diamond: 8 };

// Generate the 25 tool items (ids 300..324), e.g. ITEM.DIAMOND_PICKAXE
{
  let id = 300;
  for (const tier of TOOL_TIERS) {
    for (const type of TOOL_TYPES) {
      ITEM[`${tier.toUpperCase()}_${type.toUpperCase()}`] = id;
      ITEM_DEFS[id] = {
        name: `${tier[0].toUpperCase() + tier.slice(1)} ${type[0].toUpperCase() + type.slice(1)}`,
        icon: `${tier}_${type}`,
        stack: 1,
        tool: { type, speed: TOOL_SPEED[tier] },
      };
      id++;
    }
  }
}

// Ore drops: mining an ore yields its refined material directly
// (simplified — no smelting step yet).
BLOCK_DEFS[BLOCK.COAL_ORE].drops = ITEM.COAL;
BLOCK_DEFS[BLOCK.IRON_ORE].drops = ITEM.IRON_INGOT;
BLOCK_DEFS[BLOCK.GOLD_ORE].drops = ITEM.GOLD_INGOT;
BLOCK_DEFS[BLOCK.DIAMOND_ORE].drops = ITEM.DIAMOND;

/** Unified lookup: works for both block and item ids. */
export function itemDef(id) {
  return id >= 256 ? (ITEM_DEFS[id] || { name: '?' }) : blockDef(id);
}

/** Max stack size for an id (tools don't stack). */
export function maxStack(id) { return itemDef(id).stack ?? 64; }

/** Only blocks (id < 256) can be placed in the world. */
export function isPlaceable(id) { return id < 256; }

/** Which tool class mines a block efficiently, derived from its material. */
export function toolClassFor(blockId) {
  switch (blockDef(blockId).sound) {
    case 'stone': return 'pickaxe';
    case 'wood':  return 'axe';
    case 'grass': case 'sand': case 'snow': return 'shovel';
    default: return null;
  }
}

/** Blocks that appear in the creative/default inventory. */
export const INVENTORY_BLOCKS = [
  BLOCK.GRASS, BLOCK.DIRT, BLOCK.STONE, BLOCK.COBBLESTONE, BLOCK.SAND,
  BLOCK.GRAVEL, BLOCK.SNOW, BLOCK.SANDSTONE, BLOCK.LOG, BLOCK.PLANKS,
  BLOCK.LEAVES, BLOCK.GLOWSTONE, BLOCK.COAL_ORE, BLOCK.IRON_ORE,
  BLOCK.GOLD_ORE, BLOCK.DIAMOND_ORE, BLOCK.BEDROCK, BLOCK.WATER,
];

export function blockDef(id) { return BLOCK_DEFS[id] || BLOCK_DEFS[BLOCK.AIR]; }
export function isOpaque(id)  { return !!blockDef(id).opaque; }
export function isSolid(id)   { return !!blockDef(id).solid; }
export function isLiquid(id)  { return !!blockDef(id).liquid; }

/** Face texture tile name for a block id and face key ('top'|'bottom'|'side'). */
export function faceTile(id, face) {
  const tex = blockDef(id).tex;
  if (!tex) return 'stone';
  return tex.all || tex[face] || tex.side || tex.top;
}

/** What item a block drops when mined. */
export function blockDrop(id) {
  const def = blockDef(id);
  return def.drops !== undefined ? def.drops : id;
}
