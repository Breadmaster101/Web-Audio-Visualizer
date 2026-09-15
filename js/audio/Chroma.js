import { ANALYSIS } from '../config.js';
import { clamp, dbToLin, ema } from './dsp.js';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * Krumhansl-Kessler key profiles: how strongly each scale degree is expected to
 * sound in a major and a minor key. Correlating the measured pitch-class vector
 * against all twelve rotations of both gives a key estimate.
 *
 * These are perceptual ratings from listening experiments rather than note
 * counts, which is why the leading tone scores so far above the other chromatic
 * degrees — it *sounds* keyed even though it is comparatively rare.
 */
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** Mean-centred and unit-normalised once, so the per-frame match is a dot product. */
function centre(profile) {
    const mean = profile.reduce((a, b) => a + b, 0) / profile.length;
    const centred = profile.map((v) => v - mean);
    const norm = Math.sqrt(centred.reduce((a, b) => a + b * b, 0));
    return centred.map((v) => v / norm);
}

const PROFILES = [centre(MAJOR_PROFILE), centre(MINOR_PROFILE)];

/**
 * Folds the spectrum onto the twelve pitch classes, and from that estimates the
 * key the music is in.
 *
 * Every other descriptor the engine produces measures energy — how much of it,
 * where in the spectrum, how suddenly it arrived. This one measures harmony:
 * which notes are sounding, regardless of octave or instrument. Two
 * performances of the same chord on different instruments produce nearly the
 * same chroma vector, and a modulation shows up in it as a rotation.
 *
 * Every bin in range contributes to the two semitones it falls between, weighted
 * by how close it is to each. Assigning each bin to a single nearest semitone
 * would make the result depend on where the FFT's bin grid happens to land
 * relative to concert pitch, which is neither musical nor stable across the
 * sample rates system capture and mic capture produce.
 *
 * What a bin contributes is not its energy but its *salience* — how far it
 * stands above its own spectral neighbourhood. That distinction is the
 * difference between this working and not working. Summing raw energy gives an
 * almost perfectly flat vector for any real mix: a snare, a cymbal or a
 * distorted guitar spreads energy across every pitch class at once, and there
 * are two orders of magnitude more noise bins than tonal ones to spread it
 * over. Measured against its neighbourhood, a flat region contributes nothing
 * however loud it is, and only real partials survive.
 */
export class Chroma {
    constructor(fftSize, sampleRate) {
        const A = ANALYSIS;
        const binHz = sampleRate / fftSize;
        const binCount = fftSize / 2;
        const [loNote, hiNote] = A.chromaRange;
        const spread = A.chromaSpreadCents / 100;

        this.values = new Float32Array(12);   // 0..1 strength per pitch class
        this.raw = new Float32Array(12);
        this.keyScores = new Float32Array(24); // 12 major keys, then 12 minor
        this.keyVector = new Float32Array(12); // values with harmonic leakage removed
        this.energy = 0;                       // total tonal energy, 0..1
        this.tonality = 0;                     // 0 = no key at all, 1 = unambiguous
        this.tonic = 0;                        // pitch class 0..11
        this.isMinor = false;

        // One pass over the bins up front, recording which pitch classes each
        // one feeds. Per frame this would cost a log2 and two divisions per bin.
        this.terms = [];
        const loHz = 440 * Math.pow(2, (loNote - 69) / 12);
        const hiHz = 440 * Math.pow(2, (hiNote - 69) / 12);

        this.binLo = Math.max(1, Math.floor(loHz / binHz));
        this.binHi = Math.min(binCount, Math.ceil(hiHz / binHz) + 1);
        this.salience = new Float32Array(this.binHi - this.binLo);

        for (let bin = 1; bin < binCount; bin++) {
            const hz = bin * binHz;
            if (hz < loHz || hz > hiHz) continue;

            // Fractional MIDI note number for this bin's centre frequency.
            const note = 69 + 12 * Math.log2(hz / 440);
            const lower = Math.floor(note);
            const frac = note - lower;

            // Triangular split between the two neighbouring semitones. A spread
            // wider than one semitone blurs on purpose, which is what keeps a
            // source that is not quite at concert pitch from smearing across
            // the wrong classes.
            const wLo = clamp(1 - frac / spread);
            const wHi = clamp(1 - (1 - frac) / spread);

            // Toward the register the notes are actually played in, and away
            // from the one only their upper harmonics reach.
            const octaves = Math.log2(hz / A.chromaCentreHz) / A.chromaOctaveWidth;
            const octaveWeight = Math.exp(-0.5 * octaves * octaves);

            if (wLo > 0) {
                this.terms.push({ bin, pc: ((lower % 12) + 12) % 12, weight: wLo * octaveWeight });
            }
            if (wHi > 0) {
                this.terms.push({ bin, pc: (((lower + 1) % 12) + 12) % 12, weight: wHi * octaveWeight });
            }
        }
    }

    get tonicName() {
        return NOTE_NAMES[this.tonic];
    }

    /** Something like "F# min", or an empty string while no key is established. */
    get keyName() {
        if (this.tonality < 0.18) return '';
        return NOTE_NAMES[this.tonic] + (this.isMinor ? ' min' : ' maj');
    }

    /**
     * @param {Float32Array} data  Raw FFT frame in dB.
     * @param {number} dt          Frame delta in seconds.
     * @param {boolean} active     False during silence, which freezes the key
     *                             estimate rather than letting it drift onto
     *                             whatever shape the noise floor happens to have.
     */
    analyse(data, dt, active) {
        const A = ANALYSIS;

        this.raw.fill(0);
        if (active) {
            this.measureSalience(data);
            for (const { bin, pc, weight } of this.terms) {
                this.raw[pc] += this.salience[bin - this.binLo] * weight;
            }
        }

        // Scaled against the loudest class rather than against the sum. A sum
        // would make the vector's shape depend on how many classes are sounding
        // at once: one held note and a dense chord would normalise to the same
        // total, and the chord's individual notes would then read as weaker
        // than the single note, which is backwards.
        let peak = 0;
        for (let i = 0; i < 12; i++) peak = Math.max(peak, this.raw[i]);

        // Broadband content lifts all twelve together. Subtracting a floor
        // proportional to the peak stops that reading as a twelve-note chord —
        // which is otherwise exactly what a cymbal crash looks like here.
        const floor = peak * A.chromaFloor;
        const span = Math.max(peak - floor, 1e-9);

        let sum = 0;
        for (let i = 0; i < 12; i++) {
            const value = peak > 1e-9 ? clamp((this.raw[i] - floor) / span) : 0;
            this.values[i] = ema(this.values[i], value, dt, A.chromaTau);
            sum += this.values[i];
        }

        this.energy = clamp(sum / 4);
        this.estimateKey(dt);
    }

    /**
     * The pitch-class vector with harmonic leakage taken back out.
     *
     * A note's third harmonic is a fifth above it (seven semitones, allowing
     * for the octave) and its fifth harmonic a major third above (four), so a
     * sustained C deposits genuine energy on G and E whether or not either is
     * being played. Subtracting a share of each class from the two it leaks
     * into recovers something much closer to the notes themselves.
     *
     * Only the key estimate sees this. The wheel draws `values`, because an
     * open fifth really does have a fifth sounding in it, and a display that
     * subtracted one would be showing an inference rather than the music.
     */
    suppressHarmonics() {
        const k = ANALYSIS.chromaHarmonicSuppression;
        for (let i = 0; i < 12; i++) {
            const leaked = k * this.values[(i + 5) % 12]      // this class as a third harmonic
                + k * 0.6 * this.values[(i + 8) % 12];        // ...and as a fifth harmonic
            this.keyVector[i] = Math.max(0, this.values[i] - leaked);
        }
    }

    /**
     * How far each bin stands above its own spectral neighbourhood, in dB.
     *
     * The background is a plain moving average in the dB domain rather than a
     * median. A median is the more principled choice and materially better at
     * ignoring the very peaks it is measuring around, but it costs a sort per
     * bin per frame; over a wide window the mean is pulled up by a partial by
     * only a decibel or two, and the threshold below absorbs that.
     *
     * Working in dB rather than in linear magnitude is what makes one window
     * width serve the whole range: a partial sits a roughly constant number of
     * decibels above the noise around it whether it is at 130Hz or 2kHz, while
     * in linear terms the same partial is orders of magnitude different.
     */
    measureSalience(data) {
        const A = ANALYSIS;
        const w = A.chromaBackgroundBins;
        const floor = -140;
        const lo = this.binLo;
        const hi = this.binHi;

        // Running sum over the window, so the pass is linear in bins rather
        // than quadratic. Both ends are clamped to the range rather than
        // wrapped — there is nothing on the other side of DC worth averaging
        // against.
        const first = Math.max(1, lo - w);
        const last = Math.min(data.length - 1, hi + w - 1);
        const at = (i) => (data[i] > floor ? data[i] : floor);

        let sum = 0;
        let count = 0;
        let head = first;
        let tail = first;

        for (let bin = lo; bin < hi; bin++) {
            while (head <= Math.min(bin + w, last)) {
                sum += at(head);
                head++;
                count++;
            }
            while (tail < bin - w) {
                sum -= at(tail);
                tail++;
                count--;
            }

            const db = at(bin);
            const background = count > 0 ? sum / count : floor;
            const excess = db - background - A.chromaSalienceDb;

            // Magnitude, gated by tonality — not the excess itself. The gate
            // says whether this bin is a partial at all; the magnitude says how
            // much it should count for.
            const gate = excess > 0 ? Math.min(1, excess / A.chromaSalienceKneeDb) : 0;
            this.salience[bin - lo] = gate > 0 ? dbToLin(db) * gate : 0;
        }
    }

    /**
     * Correlate the pitch-class vector against all 24 key profiles.
     *
     * The scores are smoothed, not the decision. Taking the argmax per frame and
     * smoothing that would flicker between a key and its relative major or minor
     * on every passing chord, because those two profiles genuinely score within
     * a hair of each other and the winner changes constantly. Averaging the
     * correlations over a few seconds and deciding afterwards lets the key of
     * the passage win over the chord of the moment.
     */
    estimateKey(dt) {
        this.suppressHarmonics();

        let sum = 0;
        let sumSq = 0;
        for (let i = 0; i < 12; i++) {
            sum += this.keyVector[i];
            sumSq += this.keyVector[i] * this.keyVector[i];
        }

        const mean = sum / 12;
        const norm = Math.sqrt(Math.max(sumSq - 12 * mean * mean, 0));
        if (norm < 1e-6) {
            this.tonality = ema(this.tonality, 0, dt, ANALYSIS.chromaKeyTau);
            return;
        }

        let best = -Infinity;
        let second = -Infinity;
        let bestIndex = 0;

        for (let mode = 0; mode < 2; mode++) {
            const profile = PROFILES[mode];
            for (let tonic = 0; tonic < 12; tonic++) {
                let acc = 0;
                for (let degree = 0; degree < 12; degree++) {
                    acc += (this.keyVector[(tonic + degree) % 12] - mean) * profile[degree];
                }

                const index = mode * 12 + tonic;
                const score = ema(this.keyScores[index], acc / norm, dt, ANALYSIS.chromaKeyTau);
                this.keyScores[index] = score;

                if (score > best) {
                    second = best;
                    best = score;
                    bestIndex = index;
                } else if (score > second) {
                    second = score;
                }
            }
        }

        this.tonic = bestIndex % 12;
        this.isMinor = bestIndex >= 12;

        // Confidence is how far the winner stands clear of the runner-up, not
        // its absolute correlation. A well-defined key beats its neighbours by a
        // margin; an atonal or purely percussive passage produces a dozen
        // near-ties at whatever level, and only the margin separates those two.
        this.tonality = clamp(best * 0.6 + Math.max(best - second, 0) * 2.2);
    }
}

export { NOTE_NAMES };
