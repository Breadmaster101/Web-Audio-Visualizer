import { clamp, ema, envelope, lerp, smoothstep } from './dsp.js';

/** How many pitch classes may sound at once. Three or four notes is a chord. */
const VOICES = 4;

/**
 * Exponent on each class's share of the loudest. Under 1, so the chord under a
 * loud lead still counts.
 */
const COMPRESSION = 0.5;

/**
 * How much of each class is taken off the classes its harmonics land on: the
 * third harmonic a fifth up, the fifth harmonic a major third up.
 */
const FIFTH_LEAK = 0.2;
const THIRD_LEAK = 0.1;

/** Seconds of averaging before the notes are picked, so a drum hit is ignored. */
const LISTEN_TAU = 0.16;

/**
 * The same three while the notes are changing. Steadiness is only worth its
 * delay while there is something to be steady on.
 */
const QUICK = { listen: 0.04, attack: 0.04, release: 0.06 };

/**
 * Two more ears, a fast and a slow, and how far apart they must hear before the
 * notes count as changing. They listen uncompressed, where the notes that are
 * sounding tower over the ones that are not. The distance is 1 - cosine: a drum
 * hit, which adds a little of everything, barely turns the vector.
 */
const FAST_TAU = 0.03;
const SLOW_TAU = 0.3;
const CHANGE = [0.06, 0.16];

/** Seconds the quickened response outlasts the disagreement. */
const CHANGE_RELEASE = 0.12;

/** Evens out the notes that were picked, so a chord is not all its loudest note. */
const EVENNESS = 0.6;

/** Seconds each note takes to come into the chord and to leave it. */
const ATTACK = 0.12;
const RELEASE = 0.22;

/**
 * Which notes are sounding together, as twelve smooth weights.
 *
 * Reads the engine's unsmoothed pitch-class energies and picks out the strongest
 * few. There is no chord recognition: nothing is named, so nothing can be named
 * wrongly, and material that is not chords still gives an answer. The picking is
 * done by subtracting the fifth-strongest class from all of them rather than by
 * choosing a set, so a note crossing that line enters at zero and grows.
 *
 * When nothing stands out (drums alone, noise, silence) the weights hold where
 * they were instead of following the noise.
 */
export class ChordReader {
    constructor() {
        this.share = new Float32Array(12);
        this.fast = new Float32Array(12);
        this.slow = new Float32Array(12);
        this.heard = new Float32Array(12);
        this.clean = new Float32Array(12);
        this.sorted = new Float32Array(12);
        this.target = new Float32Array(12);

        /** The weights, C first. Their squares sum to about 1. */
        this.weights = new Float32Array(12);
        this.weights[0] = this.weights[4] = this.weights[7] = 0.577;
        /** How clearly some notes stand out from the rest, 0..1. */
        this.clarity = 0;
        /** How much the notes are changing right now, 0..1. */
        this.change = 0;
        /** How far the weights still are from the notes being heard, 0..1. */
        this.distance = 0;
    }

    /**
     * @param {Float32Array} raw  Energy per pitch class this frame, any scale.
     * @param {number} gate       0..1, whether anything is playing.
     * @param {?object} lead      A LeadReader, whose note is kept from
     *                            outweighing the chord it is played over.
     */
    update(raw, gate, dt, lead = null) {
        let peak = 0;
        for (const v of raw) peak = Math.max(peak, v);
        for (let i = 0; i < 12; i++) {
            this.share[i] = peak > 1e-9 ? Math.pow(raw[i] / peak, COMPRESSION) : 0;
        }
        if (lead) this.quieten(lead);

        let dot = 0;
        let fastSq = 0;
        let slowSq = 0;
        for (let i = 0; i < 12; i++) {
            const linear = this.share[i] ** (1 / COMPRESSION);
            this.fast[i] = ema(this.fast[i], linear, dt, FAST_TAU);
            this.slow[i] = ema(this.slow[i], linear, dt, SLOW_TAU);
            dot += this.fast[i] * this.slow[i];
            fastSq += this.fast[i] ** 2;
            slowSq += this.slow[i] ** 2;
        }
        const turned = fastSq * slowSq > 1e-9 ? 1 - dot / Math.sqrt(fastSq * slowSq) : 0;
        this.change = envelope(this.change, smoothstep(CHANGE[0], CHANGE[1], turned), dt,
            0.015, CHANGE_RELEASE);
        const listen = lerp(LISTEN_TAU, QUICK.listen, this.change);
        for (let i = 0; i < 12; i++) this.heard[i] = ema(this.heard[i], this.share[i], dt, listen);

        let top = 0;
        for (let i = 0; i < 12; i++) {
            const leak = FIFTH_LEAK * this.heard[(i + 5) % 12]
                + THIRD_LEAK * this.heard[(i + 8) % 12];
            this.clean[i] = Math.max(0, this.heard[i] - leak);
            top = Math.max(top, this.clean[i]);
        }

        this.sorted.set(this.clean);
        this.sorted.sort();
        const cut = this.sorted[11 - VOICES];
        this.clarity = top > 1e-6 ? clamp((top - cut) / top) : 0;

        let norm = 0;
        for (let i = 0; i < 12; i++) {
            this.target[i] = Math.pow(Math.max(0, this.clean[i] - cut), EVENNESS);
            norm += this.target[i] ** 2;
        }
        norm = Math.sqrt(norm);
        if (norm < 1e-6) return;

        // Slowing time rather than scaling the target: an unclear moment stops
        // the chord moving without fading it.
        const pace = dt * smoothstep(0.25, 0.5, this.clarity) * smoothstep(0.2, 0.5, gate);
        const attack = lerp(ATTACK, QUICK.attack, this.change);
        const release = lerp(RELEASE, QUICK.release, this.change);
        let gap = 0;
        for (let i = 0; i < 12; i++) {
            gap += (this.target[i] / norm - this.weights[i]) ** 2;
            this.weights[i] = envelope(this.weights[i], this.target[i] / norm, pace, attack, release);
        }
        this.distance = dt > 0 ? clamp(Math.sqrt(gap) * pace / dt) : 0;
    }

    /** Hold the lead's note to no more than the third-strongest class. */
    quieten(lead) {
        this.sorted.set(this.share);
        this.sorted.sort();
        const pc = lead.pitchClass;
        const held = Math.min(this.share[pc], this.sorted[9]);
        this.share[pc] = lerp(this.share[pc], held, lead.presence);
    }
}
