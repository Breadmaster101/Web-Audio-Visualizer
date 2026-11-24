import { clamp, dbToLin, ema, envelope } from './dsp.js';

/** MIDI notes searched for the lead: C4 (262Hz) to E6 (1319Hz). */
const RANGE = [60, 88];

/** MIDI notes measured: the lead's range, an octave below, and its harmonics. */
const LOW = 48;
const HIGH = 116;

/** Harmonics counted toward a note: (semitones above it, weight). */
const HARMONICS = [[0, 1], [12, 0.6], [19, 0.45], [24, 0.3], [28, 0.2]];

/** What a note's lower octave costs it, so an overtone is not taken for a note. */
const OCTAVE_PENALTY = 0.6;

/**
 * Seconds for a held note to become background, and for it to be forgotten.
 * Chords are held for longer than a melody's notes are.
 */
const BACKGROUND_TAU = 0.6;
const FORGET_TAU = 0.2;
const BACKGROUND_SHARE = 0.9;

/** How far the best note must lead the next, as a share of it, to be believed. */
const MARGIN = 0.12;
/** How much of the loudest recent level it must amount to. */
const PRESENCE = 0.2;

/** Seconds a note must stay the best before it counts. */
const HOLD_SECONDS = 0.045;

/** Seconds the glide to a new note takes: slow, so it reads as a drift. */
const GLIDE_TAU = 0.2;

/**
 * The lead note in a full mix.
 *
 * The engine's pitch tracker asks which one note explains the spectrum, which
 * has no answer once a chord is sounding. This asks which note is *moving*: each
 * semitone's level is measured against its own recent past, so whatever is being
 * held sinks into the background and what has just been played stands out of it.
 * The strongest of those, counted with its harmonics, is the lead.
 *
 * Nothing clear changes nothing: the last note stands. `ChordReader` uses it to
 * keep the melody from outweighing the chord it is played over.
 */
export class LeadReader {
    constructor(fftSize, sampleRate) {
        this.fftSize = fftSize;
        this.sampleRate = sampleRate;
        const count = HIGH - LOW + 1;
        const binHz = sampleRate / fftSize;
        this.ranges = [];
        for (let n = LOW; n <= HIGH; n++) {
            const hz = (note) => 440 * 2 ** ((note - 69) / 12);
            const lo = Math.max(1, Math.round(hz(n - 0.45) / binHz));
            const hi = Math.min(fftSize / 2 - 1, Math.max(lo, Math.round(hz(n + 0.45) / binHz)));
            this.ranges.push([lo, hi]);
        }
        this.background = new Float32Array(count);
        this.fresh = new Float32Array(count);
        this.scores = new Float32Array(RANGE[1] - RANGE[0] + 1);
        this.loudest = 1e-6;

        this.candidate = -1;
        this.heldFor = 0;
        this.middle = (RANGE[0] + RANGE[1]) / 2;
        this.note = this.middle;

        /** Gliding height of the lead, -1 at the bottom of the range to 1. */
        this.height = 0;
        /** How clearly a lead is playing, 0..1. */
        this.presence = 0;
    }

    /** @param {Float32Array} data  Raw FFT frame in dB. */
    update(data, gate, dt) {
        let peak = 0;
        for (let i = 0; i < this.ranges.length; i++) {
            let db = -140;
            for (let b = this.ranges[i][0]; b <= this.ranges[i][1]; b++) db = Math.max(db, data[b]);
            // Square root: between magnitude, where one partial is everything,
            // and decibels, where the noise floor is.
            const level = Math.sqrt(dbToLin(Math.max(db, -140)));
            peak = Math.max(peak, level);
            this.fresh[i] = Math.max(0, level - BACKGROUND_SHARE * this.background[i]);
            this.background[i] = envelope(this.background[i], level, dt, BACKGROUND_TAU, FORGET_TAU);
        }
        this.loudest = Math.max(peak, ema(this.loudest, peak, dt, 3), 1e-6);

        let best = 0;
        for (let i = 0; i < this.scores.length; i++) {
            const at = RANGE[0] - LOW + i;
            let score = -OCTAVE_PENALTY * this.fresh[at - 12];
            for (const [step, weight] of HARMONICS) score += weight * this.fresh[at + step];
            // A note with no fundamental of its own is another note's shadow.
            this.scores[i] = Math.min(score, this.fresh[at] * 3);
            if (this.scores[i] > this.scores[best]) best = i;
        }
        let next = 0;
        for (let i = 0; i < this.scores.length; i++) {
            if (Math.abs(i - best) > 1) next = Math.max(next, this.scores[i]);
        }
        const top = this.scores[best];
        const clear = top > this.loudest * PRESENCE && top > next * (1 + MARGIN) && gate > 0.3;

        if (clear) {
            if (best !== this.candidate) {
                this.candidate = best;
                this.heldFor = 0;
            }
            this.heldFor += dt;
            if (this.heldFor >= HOLD_SECONDS) this.note = RANGE[0] + best;
        } else {
            this.candidate = -1;
        }
        this.presence = envelope(this.presence, clear ? 1 : 0, dt, 0.05, 0.6);

        const height = clamp((this.note - this.middle) / (RANGE[1] - this.middle), -1, 1);
        this.height = ema(this.height, height, dt, GLIDE_TAU);
    }

    /** Pitch class of the held note, 0..11. */
    get pitchClass() {
        return this.note % 12;
    }
}
