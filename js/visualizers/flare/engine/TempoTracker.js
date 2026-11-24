import { ANALYSIS } from '../config.js';
import { clamp, ema, lerp, smoothstep } from './dsp.js';

/**
 * Tempo estimation and beat-phase prediction.
 *
 * The onset novelty signal is resampled into a fixed-rate envelope (rAF timing
 * is far too jittery to autocorrelate directly), then autocorrelated over the
 * lags that correspond to plausible tempos. A log-normal prior centred on
 * 120 BPM breaks the half-time/double-time ties that autocorrelation always
 * produces, and parabolic interpolation around the winning lag recovers
 * sub-sample accuracy so the estimate lands within about a BPM.
 *
 * The result drives a phase-locked loop: phase advances at the estimated
 * period and each detected onset pulls both the phase and the period toward it.
 * The upshot is that the visualiser knows where the *next* beat is, so it keeps
 * moving in time through breakdowns, held chords and sparse passages where
 * there is nothing to react to.
 */
export class TempoTracker {
    constructor() {
        const A = ANALYSIS;
        this.rate = A.envelopeRate;
        this.hop = 1 / A.envelopeRate;
        this.size = Math.round(A.envelopeSeconds * A.envelopeRate);

        this.env = new Float32Array(this.size);
        this.work = new Float32Array(this.size);
        this.blur = TempoTracker.blurKernel(A.envelopeBlur);
        this.write = 0;
        this.filled = 0;
        this.accumulator = 0;
        this.peak = 0;

        this.lagMin = Math.max(2, Math.floor((60 / A.bpmRange[1]) * this.rate));
        this.lagMax = Math.min(this.size - 1, Math.ceil((60 / A.bpmRange[0]) * this.rate));
        this.scores = new Float32Array(this.lagMax + 2);
        this.prior = new Float32Array(this.lagMax + 2);
        for (let lag = this.lagMin; lag <= this.lagMax; lag++) {
            const octaves = Math.log2((60 * this.rate) / (lag * A.bpmPrior)) / A.bpmPriorWidth;
            this.prior[lag] = Math.exp(-0.5 * octaves * octaves);
        }

        this.minPeriod = 60 / A.bpmRange[1];
        this.maxPeriod = 60 / A.bpmRange[0];

        this.period = 0.5;
        this.bpm = 0;
        this.confidence = 0;
        this.phase = 0;
        this.pulse = 0;
        /**
         * Counts beats of the grid, not detected onsets. Visuals that spawn
         * something per beat read this rather than watching the phase
         * themselves — the grid keeps counting through passages with no
         * transients in them, which is the whole point of having it.
         */
        this.beatIndex = 0;
        /** True for exactly the frame a grid beat lands on. */
        this.beatFired = false;
        this.sinceAnalysis = 0;
        this.lastEstimate = 0;
        this.agreement = 0;
    }

    /** Symmetric triangular kernel, normalised to unit sum. */
    static blurKernel(halfWidth) {
        const kernel = new Float32Array(halfWidth * 2 + 1);
        let sum = 0;
        for (let i = 0; i < kernel.length; i++) {
            kernel[i] = halfWidth + 1 - Math.abs(i - halfWidth);
            sum += kernel[i];
        }
        for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
        return kernel;
    }

    /** Peak-hold resample of the novelty signal into the fixed-rate envelope. */
    push(flux, dt) {
        if (flux > this.peak) this.peak = flux;
        this.accumulator += dt;

        let guard = 0;
        while (this.accumulator >= this.hop && guard++ < 8) {
            this.env[this.write] = this.peak;
            this.write = (this.write + 1) % this.size;
            this.filled = Math.min(this.filled + 1, this.size);
            this.accumulator -= this.hop;
            this.peak = 0;
        }
    }

    /** Re-runs the autocorrelation on its own schedule, not every frame. */
    tick(dt) {
        this.sinceAnalysis += dt;
        if (this.sinceAnalysis < ANALYSIS.analysisInterval) return;
        this.estimate(this.sinceAnalysis);
        this.sinceAnalysis = 0;
    }

    estimate(elapsed) {
        const A = ANALYSIS;
        const n = this.filled;
        if (n < this.lagMax * 2) return;

        // Copy the ring into chronological order, blurred and mean-removed.
        //
        // The blur matters more than it looks. Onsets land as single-sample
        // spikes whose true spacing is almost never a whole number of envelope
        // samples, and correlating spikes at integer lags then rewards whichever
        // multiple of the beat happens to land nearest a sample boundary — which
        // is how a 128 BPM loop reads as 86. Widening each spike to ~100ms makes
        // the correlation tolerant to that fractional misalignment, so the
        // accent pattern decides the winner instead of rounding does.
        const buf = this.work;
        const start = (this.write - n + this.size) % this.size;
        const kernel = this.blur;
        const half = (kernel.length - 1) / 2;
        let mean = 0;
        for (let i = 0; i < n; i++) {
            let value = 0;
            for (let k = 0; k < kernel.length; k++) {
                const j = i + k - half;
                if (j >= 0 && j < n) value += this.env[(start + j) % this.size] * kernel[k];
            }
            buf[i] = value;
            mean += value;
        }
        mean /= n;

        let variance = 0;
        for (let i = 0; i < n; i++) {
            buf[i] -= mean;
            variance += buf[i] * buf[i];
        }
        variance /= n;

        if (variance < 1e-8) {
            this.confidence = ema(this.confidence, 0, elapsed, 1.0);
            this.agreement = 0;
            return;
        }

        let best = -Infinity;
        let bestLag = 0;

        for (let lag = this.lagMin; lag <= this.lagMax; lag++) {
            let acc = 0;
            for (let i = lag; i < n; i++) acc += buf[i] * buf[i - lag];
            const score = (acc / ((n - lag) * variance)) * this.prior[lag];

            this.scores[lag] = score;
            if (score > best) {
                best = score;
                bestLag = lag;
            }
        }

        if (bestLag === 0) return;

        // Parabolic refinement of the correlation peak, for sub-sample accuracy.
        let refined = bestLag;
        if (bestLag > this.lagMin && bestLag < this.lagMax) {
            const a = this.scores[bestLag - 1];
            const b = this.scores[bestLag];
            const c = this.scores[bestLag + 1];
            const denominator = a - 2 * b + c;
            if (Math.abs(denominator) > 1e-9) {
                refined += clamp(0.5 * (a - c) / denominator, -0.5, 0.5);
            }
        }

        const target = clamp(refined / this.rate, this.minPeriod, this.maxPeriod);

        // Confidence has two factors.
        //
        // The correlation coefficient is already normalised, so it means the
        // same thing for every track: roughly 0.35-0.95 for material with a
        // real pulse. How *sharp* the peak is deliberately plays no part — a
        // strong beat lights up its own harmonics at 2x and 3x the period,
        // which broadens the curve, and scoring that as uncertainty gets the
        // most obviously danceable material exactly backwards.
        //
        // Agreement across successive analyses is what rejects the rest. Noise
        // correlates well enough to peak near 0.25 by chance, but it peaks
        // somewhere different every time; a genuine tempo names the same period
        // over and over. Requiring a few consecutive agreements costs about a
        // second of lock-on and reliably keeps a beatless drone at zero.
        const agrees = this.lastEstimate > 0
            && Math.abs(target - this.lastEstimate) / this.lastEstimate < A.tempoAgreement;
        this.agreement = agrees ? Math.min(this.agreement + 1, A.agreementNeeded) : 0;
        this.lastEstimate = target;

        const observed = smoothstep(0.12, 0.42, best) * (this.agreement / A.agreementNeeded);
        this.confidence = ema(this.confidence, observed, elapsed, 1.0);
        if (observed < A.minConfidence) return;
        const ratio = target / this.period;
        // Snap outright when the tempo genuinely changed; glide when it is just
        // the estimate settling, so the beat grid does not stutter.
        this.period = (ratio > 1.12 || ratio < 0.89) ? target : lerp(this.period, target, 0.3);
        this.bpm = 60 / this.period;
    }

    /** Advance the beat grid and phase-lock it to whatever just fired. */
    advance(dt, onsetStrength) {
        const A = ANALYSIS;

        // Only the natural wrap counts as a beat. The phase-lock correction
        // below can also push the phase across zero, and treating that as a
        // beat would double-count every hit it pulls backwards.
        this.phase += dt / this.period;
        this.beatFired = this.phase >= 1;
        if (this.beatFired) {
            this.beatIndex += Math.floor(this.phase);
            this.phase -= Math.floor(this.phase);
        }

        if (onsetStrength > 0 && this.confidence > 0.1) {
            // Signed distance from the nearest beat, in [-0.5, 0.5) of a period.
            const error = this.phase > 0.5 ? this.phase - 1 : this.phase;
            const lock = A.phaseLock * onsetStrength * clamp(this.confidence);

            this.phase -= error * lock;
            if (this.phase < 0) this.phase += 1;

            // A consistently late onset means the grid is running fast.
            this.period = clamp(this.period * (1 + error * lock * A.periodLock),
                this.minPeriod, this.maxPeriod);
            this.bpm = 60 / this.period;
        }

        this.pulse = Math.pow(1 - this.phase, A.pulseSharpness);
    }
}
