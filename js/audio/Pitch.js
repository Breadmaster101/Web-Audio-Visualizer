import { ANALYSIS } from '../config.js';
import { clamp, dbToLin, ema } from './dsp.js';

const midiToHz = (note) => 440 * Math.pow(2, (note - 69) / 12);

/**
 * Fundamental-pitch tracking in two registers, bass and lead.
 *
 * Chroma answers "which pitch classes are sounding"; this answers "what note
 * is the bass on, and what note is the lead on", with the octave.
 *
 * Each frame the tonal peaks of the spectrum are found, with their frequency
 * refined between bins. Every candidate fundamental is then scored against
 * those peaks: a peak that falls on one of its first few harmonics counts for
 * it, more for the lower harmonics, and a peak inside its harmonic range that
 * is *not* one of its harmonics counts against it. The best candidate in each
 * register wins.
 *
 * Both halves of that matter. Summing harmonics is what makes the low register
 * possible at all: a 4096-point transform at 48kHz is ~11.7Hz per bin, four
 * semitones at 40Hz, so a bass fundamental on its own cannot be placed to the
 * note, but its upper harmonics are resolved far better and all agree on where
 * it must be. It also finds a note whose fundamental is weak or missing, which
 * is common for bass. The penalty is what stops the lowest candidates winning
 * everything: their harmonics are packed so close together that some will land
 * near almost any partial, and only the partials they fail to explain give
 * them away. The decaying harmonic weights keep it off the octave below, which
 * explains the same peaks but only as even, lower-weighted harmonics.
 *
 * A candidate must also have at least two of its first four harmonics present.
 * Without that, the bass register would happily report a note two octaves
 * under a lone lead line, built from nothing but the lead's own overtones.
 *
 * The registers are searched bass first, and the peaks the bass note accounts
 * for are removed before the lead is searched. The bass's harmonics run
 * straight up through the lead's range and each would otherwise look like a
 * lead note of its own.
 *
 * Salience is measured as Chroma measures it — each bin against its own
 * spectral neighbourhood — so drums and noise, which are flat, contribute
 * almost nothing however loud they are.
 *
 * Confidence is the share of the register's peaks, by salience, that the
 * winning note accounts for. One clear note explains most of them; a dense
 * chord or noise explains few.
 *
 * Each register reports `note` (a fractional MIDI number), `hz` and
 * `confidence` (0..1). A register holds its last note while its confidence is
 * low, so a visual following it does not fall to an arbitrary pitch the moment
 * the bass player stops.
 */
export class Pitch {
    constructor(fftSize, sampleRate) {
        const A = ANALYSIS;
        this.binHz = sampleRate / fftSize;
        const binCount = fftSize / 2;

        // Salience is needed up to just past the last harmonic of the highest
        // lead candidate, where the unexplained-peak count stops.
        const topHz = midiToHz(A.pitchLeadRange[1]) * (A.pitchHarmonics + 0.5);
        this.binHi = Math.min(binCount, Math.ceil(topHz / this.binHz) + 2);
        this.salience = new Float32Array(this.binHi);

        this.harmonicWeights = Array.from({ length: A.pitchHarmonics },
            (_, h) => Math.pow(A.pitchHarmonicDecay, h));
        this.matched = new Float32Array(A.pitchHarmonics);

        this.bass = this.createRegister(A.pitchBassRange);
        this.lead = this.createRegister(A.pitchLeadRange);
    }

    createRegister([loNote, hiNote]) {
        const step = ANALYSIS.pitchStepSemitones;
        const notes = [];
        for (let note = loNote; note <= hiNote + 1e-6; note += step) notes.push(note);
        const note = (loNote + hiNote) / 2;
        return {
            notes,
            candidates: notes.map(midiToHz),
            scores: new Float32Array(notes.length),
            loHz: midiToHz(loNote) * 0.97,
            hiHz: midiToHz(hiNote) * (ANALYSIS.pitchHarmonics + 0.5),
            history: [],
            note,
            hz: midiToHz(note),
            confidence: 0
        };
    }

    /**
     * @param {Float32Array} data  Raw FFT frame in dB.
     * @param {number} dt          Frame delta in seconds.
     * @param {boolean} active     False during silence: confidence decays and
     *                             notes hold.
     */
    analyse(data, dt, active) {
        let peaks = [];
        if (active) {
            this.measureSalience(data);
            peaks = this.findPeaks();
        }

        const claimed = this.track(this.bass, peaks, dt);
        this.track(this.lead, claimed ? this.cancel(peaks, claimed) : peaks, dt);
    }

    /**
     * Take the bass note's contribution out of the peaks before the lead is
     * searched.
     *
     * Not by deleting its harmonics: a lead an octave or two above the bass
     * shares partials with it, and deleting them would take the lead's notes
     * away with the bass's. Instead each harmonic loses only what the bass is
     * expected to put there, estimated from the harmonics either side of it —
     * an instrument's harmonic amplitudes change smoothly along the series, so
     * a harmonic standing well above its neighbours has something else
     * sounding on top of it, and that excess is left for the lead.
     *
     * @param {Map<object, number>} claimed  Bass peaks, each with its harmonic number.
     */
    cancel(peaks, claimed) {
        const byHarmonic = new Map();
        for (const [peak, k] of claimed) byHarmonic.set(k, peak.value);

        return peaks.map((peak) => {
            const k = claimed.get(peak);
            if (k === undefined) return peak;
            const below = byHarmonic.get(k - 1);
            const above = byHarmonic.get(k + 1);
            const neighbours = [below, above].filter((v) => v !== undefined);
            const expected = neighbours.length
                ? neighbours.reduce((a, b) => a + b, 0) / neighbours.length
                : peak.value;
            return { hz: peak.hz, value: Math.max(0, peak.value - Math.min(peak.value, expected)) };
        });
    }

    /**
     * How far each bin stands above its neighbourhood, gated to tonal peaks.
     * The same running-mean background as Chroma uses, over a wider range.
     *
     * The contribution is compressed (square root of magnitude): one loud
     * partial should not outvote several consistent quieter ones, since the
     * agreement of the harmonics is the whole point of summing them.
     */
    measureSalience(data) {
        const A = ANALYSIS;
        const w = A.chromaBackgroundBins;
        const floor = -140;
        const hi = this.binHi;
        const last = Math.min(data.length - 1, hi + w - 1);
        const at = (i) => (data[i] > floor ? data[i] : floor);

        let sum = 0;
        let count = 0;
        let head = 1;
        let tail = 1;

        for (let bin = 1; bin < hi; bin++) {
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
            const excess = db - (count > 0 ? sum / count : floor) - A.chromaSalienceDb;
            const gate = excess > 0 ? Math.min(1, excess / A.chromaSalienceKneeDb) : 0;
            this.salience[bin] = gate > 0 ? Math.sqrt(dbToLin(db)) * gate : 0;
        }
    }

    /** Local maxima of the salience, each with a frequency refined between bins. */
    findPeaks() {
        const s = this.salience;
        const peaks = [];
        for (let b = 2; b < this.binHi - 1; b++) {
            const v = s[b];
            if (v <= 0 || v < s[b - 1] || v <= s[b + 1]) continue;
            const curve = s[b - 1] - 2 * v + s[b + 1];
            const offset = curve < 0 ? clamp(0.5 * (s[b - 1] - s[b + 1]) / curve, -0.5, 0.5) : 0;
            peaks.push({ hz: (b + offset) * this.binHz, value: v });
        }
        return peaks;
    }

    /**
     * Score one candidate against the peaks. Fills `this.matched` with the
     * salience found at each harmonic, and returns the score, or -Infinity if
     * too few of the first four harmonics are present to call it a note.
     */
    score(hz, peaks, from, to) {
        const A = ANALYSIS;
        const H = A.pitchHarmonics;
        const matched = this.matched;
        matched.fill(0);
        let unexplained = 0;
        const top = hz * (H + 0.5);
        const bottom = hz * 0.97;

        for (let i = from; i < to; i++) {
            const peak = peaks[i];
            if (peak.hz < bottom) continue;
            if (peak.hz > top) break;
            const k = Math.round(peak.hz / hz);
            const tolerance = Math.max(A.pitchToleranceBins * this.binHz, k * hz * A.pitchToleranceRatio);
            if (k >= 1 && k <= H && Math.abs(peak.hz - k * hz) <= tolerance) {
                if (peak.value > matched[k - 1]) matched[k - 1] = peak.value;
            } else {
                unexplained += peak.value;
            }
        }

        let low = 0;
        let lowSum = 0;
        let allSum = 0;
        for (let h = 0; h < H; h++) {
            allSum += matched[h];
            if (h < 4 && matched[h] > 0) {
                low++;
                lowSum += matched[h];
            }
        }
        if (low < 2) return -Infinity;
        // ...and they must carry a real share of the evidence. A low candidate
        // that matches stray noise peaks below and one strong partial far up
        // its series is somebody else's harmonic, not a note.
        if (lowSum < allSum * A.pitchLowShare) return -Infinity;
        // Only even harmonics present means every peak is also a harmonic of
        // the octave above, and that is the note: an octave-down reading.
        let odd = 0;
        for (let h = 0; h < H; h += 2) odd += matched[h];
        if (odd <= 0) return -Infinity;

        let total = 0;
        for (let h = 0; h < H; h++) total += this.harmonicWeights[h] * matched[h];
        return total - A.pitchUnexplainedPenalty * unexplained;
    }

    /**
     * Find this register's note among `peaks`. Returns the set of peaks the
     * note accounts for this frame, or null if it found none it trusts.
     */
    track(register, peaks, dt) {
        const A = ANALYSIS;
        let raw = 0;
        let claimed = null;

        // The slice of peaks any candidate in this register can reach.
        let from = 0;
        while (from < peaks.length && peaks[from].hz < register.loHz) from++;
        let to = from;
        let total = 0;
        while (to < peaks.length && peaks[to].hz <= register.hiHz) total += peaks[to++].value;

        if (to > from) {
            const { candidates, scores } = register;
            let best = -1;
            for (let i = 0; i < candidates.length; i++) {
                scores[i] = this.score(candidates[i], peaks, from, to);
                if (scores[i] > 0 && (best < 0 || scores[i] > scores[best])) best = i;
            }

            if (best >= 0) {
                // Parabolic refinement between candidates.
                let note = register.notes[best];
                const l = scores[best - 1];
                const r = scores[best + 1];
                if (Number.isFinite(l) && Number.isFinite(r)) {
                    const curve = l - 2 * scores[best] + r;
                    if (curve < 0) {
                        note += clamp(0.5 * (l - r) / curve, -0.5, 0.5) * A.pitchStepSemitones;
                    }
                }

                // Which peaks the winner accounts for. Its share of the
                // register's peaks is the confidence; every peak on its
                // harmonic series, well past the ones it was scored on, is
                // claimed, since a bass's upper harmonics reach far into the
                // lead's range.
                const hz = midiToHz(note);
                // One peak per harmonic, the strongest within tolerance.
                const strongest = new Map();
                let everything = 0;
                for (let i = 0; i < peaks.length; i++) {
                    const peak = peaks[i];
                    everything += peak.value;
                    const k = Math.round(peak.hz / hz);
                    const tolerance = Math.max(A.pitchToleranceBins * this.binHz, k * hz * A.pitchToleranceRatio);
                    if (k < 1 || k > A.pitchCancelHarmonics || Math.abs(peak.hz - k * hz) > tolerance) continue;
                    const held = strongest.get(k);
                    if (!held || peak.value > held.peak.value) strongest.set(k, { peak, i });
                }
                claimed = new Map();
                let mine = 0;
                for (const [k, { peak, i }] of strongest) {
                    claimed.set(peak, k);
                    if (k <= A.pitchHarmonics && i >= from && i < to) mine += peak.value;
                }
                // Explaining most of a nearly empty range is not a note: the
                // winner must also carry a real share of everything pitched in
                // the frame.
                const presence = clamp(mine / (everything * A.pitchPresence));
                raw = clamp((mine / total - A.pitchExplainedFloor) / A.pitchExplainedRange) * presence;

                if (raw >= A.pitchMinConfidence) {
                    // A short median over recent confident readings removes
                    // single-frame octave slips, delaying a genuine change by
                    // no more than a couple of frames.
                    register.history.push(note);
                    if (register.history.length > A.pitchMedianFrames) register.history.shift();
                    register.note = median(register.history);
                } else {
                    claimed = null;
                }
            }
        }

        register.confidence = ema(register.confidence, raw, dt, A.pitchConfidenceTau);
        register.hz = midiToHz(register.note);
        return claimed;
    }
}

function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
