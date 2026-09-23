import { ACTIONS, actionBus } from '../actionSystem.js';
import { CONFIG, CALIBRATION_STEPS } from '../config.js';
import { OneEuroFilter, clamp } from '../utils.js';
import { LM, isVisible } from './poseLandmarks.js';

/**
 * Three discrete gestures: lane-change (lean), jump (two-hand raise), and
 * slide (squat / lower the upper body).
 *
 * THE DUCK IS THE RISKY ONE, and it's worth being explicit about why.
 * Marching in place — this project's primary SPEED input — lowers the body
 * on every single step, so a naive "are the shoulders lower than usual?"
 * test would fire constantly while running. Two independent filters
 * separate the two (see CONFIG.GESTURE for the values):
 *   - Amplitude: the drop is measured against the player's OWN calibrated
 *     squat depth, and must reach a large fraction of it. A march's bob is
 *     a small fraction of a real squat, so it never reaches the threshold.
 *   - Duration: the drop must be HELD. A march passes through its low
 *     point and springs back; a squat stays down.
 * Both must pass, on top of the usual hysteresis and cooldown. This is a
 * best-effort separation that has NOT been validated against a real
 * marching player on a live camera (see TESTING.md) — if it does misfire,
 * raising DUCK_ENTER_FRACTION and DUCK_MIN_HOLD_MS is the first lever.
 *
 * MIRRORING NOTE: exactly as in the lean-based control scheme this
 * project's predecessor used, physical lean-LEFT raises the raw
 * (unmirrored) camera-frame x coordinate, because the camera faces the
 * player like another person would. The on-screen preview is mirrored for
 * *display* only (CSS), while this raw relationship is used directly for
 * gesture math. This was derived analytically, not confirmed on a live
 * camera, so a "Swap left/right" setting is exposed as a field fix.
 */
export class GestureDetector {
  constructor() {
    const filterOpts = {
      minCutoff: CONFIG.GESTURE.ONE_EURO_MIN_CUTOFF,
      beta: CONFIG.GESTURE.ONE_EURO_BETA,
      dCutoff: CONFIG.GESTURE.ONE_EURO_D_CUTOFF,
    };
    this.smoothedX = new OneEuroFilter(filterOpts);
    this.smoothedY = new OneEuroFilter(filterOpts);

    this.calibration = null;
    this.sensitivity = CONFIG.GESTURE.SENSITIVITY_DEFAULT;
    this.swapLeftRight = false;

    this._lateralArmed = true;
    this._lastLaneActionAt = 0;

    this._jumpArmed = true;
    this._jumpRaiseStartedAt = null;
    this._lastJumpActionAt = 0;

    this._duckArmed = true;
    this._duckStartedAt = null;
    this._lastDuckActionAt = 0;
    this._prevDuckOffset = null;
    this._prevDuckTime = null;

    // True while the player is mid-jump OR mid-slide. Both vertical
    // gestures share one lock, so a held pose can't immediately re-fire
    // (or fire the opposite action) while an action is still playing out.
    this._verticalLocked = false;

    this._calibrationSamples = [];
    this._lowConfidenceStreak = 0;
    this._lastDebug = { lateral: 0, duck: 0 };
  }

  setSensitivity(value) {
    this.sensitivity = clamp(value, CONFIG.GESTURE.SENSITIVITY_MIN, CONFIG.GESTURE.SENSITIVITY_MAX);
  }

  setSwapLeftRight(swap) {
    this.swapLeftRight = swap;
  }

  /** Called by main.js each frame: true while the player is mid-jump or
   * mid-slide, so a held pose can't immediately re-trigger the same action
   * (or the opposite one) the instant the cooldown expires. */
  setVerticalLocked(locked) {
    this._verticalLocked = locked;
  }

  // ---- Calibration (neutral, comfortable lean range, squat depth) --------

  beginCalibrationStep() {
    this._calibrationSamples = [];
  }

  sampleCalibration(landmarks) {
    const f = this._extractPoseFeature(landmarks);
    if (f) this._calibrationSamples.push(f);
  }

  finishCalibrationStep() {
    if (this._calibrationSamples.length === 0) return null;
    const n = this._calibrationSamples.length;
    const avg = this._calibrationSamples.reduce(
      (acc, f) => ({
        x: acc.x + f.x / n,
        y: acc.y + f.y / n,
        shoulderWidth: acc.shoulderWidth + f.shoulderWidth / n,
        torsoHeight: acc.torsoHeight + f.torsoHeight / n,
      }),
      { x: 0, y: 0, shoulderWidth: 0, torsoHeight: 0 }
    );
    this._calibrationSamples = [];
    return avg;
  }

  applyCalibration(stepResults) {
    const neutral = stepResults.neutral;
    const shoulderWidth = Math.max(neutral.shoulderWidth, 0.05);
    const torsoHeight = Math.max(neutral.torsoHeight, 0.05);
    const leftRange = stepResults.left ? Math.abs(stepResults.left.x - neutral.x) / shoulderWidth : 0;
    const rightRange = stepResults.right ? Math.abs(stepResults.right.x - neutral.x) / shoulderWidth : 0;
    // How far the player's shoulders actually drop in their own
    // comfortable squat, normalized to their torso. Everything about duck
    // detection is measured against this rather than a fixed assumption.
    const duckRange = stepResults.duck ? Math.abs(stepResults.duck.y - neutral.y) / torsoHeight : 0;

    this.calibration = {
      neutralX: neutral.x,
      neutralY: neutral.y,
      shoulderWidth,
      torsoHeight,
      lateralRange: Math.max(leftRange, rightRange, CONFIG.GESTURE.MIN_VALID_RANGE) || CONFIG.GESTURE.FALLBACK_LATERAL_RANGE,
      duckRange: Math.max(duckRange, CONFIG.GESTURE.MIN_VALID_RANGE) || CONFIG.GESTURE.FALLBACK_DUCK_RANGE,
    };
    if (this.calibration.duckRange < CONFIG.GESTURE.MIN_VALID_RANGE) {
      this.calibration.duckRange = CONFIG.GESTURE.FALLBACK_DUCK_RANGE;
    }
    this.smoothedX.reset(neutral.x);
    this.smoothedY.reset(neutral.y);
    return this.calibration;
  }

  applyDefaultCalibration(lastKnownX = 0.5, lastKnownY = 0.5) {
    this.calibration = {
      neutralX: lastKnownX,
      neutralY: lastKnownY,
      shoulderWidth: 0.2,
      torsoHeight: 0.24,
      lateralRange: CONFIG.GESTURE.FALLBACK_LATERAL_RANGE,
      duckRange: CONFIG.GESTURE.FALLBACK_DUCK_RANGE,
    };
    this.smoothedX.reset(lastKnownX);
    this.smoothedY.reset(lastKnownY);
    return this.calibration;
  }

  isCalibrated() {
    return !!this.calibration;
  }

  get lowConfidenceStreak() {
    return this._lowConfidenceStreak;
  }

  // ---- Runtime processing ---------------------------------------------------

  /** @returns {{lowConfidence:boolean}} */
  process(landmarks) {
    if (!this.calibration) return null;

    const feature = this._extractPoseFeature(landmarks);
    if (!feature) {
      this._lowConfidenceStreak++;
      // Drop any in-progress duck hold: a gesture can't be "sustained"
      // through frames where we couldn't actually see the player.
      this._duckStartedAt = null;
      this._jumpRaiseStartedAt = null;
      return { lowConfidence: true };
    }
    this._lowConfidenceStreak = 0;

    const now = performance.now() / 1000;
    const x = this.smoothedX.filter(feature.x, now);
    const y = this.smoothedY.filter(feature.y, now);

    const lateralOffset = (x - this.calibration.neutralX) / this.calibration.shoulderWidth;
    this._lastDebug.lateral = lateralOffset;
    this._evaluateLateral(lateralOffset);

    // Positive = shoulders have moved DOWN (image y grows downward).
    const duckOffset = (y - this.calibration.neutralY) / this.calibration.torsoHeight;
    this._lastDebug.duck = duckOffset;

    // Jump and slide are mutually exclusive and share one lock, so neither
    // can fire while the other is still playing out.
    if (!this._verticalLocked) {
      this._evaluateJump(landmarks);
      this._evaluateDuck(duckOffset);
    } else {
      this._duckStartedAt = null;
      this._jumpRaiseStartedAt = null;
    }

    return { lowConfidence: false };
  }

  getDebugState() {
    return { ...this._lastDebug, calibrated: this.isCalibrated() };
  }

  // ---- Internals --------------------------------------------------------

  _extractPoseFeature(landmarks) {
    if (!landmarks) return null;
    const nose = landmarks[LM.NOSE];
    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const minVis = CONFIG.ENERGY.MIN_LANDMARK_VISIBILITY;
    if (!isVisible(nose, minVis) || !isVisible(ls, minVis) || !isVisible(rs, minVis)) return null;

    const shoulderMidX = (ls.x + rs.x) / 2;
    const shoulderMidY = (ls.y + rs.y) / 2;
    const shoulderWidth = Math.abs(ls.x - rs.x);

    // Hips are often out of frame for a seated/close setup, so fall back to
    // a shoulder-width proxy — the same approach the jump detector uses.
    const torsoHeight =
      isVisible(lh, minVis) && isVisible(rh, minVis)
        ? Math.abs((lh.y + rh.y) / 2 - shoulderMidY)
        : shoulderWidth * 1.2;

    return {
      x: (nose.x + shoulderMidX) / 2,
      y: shoulderMidY,
      shoulderWidth,
      torsoHeight: Math.max(torsoHeight, 0.05),
    };
  }

  _thresholds() {
    const g = CONFIG.GESTURE;
    const lateralRange = this.calibration.lateralRange * this.sensitivity;
    const duckRange = this.calibration.duckRange * this.sensitivity;
    return {
      lateralEnter: lateralRange * g.LATERAL_ENTER_FRACTION,
      lateralExit: lateralRange * g.LATERAL_EXIT_FRACTION,
      duckEnter: duckRange * g.DUCK_ENTER_FRACTION,
      duckExit: duckRange * g.DUCK_EXIT_FRACTION,
    };
  }

  _evaluateLateral(offset) {
    const { lateralEnter, lateralExit } = this._thresholds();
    const now = performance.now();
    const cooldownOk = now - this._lastLaneActionAt > CONFIG.GESTURE.LANE_COOLDOWN_MS;

    if (!this._lateralArmed) {
      if (Math.abs(offset) < lateralExit) this._lateralArmed = true;
      return;
    }
    if (Math.abs(offset) < lateralEnter || !cooldownOk) return;

    // See the class-level mirroring note: a positive raw offset means the
    // player leaned to their own physical left, unless swapped by settings.
    const leanedLeft = this.swapLeftRight ? offset < 0 : offset > 0;
    actionBus.dispatch(leanedLeft ? ACTIONS.MOVE_LEFT : ACTIONS.MOVE_RIGHT, { source: 'gesture' });
    this._lateralArmed = false;
    this._lastLaneActionAt = now;
  }

  // A deliberate two-hand raise: BOTH wrists above the shoulder line by a
  // large, sustained margin. This threshold is intentionally much larger
  // and requires a minimum hold duration — an ordinary arm swing used for
  // movement energy is faster and doesn't sustain a high wrist position,
  // it oscillates through it.
  _evaluateJump(landmarks) {
    const minVis = CONFIG.ENERGY.MIN_LANDMARK_VISIBILITY;
    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const lw = landmarks[LM.LEFT_WRIST];
    const rw = landmarks[LM.RIGHT_WRIST];
    if (![ls, rs, lw, rw].every((l) => isVisible(l, minVis))) {
      this._jumpRaiseStartedAt = null;
      return;
    }

    const shoulderMidY = (ls.y + rs.y) / 2;
    const torsoHeight =
      lh && rh && isVisible(lh, minVis) && isVisible(rh, minVis)
        ? Math.abs((lh.y + rh.y) / 2 - shoulderMidY)
        : Math.abs(ls.x - rs.x) * 1.2; // fallback proxy, same approach as lateral normalization

    const raiseAmount = shoulderMidY - Math.max(lw.y, rw.y); // positive = both wrists above shoulders
    const raiseThreshold = torsoHeight * CONFIG.GESTURE.JUMP_RAISE_FRACTION;
    const resetThreshold = torsoHeight * CONFIG.GESTURE.JUMP_RESET_FRACTION;

    const now = performance.now();
    const cooldownOk = now - this._lastJumpActionAt > CONFIG.GESTURE.JUMP_COOLDOWN_MS;

    if (!this._jumpArmed) {
      if (raiseAmount < resetThreshold) this._jumpArmed = true;
      return;
    }

    if (raiseAmount >= raiseThreshold) {
      if (this._jumpRaiseStartedAt === null) this._jumpRaiseStartedAt = now;
      const held = now - this._jumpRaiseStartedAt;
      if (held >= CONFIG.GESTURE.JUMP_MIN_HOLD_MS && cooldownOk) {
        actionBus.dispatch(ACTIONS.JUMP, { source: 'gesture' });
        this._jumpArmed = false;
        this._lastJumpActionAt = now;
        this._jumpRaiseStartedAt = null;
      }
    } else {
      this._jumpRaiseStartedAt = null;
    }
  }

  // A deliberate squat (or, seated, lowering the upper body). Three gates,
  // all of which exist to reject marching in place — this game's own speed
  // input, which lowers the body on every step:
  //   1. DEPTH   — must reach a large fraction of the player's calibrated
  //                squat depth, far deeper than a step's bob.
  //   2. STILL   — must have essentially stopped descending. A squat parks
  //                at the bottom; a march is still travelling through it.
  //   3. HELD    — must stay both deep and still for DUCK_MIN_HOLD_MS.
  // Depth and hold alone were measurably insufficient (a slow deep march
  // cleared both), which is why the stillness gate exists — see
  // CONFIG.GESTURE.DUCK_MAX_SETTLE_SPEED.
  _evaluateDuck(offset) {
    const { duckEnter, duckExit } = this._thresholds();
    const now = performance.now();
    const cooldownOk = now - this._lastDuckActionAt > CONFIG.GESTURE.DUCK_COOLDOWN_MS;

    // Vertical speed in torso-heights per second.
    let speed = Infinity;
    if (this._prevDuckOffset !== null && this._prevDuckTime !== null) {
      const dt = (now - this._prevDuckTime) / 1000;
      if (dt > 0) speed = Math.abs(offset - this._prevDuckOffset) / dt;
    }
    this._prevDuckOffset = offset;
    this._prevDuckTime = now;

    // Hysteresis: after firing, the player must come back up near standing
    // before another duck can be triggered.
    if (!this._duckArmed) {
      if (offset < duckExit) this._duckArmed = true;
      this._duckStartedAt = null;
      return;
    }

    const deepEnough = offset >= duckEnter;
    const settled = speed <= CONFIG.GESTURE.DUCK_MAX_SETTLE_SPEED;

    if (deepEnough && settled) {
      if (this._duckStartedAt === null) this._duckStartedAt = now;
      const held = now - this._duckStartedAt;
      if (held >= CONFIG.GESTURE.DUCK_MIN_HOLD_MS && cooldownOk) {
        actionBus.dispatch(ACTIONS.SLIDE, { source: 'gesture' });
        this._duckArmed = false;
        this._lastDuckActionAt = now;
        this._duckStartedAt = null;
      }
    } else {
      // Either came back up, or is still moving — a step, not a squat.
      this._duckStartedAt = null;
    }
  }
}

export { CALIBRATION_STEPS };
