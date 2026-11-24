import { ANALYSIS } from '../config.js';
import { aWeightDb, clamp, dbToLin, envelope, linToDb, smoothstep } from './dsp.js';

/**
 * How loud the stream is, and whether anything is playing at all.
 *
 * Runs off a loudness envelope with a slow release rather than the momentary
 * value, which swings 40dB or more between a hit and the gap after it.
 */
export class Loudness {
    constructor(fftSize, sampleRate) {
        const binHz = sampleRate / fftSize;
        const binCount = fftSize / 2;
        const [lo, hi] = ANALYSIS.loudnessRange;
        const n = ANALYSIS.loudnessBands;

        this.bands = [];
        for (let i = 0; i < n; i++) {
            const f0 = lo * Math.pow(hi / lo, i / n);
            const f1 = lo * Math.pow(hi / lo, (i + 1) / n);
            const first = clamp(Math.round(f0 / binHz), 1, binCount - 1);
            const last = clamp(Math.round(f1 / binHz), first + 1, binCount);
            this.bands.push([first, last, aWeightDb(Math.sqrt(f0 * f1))]);
        }

        this.ceil = ANALYSIS.hardFloorDb;
        this.envelope = ANALYSIS.hardFloorDb;

        /** 0 in silence, 1 while music plays, eased between. */
        this.gate = 0;
        /** Whether anything is playing this frame. */
        this.active = false;
    }

    update(data, dt) {
        const A = ANALYSIS;
        this.envelope = envelope(this.envelope, this.measure(data), dt,
            A.loudnessAttackTau, A.loudnessReleaseTau);
        this.ceil = Math.max(this.envelope, this.ceil - dt * A.gateFallDbPerSec);

        // Relative to the loudest recent moment, with an absolute backstop.
        const gateDb = Math.max(this.ceil - A.gateRangeDb, A.absoluteGateDb);
        this.active = this.envelope > gateDb;
        this.gate = envelope(this.gate, smoothstep(gateDb, gateDb + 8, this.envelope), dt,
            A.gateOpenTau, A.gateCloseTau);
    }

    /** A-weighted level of one FFT frame, in dB. */
    measure(data) {
        let total = 0;
        for (const [first, last, weight] of this.bands) {
            let sum = 0;
            for (let i = first; i < last; i++) {
                // Guards the -Infinity the Web Audio API emits for empty bins.
                if (data[i] > -180) sum += dbToLin(data[i]);
            }
            total += dbToLin(linToDb(sum / (last - first)) + weight);
        }
        return linToDb(total / this.bands.length);
    }
}
