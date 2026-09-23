import { CONFIG } from '../config.js';
import { clamp, damp, TimeWindow } from '../utils.js';
import { LM, isVisible } from './poseLandmarks.js';

/**
 * Converts raw pose landmarks into a single continuous "movement energy"
 * value in [0,1], which main.js maps onto running speed.
 *
 * WHAT IT MEASURES (and what it deliberately does NOT claim to measure):
 * This is a *game control signal*, not a fitness metric. It approximates
 * "how much rhythmic arm/leg activity happened in the last ~1 second,"
 * normalized to the player's own body size. It is not calibrated against
 * real cadence, stride length, or effort, and makes no claim about actual
 * running speed or exercise intensity — see the README for the full
 * disclaimer this implements.
 *
 * HOW (see also CONFIG.ENERGY for every constant referenced here):
 * 1. Each frame, we compute the normalized frame-to-frame displacement of
 *    the wrists+elbows ("arm activity") and knees+ankles ("leg activity"),
 *    divided by shoulder width (body-size normalization) and by dt
 *    (so it's a velocity, not a raw pixel delta — frame-rate independent).
 * 2. A small deadzone subtracts out sensor jitter: a landmark that isn't
 *    really moving still wobbles by a fraction of a percent frame to frame
 *    purely from model noise, and that noise must not read as "activity."
 * 3. Rather than reacting to a single frame's velocity (which would let
 *    one stray fast frame spike the meter, and would also make the score
 *    noisy), every accepted sample is pushed into a ~1.1s sliding window
 *    (TimeWindow) and we use its *average* — this is what "repeated
 *    movement over a short window" means concretely.
 * 4. Arm and leg averages are combined with a synergy bonus for doing both
 *    at once (CONFIG.ENERGY.SYNERGY_WEIGHT), then normalized into [0,1].
 * 5. The result is smoothed with an asymmetric rise/decay (rises quickly so
 *    effort feels rewarded immediately; decays more slowly so a brief pause
 *    doesn't feel punishing) down to a true 0 with no movement at all.
 *
 * LIMITATIONS (documented, not hidden): a very still upper body with only
 * ankle motion (fast seated foot-tapping) can still register some energy;
 * conversely, someone marching very slowly and smoothly may register less
 * than someone flailing quickly but arrhythmically — this rewards *tempo*
 * of movement, not "correct" running form, which is an intentional
 * simplification for a game control, not a fitness measurement.
 */
export class MovementEnergyTracker {
  constructor() {
    this.armWindow = new TimeWindow(CONFIG.ENERGY.WINDOW_SECONDS);
    this.legWindow = new TimeWindow(CONFIG.ENERGY.WINDOW_SECONDS);
    this.energy = 0;
    this._prevPositions = null; // { [landmarkIndex]: {x,y} }
    this._prevTime = null;
    this._suppressUntil = 0;
    this._lowConfidenceStreak = 0;
    this.legsAvailable = false;
  }

  reset() {
    this.armWindow.clear();
    this.legWindow.clear();
    this.energy = 0;
    this._prevPositions = null;
    this._prevTime = null;
  }

  /** Called by gestureDetector.js right after a discrete gesture fires, so
   * that gesture's own motion doesn't also register as marching/swinging. */
  suppressFor(ms) {
    this._suppressUntil = performance.now() + ms;
  }

  get lowConfidenceStreak() {
    return this._lowConfidenceStreak;
  }

  /**
   * @param {any[]|null} landmarks
   * @param {number} now seconds (monotonic)
   * @returns {number} the updated, smoothed energy value in [0,1]
   */
  process(landmarks, now) {
    const dt = this._prevTime === null ? 1 / 30 : Math.max(now - this._prevTime, 1 / 120);
    this._prevTime = now;

    const minVis = CONFIG.ENERGY.MIN_LANDMARK_VISIBILITY;
    const shoulders = landmarks && [landmarks[LM.LEFT_SHOULDER], landmarks[LM.RIGHT_SHOULDER]];
    const shouldersOk = landmarks && shoulders.every((l) => isVisible(l, minVis));

    if (!landmarks || !shouldersOk) {
      this._lowConfidenceStreak++;
      this._prevPositions = null; // avoid a bogus velocity spike when tracking resumes
      this._applySmoothing(0, dt);
      this.legsAvailable = false;
      return this.energy;
    }
    this._lowConfidenceStreak = 0;

    const shoulderWidth = Math.max(
      Math.hypot(shoulders[0].x - shoulders[1].x, shoulders[0].y - shoulders[1].y),
      0.05
    );

    const armIndices = [LM.LEFT_WRIST, LM.RIGHT_WRIST, LM.LEFT_ELBOW, LM.RIGHT_ELBOW];
    const legIndices = [LM.LEFT_ANKLE, LM.RIGHT_ANKLE, LM.LEFT_KNEE, LM.RIGHT_KNEE];

    const suppressed = performance.now() < this._suppressUntil;
    const positions = {};
    let armActivity = 0;
    let legActivity = 0;
    let legLandmarksVisible = 0;

    const accumulate = (indices, weightEach) => {
      let total = 0;
      for (const idx of indices) {
        const lm = landmarks[idx];
        if (!isVisible(lm, minVis)) continue;
        positions[idx] = { x: lm.x, y: lm.y };
        if (indices === legIndices) legLandmarksVisible++;
        const prev = this._prevPositions && this._prevPositions[idx];
        if (!prev) continue;
        const dist = Math.hypot(lm.x - prev.x, lm.y - prev.y) / shoulderWidth;
        const velocity = dist / dt;
        const jittered = Math.max(0, velocity - CONFIG.ENERGY.JITTER_DEADZONE);
        total += Math.min(jittered, CONFIG.ENERGY.VELOCITY_CAP) * weightEach;
      }
      return total;
    };

    armActivity = accumulate(armIndices, 1);
    legActivity = accumulate(legIndices, 1);
    this.legsAvailable = legLandmarksVisible >= 2; // at least one full leg visible

    this._prevPositions = positions;

    if (!suppressed) {
      this.armWindow.push(armActivity, now);
      this.legWindow.push(legActivity, now);
    }

    const armAvg = this._average(this.armWindow);
    const legAvg = this._average(this.legWindow);
    const raw =
      CONFIG.ENERGY.ARM_WEIGHT * armAvg +
      CONFIG.ENERGY.LEG_WEIGHT * legAvg +
      CONFIG.ENERGY.SYNERGY_WEIGHT * Math.min(armAvg, legAvg);
    const target = clamp(raw / CONFIG.ENERGY.ENERGY_NORMALIZER, 0, 1);

    this._applySmoothing(target, dt);
    return this.energy;
  }

  /**
   * Bypasses landmark processing entirely and just runs a target value
   * (0 or 1) through the same rise/decay smoothing as camera mode. This is
   * what keyboard mode's held "accelerate" key drives (see keyboard.js) —
   * one smoothing model shared by every input source, not a separate
   * keyboard-only speed rule.
   */
  processDirectTarget(target, dt) {
    this._applySmoothing(clamp(target, 0, 1), dt);
    return this.energy;
  }

  _average(window) {
    if (window.samples.length === 0) return 0;
    return window.sum() / window.samples.length;
  }

  _applySmoothing(target, dt) {
    const lambda = target > this.energy ? CONFIG.ENERGY.RISE_LAMBDA : CONFIG.ENERGY.DECAY_LAMBDA;
    this.energy = damp(this.energy, target, lambda, dt);
    if (this.energy < 0.003) this.energy = 0;
  }
}
