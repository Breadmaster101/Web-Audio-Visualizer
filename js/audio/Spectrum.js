import { ANALYSIS, BANDS } from '../config.js';
import { aWeightDb, clamp, dbToLin, linToDb } from './dsp.js';

/**
 * Turns one raw FFT frame (in dB) into the two band sets the engine reasons
 * about, plus the timbre descriptors used to classify the material.
 *
 *   bandsDb  — seven perceptual bands, the source of bass/mid/treble
 *   fluxDb   — ~28 log-spaced bands, the resolution onset detection runs at
 *   detailDb — a much finer log-spaced set, for the visuals that draw the
 *              spectrum itself rather than a three-value fold of it
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
        this.logCenters = new Float32Array(n);

        for (let i = 0; i < n; i++) {
            const f0 = lo * Math.pow(hi / lo, i / n);
            const f1 = lo * Math.pow(hi / lo, (i + 1) / n);
            const center = Math.sqrt(f0 * f1);
            this.fluxRanges.push(this.binRange([f0, f1]));
            this.fluxWeights[i] = aWeightDb(center);
            this.logCenters[i] = Math.log2(center);
        }
        this.fluxDb = new Float32Array(n);

        // The detail set is built the same way, just finer. It is kept separate
        // from the flux set because the two want opposite things: onset
        // detection wants few wide bands so one transient lifts most of them at
        // once, and a picture of the spectrum wants as many as the transform
        // will support.
        const [dLo, dHi] = ANALYSIS.detailRange;
        const dn = ANALYSIS.detailBands;
        this.detailRanges = [];
        this.detailWeights = new Float32Array(dn);
        for (let i = 0; i < dn; i++) {
            const f0 = dLo * Math.pow(dHi / dLo, i / dn);
            const f1 = dLo * Math.pow(dHi / dLo, (i + 1) / dn);
            this.detailRanges.push(this.binRange([f0, f1]));
            this.detailWeights[i] = aWeightDb(Math.sqrt(f0 * f1));
        }
        this.detailDb = new Float32Array(dn);

        // Centroid is mapped across the range music actually occupies, not the
        // full audible span — anchoring it at 20Hz and 20kHz would leave every
        // real track bunched around the middle with nothing to show.
        this.centroidLo = Math.log2(150);
        this.centroidHi = Math.log2(6000);

        this.centroid = 0.5;   // 0 dark .. 1 airy, log-frequency spectral centroid
        this.flatness = 0.5;   // 0 tonal .. 1 noisy
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
        let dbSum = 0;
        let logFreqSum = 0;

        for (let i = 0; i < n; i++) {
            const db = Spectrum.meanDb(data, this.fluxRanges[i]);
            this.fluxDb[i] = db;

            const weighted = db + this.fluxWeights[i];
            const mag = dbToLin(weighted);
            linSum += mag;
            dbSum += weighted;
            logFreqSum += mag * this.logCenters[i];
        }

        const arithmeticDb = linToDb(linSum / n);
        const geometricDb = dbSum / n;

        this.loudnessDb = arithmeticDb;

        // Geometric/arithmetic ratio: near 0 dB for noise, deeply negative for a
        // pure tone. Percussion and distortion push it up, strings and pads down.
        this.flatness = clamp((geometricDb - arithmeticDb + 45) / 45);

        for (let i = 0; i < this.detailDb.length; i++) {
            this.detailDb[i] = Spectrum.meanDb(data, this.detailRanges[i]) + this.detailWeights[i];
        }

        const centroidLog = linSum > 1e-9 ? logFreqSum / linSum : this.centroidLo;
        this.centroid = clamp((centroidLog - this.centroidLo) / (this.centroidHi - this.centroidLo));
    }
}
