import { ANALYSIS } from '../config.js';
import { clamp, ema, smoothstep } from './dsp.js';

const [LOW, HIGH] = ANALYSIS.chromaRange;
const COUNT = HIGH - LOW + 1;

/** The fixed weighting, as a MIDI note and a width in semitones. */
const HOME = 69 + 12 * Math.log2(ANALYSIS.chromaCentreHz / 440);
const HOME_WIDTH = ANALYSIS.chromaOctaveWidth * 12;

/** How far the learned weighting may move and how narrow or wide it may get. */
const CENTRE_LIMITS = [60, 80];
const WIDTH_LIMITS = [7, 16];

/** Seconds a note must last to count as harmony, and the profile averages over. */
const HELD_TAU = 0.3;
const PROFILE_TAU = 9;

/** Seconds the weighting takes to follow what has been learned. */
const FOLLOW_TAU = 3;

/** Share of each note taken off the notes its harmonics land on. */
const HARMONICS = [[12, 0.6], [19, 0.45], [24, 0.35], [28, 0.3]];

/** Seconds of music until the profile is fully trusted. */
const LEARN_SECONDS = 8;

const GAP_SECONDS = 1.5;

/**
 * Learns which octaves this song keeps its chords in.
 *
 * The engine weights every song's notes toward 330Hz. This keeps a long average
 * of where steadily held notes actually are, leaving out what is better
 * explained as an overtone of a note below, and centres the weighting there. It
 * moves slowly and by degrees, so there is never a moment it changes.
 */
export class ChordRange {
    constructor() {
        this.level = new Float32Array(COUNT);
        this.held = new Float32Array(COUNT);
        this.profile = new Float32Array(COUNT);
        /** Pitch-class energy under the learned weighting, as `Chroma.raw`. */
        this.raw = new Float32Array(12);
        this.terms = null;
        this.reset();
    }

    reset() {
        this.profile.fill(0);
        this.centre = HOME;
        this.width = HOME_WIDTH;
        this.heard = 0;
        this.quiet = 0;
    }

    /** Which semitones each of the chroma's bins feeds, and by how much. */
    buildTerms(chroma) {
        this.terms = [];
        this.source = chroma;
        for (let bin = chroma.binLo; bin < chroma.binHi; bin++) {
            const note = 69 + 12 * Math.log2(bin * chroma.binHz / 440);
            const lower = Math.floor(note);
            for (const [n, weight] of [[lower, 1 - (note - lower)], [lower + 1, note - lower]]) {
                if (n >= LOW && n <= HIGH && weight > 0) {
                    this.terms.push([bin - chroma.binLo, n - LOW, weight]);
                }
            }
        }
    }

    update(chroma, gate, dt) {
        if (this.source !== chroma) this.buildTerms(chroma);

        this.level.fill(0);
        for (const [bin, n, weight] of this.terms) this.level[n] += chroma.salience[bin] * weight;

        if (gate < 0.2) {
            this.quiet += dt;
            if (this.quiet > GAP_SECONDS && this.heard > 0) this.reset();
        } else {
            this.quiet = 0;
            if (gate > 0.5) this.learn(dt);
        }

        this.raw.fill(0);
        for (let i = 0; i < COUNT; i++) {
            const x = (LOW + i - this.centre) / this.width;
            this.raw[(LOW + i) % 12] += this.level[i] * Math.exp(-0.5 * x * x);
        }
    }

    learn(dt) {
        this.heard += dt;
        let peak = 1e-9;
        for (let i = 0; i < COUNT; i++) {
            // Root, so a loud note does not stand for the whole chord.
            const now = Math.sqrt(this.level[i]);
            this.held[i] = ema(this.held[i], now, dt, HELD_TAU);
            peak = Math.max(peak, this.held[i]);
        }

        let total = 0;
        let mean = 0;
        for (let i = 0; i < COUNT; i++) {
            let own = Math.min(this.held[i], Math.sqrt(this.level[i])) / peak;
            for (const [step, share] of HARMONICS) {
                if (i >= step) own -= share * this.held[i - step] / peak;
            }
            this.profile[i] = ema(this.profile[i], Math.max(0, own), dt, PROFILE_TAU);
            total += this.profile[i];
            mean += this.profile[i] * i;
        }
        if (total < 0.02) return;

        mean /= total;
        let spread = 0;
        for (let i = 0; i < COUNT; i++) spread += this.profile[i] * (i - mean) ** 2;
        spread = Math.sqrt(spread / total);

        const trust = smoothstep(LEARN_SECONDS * 0.3, LEARN_SECONDS, this.heard);
        const centre = clamp(LOW + mean, ...CENTRE_LIMITS);
        const width = clamp(spread * 1.6, ...WIDTH_LIMITS);
        this.centre = ema(this.centre, HOME + (centre - HOME) * trust, dt, FOLLOW_TAU);
        this.width = ema(this.width, HOME_WIDTH + (width - HOME_WIDTH) * trust, dt, FOLLOW_TAU);
    }
}
