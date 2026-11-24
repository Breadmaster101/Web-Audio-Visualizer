import { ANALYSIS } from '../config.js';
import { clamp, ema } from './dsp.js';

/**
 * Spectral flux onset detection with an adaptive threshold.
 *
 * Instead of watching low-end energy — which only ever finds kick drums — this
 * sums the positive dB change across every log-spaced band. That fires on
 * snares, plucked strings, piano attacks, horn stabs and consonants just as
 * readily as on a four-on-the-floor kick, which is what lets the visualiser
 * keep a pulse through jazz, folk, orchestral and vocal material.
 *
 * The threshold is the running mean plus a multiple of the running deviation
 * over the last ~2 seconds, so it self-scales: a dense wall of sound needs a
 * genuinely large transient to register, a sparse arrangement needs very little.
 */
export class OnsetDetector {
    constructor(bandCount) {
        this.prev = new Float32Array(bandCount);
        this.history = new Float32Array(ANALYSIS.fluxHistory);
        this.cursor = 0;
        this.filled = 0;
        this.primed = false;

        this.flux = 0;        // 0..1 raw novelty for this frame
        this.threshold = 0;
        this.strength = 0;    // 0..1 on the frame an onset lands, otherwise 0
        this.rate = 0;        // onsets per second, smoothed
        this.sinceOnset = 1;

        // One frame of lookahead, for the local-maximum test below.
        this.flux1 = 0;
        this.flux2 = 0;
        this.threshold1 = 0;
        this.deviation1 = 0;
    }

    update(bandsDb, dt, active, stalled = false) {
        const A = ANALYSIS;
        const n = bandsDb.length;

        let flux = 0;
        for (let i = 0; i < n; i++) {
            const rise = bandsDb[i] - this.prev[i];
            if (rise > 0) flux += rise < A.fluxClipDb ? rise : A.fluxClipDb;
            this.prev[i] = bandsDb[i];
        }

        if (!this.primed || stalled) {
            // The first frame compares against zeroed state, and a stalled
            // frame compares across a gap. Both readings are meaningless: keep
            // the updated band levels, throw the flux away.
            this.primed = true;
            flux = 0;
        }

        const scale = clamp(1 / (A.referenceFps * dt),
            A.fluxScaleRange[0], A.fluxScaleRange[1]);
        this.flux = active ? (flux / (n * A.fluxClipDb)) * scale : 0;
        this.sinceOnset += dt;

        const { mean, deviation } = this.statistics();
        this.threshold = mean + A.fluxThresholdK * deviation + A.fluxFloor;

        // Onsets are picked one frame late, so that the frame before last can be
        // tested for being a local maximum.
        //
        // Three conditions, because each covers the others' blind spot. The
        // deviation test finds transients buried in a dense mix. The ratio test
        // rejects the steady drizzle a pad or room tone produces, where the
        // deviation is tiny and *everything* clears mean + k sigma. The local
        // maximum test collapses one transient into one hit: FFT windows
        // overlap heavily, so a single drum smears across several frames and
        // would otherwise register as a little burst of separate onsets.
        const fired = active
            && !stalled
            && this.flux1 > this.threshold1
            && this.flux1 > mean * A.fluxRatio
            && this.flux1 >= this.flux
            && this.flux1 >= this.flux2
            && this.sinceOnset > A.minOnsetGap;

        if (fired) {
            this.strength = clamp((this.flux1 - this.threshold1)
                / (this.deviation1 * A.strengthScale + A.fluxFloor));
            this.sinceOnset = 0;
        } else {
            this.strength = 0;
        }

        this.flux2 = this.flux1;
        this.flux1 = this.flux;
        this.threshold1 = this.threshold;
        this.deviation1 = deviation;

        // An EMA of an impulse train scaled by 1/dt averages to events/second.
        // Weighting by strength means marginal hits count for less, so the
        // texture classification reflects real attacks rather than near-misses.
        this.rate = ema(this.rate, fired ? this.strength / dt : 0, dt, 3.0);

        // Recorded after thresholding so a hit never raises its own bar.
        this.history[this.cursor] = this.flux;
        this.cursor = (this.cursor + 1) % this.history.length;
        this.filled = Math.min(this.filled + 1, this.history.length);
    }

    statistics() {
        const n = this.filled;
        if (n < 8) return { mean: 0, deviation: 0 };

        let sum = 0;
        let sumSq = 0;
        for (let i = 0; i < n; i++) {
            const v = this.history[i];
            sum += v;
            sumSq += v * v;
        }
        const mean = sum / n;
        return { mean, deviation: Math.sqrt(Math.max(sumSq / n - mean * mean, 0)) };
    }
}
