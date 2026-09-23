import { CONFIG } from '../config.js';
import { FURNITURE_TYPES, createFurniture, createCollectible } from './furniture.js';
import { clamp, lerp } from '../utils.js';

/**
 * Owns furniture/collectible generation. Two things are deliberately
 * decoupled here, per the brief's "do not simply increase obstacle density
 * whenever the player moves faster":
 *   - DIFFICULTY (how often rows spawn, which furniture types are in the
 *     pool) ramps with *distance travelled*, on a fixed schedule.
 *   - SPEED (how fast the player is currently moving) comes entirely from
 *     movement energy (see movementEnergy.js) and has no influence on how
 *     often furniture spawns.
 * Speed DOES influence the *spacing* required between rows (a faster
 * player needs more physical distance to react/act in), but that spacing
 * is computed from CONFIG.MAX_SPEED — the worst case — rather than the
 * player's current speed. This means the fairness guarantee holds even if
 * the player accelerates hard immediately after a row spawns; it costs a
 * little potential density at low speed in exchange for never needing to
 * reason about "what if they speed up before this arrives."
 *
 * FAIRNESS GUARANTEE:
 * 1. A row never blocks every lane (CONFIG.MAX_BLOCKED_LANES < LANE_COUNT),
 *    so there's always at least one lane needing zero action.
 * 2. Rows only ever spawn at exactly z = CONFIG.Z_FAR (never further back —
 *    spawning beyond the visible depth range would leave that furniture
 *    pinned at the horizon by the perspective projection until enough
 *    distance had "caught up," which reads as popping in and then
 *    suddenly lurching into motion). If the previous row hasn't yet moved
 *    far enough away to leave the required worst-case gap, _trySpawnRow
 *    simply declines, and the caller retries a few frames later.
 */
export class Spawner {
  constructor() {
    this.reset();
  }

  reset() {
    this.distanceMeters = 0;
    this.furniture = [];
    this.collectibles = [];
    this._spawnCooldown = CONFIG.SPAWN_INTERVAL_START;
  }

  /** @param {number} speed current world-units/second, from the energy-driven speed model */
  update(dt, speed) {
    this.distanceMeters += speed * dt * CONFIG.DISTANCE_TO_METERS;

    this._spawnCooldown -= dt;
    if (this._spawnCooldown <= 0) {
      const spawned = this._trySpawnRow();
      this._spawnCooldown = spawned ? this._currentSpawnInterval() : 0.05;
    }

    for (const f of this.furniture) {
      f.z -= speed * dt;
      f.age += dt;
    }
    for (const c of this.collectibles) {
      c.z -= speed * dt;
      c.age += dt;
    }

    this.furniture = this.furniture.filter((f) => f.z > -300);
    this.collectibles = this.collectibles.filter((c) => c.z > -300 && !c.collected);
  }

  _currentSpawnInterval() {
    const t = clamp(this.distanceMeters / CONFIG.DIFFICULTY_RAMP_METERS, 0, 1);
    return lerp(CONFIG.SPAWN_INTERVAL_START, CONFIG.SPAWN_INTERVAL_MIN, t);
  }

  _availableTypes() {
    const types = [FURNITURE_TYPES.OTTOMAN];
    if (this.distanceMeters >= CONFIG.UNLOCK_TALL_METERS) types.push(FURNITURE_TYPES.TALL);
    if (this.distanceMeters >= CONFIG.UNLOCK_TABLE_METERS) types.push(FURNITURE_TYPES.TABLE);
    return types;
  }

  _minRowGapZ() {
    // Computed from MAX_SPEED (the worst case), not current speed — see
    // class comment for why this must never shrink just because the
    // player happens to be moving slowly right now.
    const worstActionTime = Math.max(
      CONFIG.ACTION_DURATION.jump,
      CONFIG.ACTION_DURATION.slide,
      CONFIG.ACTION_DURATION.lane * 2
    );
    const requiredTime = CONFIG.REACTION_TIME + worstActionTime + CONFIG.SPAWN_SAFETY_BUFFER;
    return Math.max(CONFIG.MIN_SPAWN_GAP_Z, CONFIG.MAX_SPEED * requiredTime);
  }

  /** @returns {boolean} whether a row was actually spawned this call */
  _trySpawnRow() {
    const lastZ = this.furniture.reduce((max, f) => Math.max(max, f.z), -Infinity);
    const minGap = this._minRowGapZ();
    if (lastZ > -Infinity && CONFIG.Z_FAR - lastZ < minGap) {
      return false;
    }

    const laneCount = CONFIG.LANE_COUNT;
    const maxBlocked = Math.min(CONFIG.MAX_BLOCKED_LANES, laneCount - 1);
    const blockedCount = Math.floor(Math.random() * (maxBlocked + 1));
    const lanes = shuffle([...Array(laneCount).keys()]);
    const blockedLanes = lanes.slice(0, blockedCount);
    const clearLanes = lanes.slice(blockedCount);

    const types = this._availableTypes();
    const spawnZ = CONFIG.Z_FAR;

    for (const lane of blockedLanes) {
      const type = types[Math.floor(Math.random() * types.length)];
      this.furniture.push(createFurniture(type, lane, spawnZ));
    }

    if (clearLanes.length > 0) {
      const rewardLane = clearLanes[Math.floor(Math.random() * clearLanes.length)];
      this.collectibles.push(createCollectible(rewardLane, spawnZ - 60));
    }
    if (blockedLanes.length > 0 && Math.random() < 0.4) {
      const riskLane = blockedLanes[Math.floor(Math.random() * blockedLanes.length)];
      this.collectibles.push(createCollectible(riskLane, spawnZ));
    }
    return true;
  }
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
