/**
 * Procedural terrain generator.
 *
 * Deterministic per seed: height, biome, caves, ores and trees are all pure
 * functions of world coordinates, so chunks can be generated in any order
 * (and re-generated identically when a saved world reloads).
 *
 * Layers:
 *  - continentalness  → oceans vs land
 *  - erosion + peaks  → plains / hills / mountains
 *  - temperature/moisture → biome selection (desert, forest, snow, plains)
 *  - 3D fractal noise → caves
 *  - depth-gated 3D noise → ore veins
 */

import { CONFIG } from '../core/config.js';
import { BLOCK } from '../core/blocks.js';
import { SimplexNoise } from '../core/noise.js';

export const BIOME = {
  OCEAN: 'Ocean',
  RIVER: 'River',
  BEACH: 'Beach',
  PLAINS: 'Plains',
  FOREST: 'Forest',
  DESERT: 'Desert',
  HILLS: 'Hills',
  MOUNTAINS: 'Mountains',
  SNOW: 'Snowy Tundra',
};

const { CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL } = CONFIG;

/** 2D integer hash → [0,1). Used for deterministic feature placement. */
function hash2D(x, z, seed) {
  let h = seed ^ Math.imul(x, 374761393) ^ Math.imul(z, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class WorldGen {
  constructor(seed = 12345) {
    this.seed = seed;
    this.heightNoise  = new SimplexNoise(seed);
    this.detailNoise  = new SimplexNoise(seed + 1);
    this.tempNoise    = new SimplexNoise(seed + 2);
    this.moistNoise   = new SimplexNoise(seed + 3);
    this.caveNoise    = new SimplexNoise(seed + 4);
    this.oreNoise     = new SimplexNoise(seed + 5);
    this.riverNoise   = new SimplexNoise(seed + 6);
    this.continent    = new SimplexNoise(seed + 7);

    // Per-column caches — cleared automatically as columns are cheap to recompute,
    // these just avoid re-deriving the same column 256 times inside one chunk.
    this._colCache = new Map();
  }

  /** Continentalness in [-1,1]: negative = ocean, positive = inland. */
  continentalness(x, z) {
    return this.continent.fractal2D(x, z, 3, 1 / 900);
  }

  /** River factor: near 0 = river channel. */
  riverFactor(x, z) {
    return Math.abs(this.riverNoise.fractal2D(x, z, 2, 1 / 600));
  }

  /** Terrain surface height (integer Y) for a world column. */
  getHeight(x, z) {
    const cont = this.continentalness(x, z);
    const base = this.heightNoise.fractal2D(x, z, 4, 1 / 320);       // rolling terrain
    const detail = this.detailNoise.fractal2D(x, z, 3, 1 / 60) * 0.3; // small bumps
    const peaks = Math.pow(Math.max(0, this.detailNoise.fractal2D(x + 5000, z - 5000, 4, 1 / 500) + 0.25), 2.4); // mountain mask

    let h = SEA_LEVEL + 4;
    h += cont * 22;                     // continents raise / oceans sink
    h += (base + detail) * 14;          // hills
    h += peaks * 85 * Math.max(0, cont + 0.2); // mountains only inland

    // Carve river valleys down to just below sea level on land
    const river = this.riverFactor(x, z);
    if (cont > -0.1 && river < 0.045) {
      const depth = (1 - river / 0.045) * 8;
      h = Math.min(h, SEA_LEVEL + 3 - depth);
    }
    return Math.max(4, Math.min(WORLD_HEIGHT - 20, Math.floor(h)));
  }

  /** Biome for a world column (uses the column's height). */
  getBiome(x, z, height = null) {
    const h = height ?? this.getHeight(x, z);
    const cont = this.continentalness(x, z);
    if (h < SEA_LEVEL - 2) return cont < -0.25 ? BIOME.OCEAN : BIOME.RIVER;
    if (h <= SEA_LEVEL + 1) return BIOME.BEACH;

    const temp  = this.tempNoise.fractal2D(x, z, 3, 1 / 800);
    const moist = this.moistNoise.fractal2D(x, z, 3, 1 / 700);

    if (h > SEA_LEVEL + 48) return BIOME.SNOW;         // snow-capped peaks
    if (temp < -0.32) return BIOME.SNOW;
    if (h > SEA_LEVEL + 30) return BIOME.MOUNTAINS;
    if (temp > 0.35 && moist < 0.05) return BIOME.DESERT;
    if (h > SEA_LEVEL + 22) return BIOME.HILLS;
    if (moist > 0.12) return BIOME.FOREST;
    return BIOME.PLAINS;
  }

  /** True if a cave is carved at this world position. */
  isCave(x, y, z) {
    if (y < 6 || y > 140) return false;
    // Two 3D noise fields intersected → winding tunnel systems
    const a = this.caveNoise.fractal3D(x, y * 1.6, z, 2, 1 / 60);
    const b = this.caveNoise.fractal3D(x + 3000, y * 1.6, z + 3000, 2, 1 / 60);
    return a * a + b * b < 0.012;
  }

  /** Ore for a stone position, or 0. Realistic depth gating. */
  oreAt(x, y, z) {
    const n = this.oreNoise.noise3D(x / 7, y / 7, z / 7);
    const n2 = this.oreNoise.noise3D(x / 5 + 900, y / 5, z / 5 - 900);
    if (y < 18 && n > 0.78 && n2 > 0.3) return BLOCK.DIAMOND_ORE;
    if (y < 34 && n > 0.74 && n2 < -0.3) return BLOCK.GOLD_ORE;
    if (y < 66 && n > 0.68 && n2 > 0.2) return BLOCK.IRON_ORE;
    if (y < 130 && n > 0.64 && n2 < -0.2) return BLOCK.COAL_ORE;
    return 0;
  }

  /** Cached per-column data (height + biome). */
  column(x, z) {
    const key = x + '|' + z;
    let c = this._colCache.get(key);
    if (!c) {
      const height = this.getHeight(x, z);
      c = { height, biome: this.getBiome(x, z, height) };
      this._colCache.set(key, c);
      if (this._colCache.size > 8192) this._colCache.clear();
    }
    return c;
  }

  /** Surface block layers for a biome. */
  surfaceBlocks(biome) {
    switch (biome) {
      case BIOME.DESERT: return { top: BLOCK.SAND, under: BLOCK.SAND, deep: BLOCK.SANDSTONE };
      case BIOME.BEACH:  return { top: BLOCK.SAND, under: BLOCK.SAND, deep: BLOCK.SANDSTONE };
      case BIOME.SNOW:   return { top: BLOCK.SNOW_GRASS, under: BLOCK.DIRT, deep: BLOCK.STONE };
      case BIOME.MOUNTAINS: return { top: BLOCK.STONE, under: BLOCK.STONE, deep: BLOCK.STONE };
      case BIOME.OCEAN:
      case BIOME.RIVER:  return { top: BLOCK.GRAVEL, under: BLOCK.DIRT, deep: BLOCK.STONE };
      default:           return { top: BLOCK.GRASS, under: BLOCK.DIRT, deep: BLOCK.STONE };
    }
  }

  /** Deterministic tree test for a world column. */
  hasTree(x, z) {
    const { biome, height } = this.column(x, z);
    if (height <= SEA_LEVEL + 1) return false;
    const r = hash2D(x, z, this.seed);
    if (biome === BIOME.FOREST) return r < 0.02;
    if (biome === BIOME.PLAINS || biome === BIOME.HILLS) return r < 0.003;
    if (biome === BIOME.SNOW) return r < 0.004;
    return false;
  }

  treeHeight(x, z) {
    return 4 + Math.floor(hash2D(x, z, this.seed ^ 0xABCD) * 3);
  }

  /**
   * Fill a chunk's block array. `setBlock(lx, y, lz, id)` writes local coords.
   */
  generateChunk(cx, cz, setBlock) {
    const x0 = cx * CHUNK_SIZE, z0 = cz * CHUNK_SIZE;

    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = x0 + lx, wz = z0 + lz;
        const { height, biome } = this.column(wx, wz);
        const surf = this.surfaceBlocks(biome);

        for (let y = 0; y <= Math.max(height, SEA_LEVEL); y++) {
          let id = BLOCK.AIR;

          if (y <= 1 + Math.floor(hash2D(wx ^ y, wz, this.seed) * 3)) {
            id = BLOCK.BEDROCK;                       // uneven bedrock floor
          } else if (y <= height) {
            if (y === height)            id = surf.top;
            else if (y >= height - 3)    id = surf.under;
            else                         id = this.oreAt(wx, y, wz) || surf.deep;

            // Carve caves (never through bedrock; don't breach below sea under water)
            if (id !== BLOCK.BEDROCK && this.isCave(wx, y, wz)) {
              const underwater = height < SEA_LEVEL && y > height - 4;
              if (!underwater) id = BLOCK.AIR;
            }
          } else if (y <= SEA_LEVEL) {
            id = BLOCK.WATER;                          // oceans / rivers / lakes
          }

          if (id !== BLOCK.AIR) setBlock(lx, y, lz, id);
        }
      }
    }

    // Trees — scan a margin so canopies from neighboring columns render in
    // this chunk too (features must not pop at chunk borders).
    const M = 2;
    for (let lz = -M; lz < CHUNK_SIZE + M; lz++) {
      for (let lx = -M; lx < CHUNK_SIZE + M; lx++) {
        const wx = x0 + lx, wz = z0 + lz;
        if (!this.hasTree(wx, wz)) continue;
        const { height } = this.column(wx, wz);
        if (this.isCave(wx, height, wz)) continue;
        const th = this.treeHeight(wx, wz);
        this.placeTree(lx, height + 1, lz, th, setBlock);
      }
    }
  }

  /** Writes a tree with trunk base at local (lx, y, lz); clips to the chunk. */
  placeTree(lx, y, lz, height, setBlock) {
    const put = (x, yy, z, id) => {
      if (x >= 0 && x < CHUNK_SIZE && z >= 0 && z < CHUNK_SIZE && yy > 0 && yy < WORLD_HEIGHT) {
        setBlock(x, yy, z, id, true /* soft: don't overwrite terrain */);
      }
    };
    // canopy: two 5×5-ish layers + 3×3 cap
    for (let dy = height - 2; dy <= height + 1; dy++) {
      const r = dy > height - 1 ? 1 : 2;
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.abs(dx) === r && Math.abs(dz) === r && dy <= height) continue; // rounded corners
          if (dx === 0 && dz === 0 && dy < height) continue;                       // trunk goes here
          put(lx + dx, y + dy, lz + dz, BLOCK.LEAVES);
        }
      }
    }
    for (let dy = 0; dy < height; dy++) put(lx, y + dy, lz, BLOCK.LOG);
  }
}
