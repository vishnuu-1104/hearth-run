// Small, dependency-free math helpers shared across the game.

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function mapRange(value, inMin, inMax, outMin, outMax, clampResult = true) {
  const t = (value - inMin) / (inMax - inMin || 1);
  const result = outMin + (outMax - outMin) * t;
  return clampResult ? clamp(result, Math.min(outMin, outMax), Math.max(outMin, outMax)) : result;
}

// Frame-rate-independent exponential smoothing: the same lambda produces
// the same visual/behavioral easing regardless of frame rate, unlike
// `current += (target-current)*factor`, which eases faster at high refresh
// rates. Used for lane easing, speed response, and energy rise/decay.
export function damp(current, target, lambda, dt) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

// One Euro Filter (Casiez, Roussel & Vogel, 2012): a low-pass filter whose
// cutoff adapts to signal speed, so it suppresses jitter while nearly still
// but tracks a fast, deliberate movement (a lean, a raise) with much less
// lag than a fixed-factor exponential average would allow.
export class OneEuroFilter {
  constructor({ minCutoff = 1.0, beta = 0.3, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this._xPrev = null;
    this._dxPrev = 0;
    this._tPrev = null;
  }

  reset(value = null) {
    this._xPrev = value;
    this._dxPrev = 0;
    this._tPrev = null;
  }

  static _alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(x, t) {
    if (this._tPrev === null || this._xPrev === null) {
      this._tPrev = t;
      this._xPrev = x;
      return x;
    }
    let dt = t - this._tPrev;
    if (dt <= 0) dt = 1 / 60;
    this._tPrev = t;

    const aD = OneEuroFilter._alpha(this.dCutoff, dt);
    const dx = (x - this._xPrev) / dt;
    const dxHat = aD * dx + (1 - aD) * this._dxPrev;

    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = OneEuroFilter._alpha(cutoff, dt);
    const xHat = a * x + (1 - a) * this._xPrev;

    this._xPrev = xHat;
    this._dxPrev = dxHat;
    return xHat;
  }
}

// A fixed-duration ring buffer of {value, time} samples — used by
// movementEnergy.js to compute activity over "a short time window" rather
// than from a single frame-to-frame delta.
export class TimeWindow {
  constructor(seconds) {
    this.seconds = seconds;
    this.samples = [];
  }

  push(value, time) {
    this.samples.push({ value, time });
    const cutoff = time - this.seconds;
    while (this.samples.length && this.samples[0].time < cutoff) {
      this.samples.shift();
    }
  }

  sum() {
    return this.samples.reduce((acc, s) => acc + s.value, 0);
  }

  clear() {
    this.samples = [];
  }
}

export function formatMeters(meters) {
  return `${Math.floor(meters)}m`;
}

export function formatScore(score) {
  return Math.floor(score).toLocaleString('en-US');
}
