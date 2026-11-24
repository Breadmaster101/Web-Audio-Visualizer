import { ANALYSIS, BANDS } from '../config.js';
import { aWeightDb, clamp, dbToLin, linToDb } from './dsp.js';

/**
 * Turns one raw FFT frame (in dB) into the two band sets the engine reasons
 * about, plus an A-weighted loudness.
 *
 *   bandsDb  — seven perceptual bands, the source of bass/mid/treble
 *   fluxDb   — ~28 log-spaced bands, the resolution onset detection runs at
 *
 * Frequencies are resolved to bins from the live sampleRate, so a 44.1kHz mic
 * and a 48kHz system capture see the same musical bands.
 */
export class Spectrum {
    constructor(fftSize, sampleRate) {
        this.fftSize = fftSize;
        this.sampleRate = sampleRate;
        this.binHz = sampleRate / fftSize;
        this.binCount = fftSize / 2;

        this.bandNames = Object.keys(BANDS);
        this.bandRanges = this.bandNames.map((name) => this.binRange(BANDS[name]));
        this.bandsDb = new Float32Array(this.bandNames.length);

        const [lo, hi] = ANALYSIS.fluxRange;
        const n = ANALYSIS.fluxBands;
        this.fluxRanges = [];
        this.fluxWeights = new Float32Array(n);

        for (let i = 0; i < n; i++) {
            const f0 = lo * Math.pow(hi / lo, i / n);
            const f1 = lo * Math.pow(hi / lo, (i + 1) / n);
            const center = Math.sqrt(f0 * f1);
            this.fluxRanges.push(this.binRange([f0, f1]));
            this.fluxWeights[i] = aWeightDb(center);
        }
        this.fluxDb = new Float32Array(n);

        this.loudnessDb = ANALYSIS.hardFloorDb;
    }

    /** Inclusive-exclusive bin range for a [lowHz, highHz] pair. */
    binRange([fLo, fHi]) {
        const lo = clamp(Math.round(fLo / this.binHz), 1, this.binCount - 1);
        const hi = clamp(Math.round(fHi / this.binHz), lo + 1, this.binCount);
        return [lo, hi];
    }

    /** Mean linear magnitude across a bin range, expressed back in dB. */
    static meanDb(data, [lo, hi]) {
        let sum = 0;
        for (let i = lo; i < hi; i++) {
            const db = data[i];
            // Guards the -Infinity the Web Audio API emits for empty bins.
            if (db > -180) sum += dbToLin(db);
        }
        return linToDb(sum / (hi - lo));
    }

    analyse(data) {
        for (let i = 0; i < this.bandRanges.length; i++) {
            this.bandsDb[i] = Spectrum.meanDb(data, this.bandRanges[i]);
        }

        const n = this.fluxDb.length;
        let linSum = 0;

        for (let i = 0; i < n; i++) {
            const db = Spectrum.meanDb(data, this.fluxRanges[i]);
            this.fluxDb[i] = db;

            const weighted = db + this.fluxWeights[i];
            const mag = dbToLin(weighted);
            linSum += mag;
        }

        this.loudnessDb = linToDb(linSum / n);
    }
}
