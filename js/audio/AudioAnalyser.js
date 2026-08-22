import { CONFIG, BANDS } from '../config.js';

/**
 * Turns a raw analyser buffer into the smoothed bass/mid/treble/beat values the
 * shader consumes. The chain is: raw energy -> auto-gain normalization against a
 * decaying global peak -> beat detection -> user sensitivity -> attack/release
 * smoothing. Auto-gain is what lets quiet and loud tracks both reach ~1.0.
 */
export class AudioAnalyser {
    constructor() {
        this.bass = 0;
        this.mid = 0;
        this.treble = 0;
        this.beatDecay = 0;
        this.history = new Array(40).fill(0);
        this.peakGlobal = 0.01; // Start low so it adapts upward quickly.
    }

    /** Mean magnitude of an analyser bin range, normalized to 0..1. */
    static energy(dataArray, [minBin, maxBin]) {
        let sum = 0;
        for (let i = minBin; i < maxBin; i++) sum += dataArray[i];
        return (sum / (maxBin - minBin)) / 255.0;
    }

    /** Asymmetric lerp: rises at `attack`, falls at `release`. */
    static smooth(current, target, attack, release) {
        return current + (target - current) * (target > current ? attack : release);
    }

    update(dataArray, deltaTime) {
        // 1. Raw energy per band.
        const rawBass = Math.pow(AudioAnalyser.energy(dataArray, BANDS.bass), 1.4);
        const rawMid = AudioAnalyser.energy(dataArray, BANDS.mid);
        const rawTreble = AudioAnalyser.energy(dataArray, BANDS.treble);

        // 2. Track a decaying global peak for auto-gain.
        this.peakGlobal = Math.max(this.peakGlobal * 0.995, rawBass, rawMid);
        const peak = Math.max(this.peakGlobal, 0.01); // Prevent divide by zero.

        // 3. Normalize against that peak.
        const normBass = rawBass / peak;
        const normMid = rawMid / peak;
        const normTreble = rawTreble / peak;

        // 4. Beat detection on true normalized bass, independent of the slider.
        const averageBass = this.history.reduce((a, b) => a + b) / this.history.length;
        this.history.shift();
        this.history.push(normBass);

        if (normBass > averageBass * 1.3 && normBass > 0.3 && this.beatDecay < 0.1) {
            this.beatDecay = 1.0;
        } else {
            this.beatDecay = Math.max(0, this.beatDecay - deltaTime * 4.0);
        }

        // 5. User sensitivity as an absolute multiplier.
        const targetBass = normBass * CONFIG.sensitivity;
        const targetMid = normMid * CONFIG.sensitivity;
        const targetTreble = normTreble * CONFIG.sensitivity;

        // 6. Smooth the final output.
        this.bass = AudioAnalyser.smooth(this.bass, targetBass, 0.4, 0.08);
        this.mid = AudioAnalyser.smooth(this.mid, targetMid, 0.3, 0.1);
        this.treble = AudioAnalyser.smooth(this.treble, targetTreble, 0.6, 0.15);
    }

    /** Beat envelope scaled by sensitivity, for visual use. */
    get beat() {
        return this.beatDecay * CONFIG.sensitivity;
    }
}
