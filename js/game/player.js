import { CONFIG } from '../config.js';
import { damp, clamp } from '../utils.js';

export const PLAYER_MODE = Object.freeze({
  RUN: 'RUN',
  JUMP: 'JUMP',
  SLIDE: 'SLIDE',
});

// Owns lane index, smooth lane-to-lane easing, jump physics (a time-based
// projectile arc, frame-rate independent) and slide timing.
export class Player {
  constructor() {
    this.reset();
  }

  reset() {
    this.lane = 1;
    this.laneX = 0;
    this.targetLaneX = 0;
    this.y = 0;
    this.vy = 0;
    this.mode = PLAYER_MODE.RUN;
    this.runCycle = 0;
    // Eases 0 (running pose) -> 1 (jump pose) and back, independently of
    // the jump's actual vertical physics. Without this, renderer.js would
    // switch leg/arm angles the instant `mode` flips — the height arcs
    // smoothly, but the limbs would visibly snap into and out of the jump
    // pose on the exact same frame takeoff/landing happens, which reads as
    // janky even though the flight itself is smooth.
    this.jumpBlend = 0;
    // Same idea as jumpBlend, for the run <-> slide pose.
    this.slideBlend = 0;
    this._slideTimer = 0;
  }

  get laneCount() {
    return CONFIG.LANE_COUNT;
  }

  isLocked() {
    return this.mode !== PLAYER_MODE.RUN;
  }

  moveLeft() {
    this.lane = clamp(this.lane - 1, 0, CONFIG.LANE_COUNT - 1);
    this.targetLaneX = this.lane - 1;
  }

  moveRight() {
    this.lane = clamp(this.lane + 1, 0, CONFIG.LANE_COUNT - 1);
    this.targetLaneX = this.lane - 1;
  }

  jump() {
    if (this.isLocked()) return;
    this.mode = PLAYER_MODE.JUMP;
    this.vy = -CONFIG.JUMP_VELOCITY;
  }

  slide() {
    if (this.isLocked()) return;
    this.mode = PLAYER_MODE.SLIDE;
    this._slideTimer = CONFIG.SLIDE_DURATION;
  }

  /** @param {number} dt seconds @param {number} speedFraction 0..1, current speed / MAX_SPEED, drives run-cycle animation rate */
  update(dt, speedFraction = 0.5) {
    this.laneX = damp(this.laneX, this.targetLaneX, CONFIG.LANE_CHANGE_LAMBDA, dt);
    this.runCycle += dt * (6 + speedFraction * 8);
    this.jumpBlend = damp(this.jumpBlend, this.mode === PLAYER_MODE.JUMP ? 1 : 0, 14, dt);
    this.slideBlend = damp(this.slideBlend, this.mode === PLAYER_MODE.SLIDE ? 1 : 0, 14, dt);

    if (this.mode === PLAYER_MODE.JUMP) {
      this.vy += CONFIG.GRAVITY * dt;
      this.y += this.vy * dt;
      if (this.y >= 0) {
        this.y = 0;
        this.vy = 0;
        this.mode = PLAYER_MODE.RUN;
      }
    } else if (this.mode === PLAYER_MODE.SLIDE) {
      this._slideTimer -= dt;
      if (this._slideTimer <= 0) this.mode = PLAYER_MODE.RUN;
    }
  }

  getHitbox() {
    if (this.mode === PLAYER_MODE.SLIDE) {
      // A short hitbox that passes beneath TABLE's lower edge. Collision
      // stays keyed to the discrete mode rather than the visual
      // slideBlend, so what counts as "sliding" is unambiguous.
      return { bottom: 0, top: CONFIG.PLAYER_SLIDE_HEIGHT, width: CONFIG.PLAYER_WIDTH };
    }
    const airborne = -this.y;
    return { bottom: airborne, top: airborne + CONFIG.PLAYER_HEIGHT, width: CONFIG.PLAYER_WIDTH };
  }
}
