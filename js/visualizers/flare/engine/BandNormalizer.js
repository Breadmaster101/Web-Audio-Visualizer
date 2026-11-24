import { ANALYSIS } from '../config.js';
import { clamp, ema, lerp } from './dsp.js';

/**
 * Per-band automatic calibration — the core of "works on any genre".
 *
 * Stage 1: every band tracks its own noise floor and recent ceiling in dB. The
 * floor drops onto quiet passages quickly and creeps back up slowly; the
 * ceiling does the reverse. Dividing by that live window means a band always
 * fills 0..1 with whatever range it actually uses, so a hi-hat-only mix and a
 * sub-heavy one both reach the top of the scale.
 *
 * Stage 2: each band watches the average of its own output and bends it through
 * an exponent until that average lands on `targetLevel`. This is what stops a
 * brick-walled master from sitting pinned near 1.0 with no visible movement,
 * and stops a sparse acoustic track from never leaving the floor. The exponent
 * moves over seconds, so it reads as the visualiser settling into a track
 * rather than as pumping.
 */
export class BandNormalizer {
    constructor(count) {
        this.floor = new Float32Array(count).fill(-90);
        this.ceil = new Float32Array(count).fill(-50);
        this.mean = new Float32Array(count).fill(ANALYSIS.targetLevel);
        this.gamma = new Float32Array(count).fill(1);
        this.norm = new Float32Array(count);
        this.out = new Float32Array(count);
        this.primed = false;
    }

    /**
     * Snap the tracking window onto the first frame of real audio.
     *
     * Starting from fixed constants means the window is wrong by however far
     * the source happens to sit from them — on a quiet stream the ceiling can
     * begin 40dB high, which reads every band as near-zero for the several
     * seconds it takes to decay. Anything watching those bands concludes the
     * signal is tiny and compensates hard, right up until the calibration
     * arrives and the real levels land on top of that compensation.
     */
    prime(bandsDb) {
        const half = ANALYSIS.minRangeDb / 2;
        for (let i = 0; i < bandsDb.length; i++) {
            const db = Math.max(bandsDb[i], ANALYSIS.hardFloorDb);
            this.floor[i] = db - half;
            this.ceil[i] = db + half;
            this.mean[i] = ANALYSIS.targetLevel;
            this.gamma[i] = 1;
        }
        this.primed = true;
    }

    /**
     * @param {Float32Array} bandsDb  Per-band level in dB.
     * @param {number} dt             Frame delta in seconds.
     * @param {boolean} active        False during silence; freezes adaptation so
     *                                a gap between tracks cannot drag the
     *                                calibration onto the noise floor.
     * @param {number} follow         0..1. Stretches the calibration windows so
     *                                a passage is measured against the rest of
     *                                the song rather than against itself.
     */
    update(bandsDb, dt, active, follow = 0) {
        const A = ANALYSIS;

        if (active && !this.primed) this.prime(bandsDb);

        // Only the *decay* sides stretch. A new peak must still be caught
        // immediately or transients would be clipped off the top.
        const ceilFallTau = lerp(A.ceilFallTau, A.followCeilFallTau, follow);
        const floorRiseTau = lerp(A.floorRiseTau, A.followFloorRiseTau, follow);
        const meanTau = lerp(A.meanTau, A.followMeanTau, follow);

        for (let i = 0; i < bandsDb.length; i++) {
            const db = Math.max(bandsDb[i], A.hardFloorDb);

            if (active) {
                this.floor[i] = ema(this.floor[i], db, dt,
                    db < this.floor[i] ? A.floorFallTau : floorRiseTau);
                this.ceil[i] = ema(this.ceil[i], db, dt,
                    db > this.ceil[i] ? A.ceilRiseTau : ceilFallTau);

                // Keep a sane minimum window so near-static bands stay calm
                // instead of amplifying their own dither into full-scale noise.
                const minCeil = this.floor[i] + A.minRangeDb;
                if (this.ceil[i] < minCeil) this.ceil[i] = minCeil;
            }

            const norm = clamp((db - this.floor[i]) / (this.ceil[i] - this.floor[i]));
            this.norm[i] = norm;

            if (active) {
                this.mean[i] = ema(this.mean[i], norm, dt, meanTau);
                // Solving mean^g = target for g re-centres the band's output.
                const want = Math.log(A.targetLevel) / Math.log(clamp(this.mean[i], 0.03, 0.97));
                this.gamma[i] = ema(this.gamma[i],
                    clamp(want, A.gammaRange[0], A.gammaRange[1]), dt, A.gammaTau);
            }

            // Re-centring a band is precisely what erases a quiet passage, so
            // the exponent is faded toward neutral as follow rises. What is
            // given up is the correction that keeps a compressed master from
            // sitting pinned high — which is the trade the control exists for.
            this.out[i] = Math.pow(norm, lerp(this.gamma[i], 1, follow));
        }
    }
}
