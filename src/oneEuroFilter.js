/**
 * One Euro Filter - Adaptive low-pass filter for jitter-free tracking.
 *
 * When the signal is still, it uses a very low cutoff → heavy smoothing → no jitter.
 * When the signal moves fast, it raises the cutoff → light smoothing → no lag.
 *
 * Reference: Géry Casiez, Nicolas Roussel, Daniel Vogel.
 * "1€ Filter: A Simple Speed-based Low-pass Filter for Noisy Input in Interactive Systems"
 * https://gery.casiez.net/1euro/
 */

class LowPassFilter {
  constructor(alpha, initval = 0.0) {
    this.y = initval;
    this.s = initval;
    this.setAlpha(alpha);
    this.initialized = false;
  }

  setAlpha(alpha) {
    this.alpha = Math.max(0, Math.min(1, alpha));
  }

  filter(value) {
    if (!this.initialized) {
      this.s = value;
      this.initialized = true;
      return value;
    }
    this.s = this.alpha * value + (1.0 - this.alpha) * this.s;
    return this.s;
  }

  lastValue() {
    return this.s;
  }

  reset() {
    this.initialized = false;
  }
}

export class OneEuroFilter {
  /**
   * @param {number} freq       - Data update frequency (Hz). For 30fps webcam ≈ 30.
   * @param {number} minCutoff  - Minimum cutoff frequency. Lower = more smoothing when still.
   * @param {number} beta       - Speed coefficient. Higher = less lag during fast moves.
   * @param {number} dCutoff    - Cutoff frequency for the derivative filter.
   */
  constructor(freq = 30, minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
    this.freq = freq;
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.x = new LowPassFilter(this._alpha(this.minCutoff));
    this.dx = new LowPassFilter(this._alpha(this.dCutoff), 0.0);
    this.lastTime = null;
  }

  _alpha(cutoff) {
    const te = 1.0 / this.freq;
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / te);
  }

  reset() {
    this.x.reset();
    this.dx.reset();
    this.lastTime = null;
  }

  filter(value, timestamp = null) {
    if (timestamp !== null && this.lastTime !== null) {
      const dt = timestamp - this.lastTime;
      if (dt > 0) {
        this.freq = 1.0 / dt;
      }
    }
    this.lastTime = timestamp;

    // Estimate the signal derivative (speed).
    const prevValue = this.x.lastValue();
    const dx = this.x.initialized
      ? (value - prevValue) * this.freq
      : 0.0;

    // Filter the derivative to smooth noise.
    const edx = this.dx.filter(dx);
    this.dx.setAlpha(this._alpha(this.dCutoff));

    // Adaptive cutoff: rises with speed.
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    this.x.setAlpha(this._alpha(cutoff));

    return this.x.filter(value);
  }
}

/**
 * Convenience: wraps N independent OneEuroFilter instances
 * for filtering a vector (e.g. [x, y, z] position or [qx, qy, qz, qw] quaternion).
 */
export class OneEuroFilterVec {
  constructor(size, freq = 30, minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
    this.filters = [];
    for (let i = 0; i < size; i++) {
      this.filters.push(new OneEuroFilter(freq, minCutoff, beta, dCutoff));
    }
  }

  reset() {
    this.filters.forEach((f) => f.reset());
  }

  filter(values, timestamp = null) {
    return values.map((v, i) => this.filters[i].filter(v, timestamp));
  }
}
