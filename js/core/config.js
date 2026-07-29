/**
 * Global game configuration. Tweak values here to rebalance the game —
 * every other module imports from this single source of truth.
 */
export const CONFIG = {
  // ---- World ----
  CHUNK_SIZE: 16,          // blocks per chunk on X/Z
  WORLD_HEIGHT: 256,       // blocks per chunk on Y
  SEA_LEVEL: 62,
  BEDROCK_LEVEL: 0,

  // ---- Streaming ----
  RENDER_DISTANCE: 6,      // chunks (runtime-adjustable via settings)
  CHUNKS_PER_FRAME: 2,     // max chunk meshes built per frame (stutter control)

  // ---- Player ----
  PLAYER_HEIGHT: 1.8,
  PLAYER_EYE: 1.62,
  PLAYER_WIDTH: 0.6,
  WALK_SPEED: 4.3,
  SPRINT_SPEED: 6.5,
  CROUCH_SPEED: 1.8,
  FLY_SPEED: 11,
  JUMP_VELOCITY: 8.4,
  GRAVITY: -26,
  WATER_DRAG: 0.55,        // multiplier applied to speed while in water
  FALL_DAMAGE_MIN: 4,      // blocks fallen before damage starts
  REACH: 5,                // block interaction distance

  // ---- Time ----
  DAY_LENGTH: 600,         // seconds for a full day/night cycle

  // ---- Persistence ----
  AUTOSAVE_INTERVAL: 60,   // seconds
  SAVE_KEY: 'voxelcraft_world',
  SETTINGS_KEY: 'voxelcraft_settings',
};
