// Gameplay furniture (obstacles that live in a lane and can collide) plus
// the collectible. Purely cosmetic furniture along the sides of the room —
// explicitly kept OUT of this module — is generated directly by
// renderer.js from the current room theme, so it never accidentally
// participates in collision or fairness logic (see world.js/renderer.js).
export const FURNITURE_TYPES = Object.freeze({
  OTTOMAN: 'OTTOMAN', // low cushion/ottoman — jump over, or change lanes
  TALL: 'TALL',       // cabinet/bookshelf — too tall to jump; change lanes only
  TABLE: 'TABLE',     // table top at chest height with a clear gap beneath — slide under, or change lanes
});

// Vertical band each type occupies (world units, 0 = floor), used by
// collision.js. Same technique as the jump-arc math below: whether a jump
// clears an obstacle falls out of a plain interval-overlap test against
// these bands, rather than a separate per-type rule.
// The bands below, read against the player's hitbox (player.js), are what
// make each type clearable by exactly the intended action:
//   standing  = [0, 150]        jumping (peak) = [184, 334]   sliding = [0, 70]
//   OTTOMAN [0,120]  : standing overlaps; a jump's feet clear 120  -> jump or lane
//   TALL    [0,420]  : overlaps every pose, even at jump peak      -> lane only
//   TABLE   [85,430] : standing overlaps (150>85); a jump rises INTO
//                      it, not over it; only the 70-high slide fits
//                      under the 85 lower edge                     -> slide or lane
export const FURNITURE_DEFS = {
  [FURNITURE_TYPES.OTTOMAN]: { bottom: 0, top: 120, clearedBy: ['jump', 'lane'] },
  [FURNITURE_TYPES.TALL]: { bottom: 0, top: 420, clearedBy: ['lane'] },
  [FURNITURE_TYPES.TABLE]: { bottom: 85, top: 430, clearedBy: ['slide', 'lane'] },
};

let _idCounter = 0;

export function createFurniture(type, lane, z) {
  return { id: ++_idCounter, kind: 'furniture', type, lane, z, age: 0 };
}

export function createCollectible(lane, z) {
  return { id: ++_idCounter, kind: 'collectible', lane, z, collected: false, age: 0 };
}
