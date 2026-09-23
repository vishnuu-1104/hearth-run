import { CONFIG } from '../config.js';
import { FURNITURE_DEFS } from './furniture.js';

/**
 * Checks the player's current hitbox against nearby furniture/collectibles.
 * Fairness note: furniture only "counts" while its z falls inside
 * COLLISION_Z_WINDOW around the player — a small forgiving margin so a
 * jump timed a frame or two early/late still reads as fair (the same
 * "coyote time"-style tolerance used throughout the genre).
 *
 * @returns {{hit: boolean, hitType?: string, collectedIds: number[]}}
 */
export function checkCollisions(player, spawner) {
  const hitbox = player.getHitbox();
  const collectedIds = [];

  for (const item of spawner.furniture) {
    if (item.lane !== player.lane) continue;
    if (Math.abs(item.z) > CONFIG.COLLISION_Z_WINDOW) continue;

    const def = FURNITURE_DEFS[item.type];
    const verticalOverlap = hitbox.bottom < def.top && hitbox.top > def.bottom;
    if (!verticalOverlap) continue;

    // The player's hitbox already reflects jump state (see player.js), so
    // "did they clear it" and "did they hit it" are the same overlap test —
    // no separate per-furniture-type branch needed.
    return { hit: true, hitType: item.type, collectedIds };
  }

  for (const c of spawner.collectibles) {
    if (c.collected) continue;
    if (c.lane !== player.lane) continue;
    if (Math.abs(c.z) > CONFIG.COLLECT_Z_WINDOW) continue;
    c.collected = true;
    collectedIds.push(c.id);
  }

  return { hit: false, collectedIds };
}
