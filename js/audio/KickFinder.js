import { clamp, ema, smoothstep } from './dsp.js';
import { KickDetector } from './KickDetector.js';

/** Where a kick might be, in Hz. Narrow enough to tell apart, so they overlap. */
const CANDIDATES = [[30, 58], [42, 80], [58, 110], [80, 150]];

/** Seconds of music before anything is chosen, and a lead has to last. */
const LEARN_SECONDS = 8;
const LEAD_SECONDS = 3;

/** How many times better than the current range another has to be. */
const CLEARLY = 1.8;

/** Gap, in dB, beyond which a range is clean enough and more earns nothing. */
const CLEAN_GAP = 16;

/** Hits per second: too few to be the kick, and as many as a bassline plays. */
const RATE_FEW = 0.4;
const RATE_MANY = [2.6, 4.2];
const RATE_TAU = 5;

/** Spread of the hits' levels, in dB, at which they stop looking like one drum. */
const SPREAD = 4;

/** How fast the level quantiles move, in dB per second. */
const QUANTILE_RATE = 24;

/** A range this many dB under the loudest one is not where the kick is. */
const LEVEL_RANGE = 14;

/** Seconds of silence taken as the end of a song. */
const GAP_SECONDS = 1.5;

/**
 * Listens for the kick in several low ranges at once, and learns which one this
 * song keeps it in.
 *
 * A kick is a hit: the level in its range is high briefly and low in between,
 * while a held bass keeps its range high throughout. So each range is scored on
 * the gap between its loud moments and its usual ones, as long as its loud
 * moments are among the loudest. A plucked bassline does that too, so the
 * hits must also come at a kick's pace and land about as hard each time, as one
 * drum does and a line of different notes does not. The fixed range competes on
 * the same terms,
 * and stands until something is clearly better for a while.
 *
 * Every range has its own running detector, so changing between them takes effect
 * at once with nothing to settle.
 */
export class KickFinder {
    constructor(context, source) {
        this.fixed = new KickDetector(context, source);
        this.ears = [this.fixed, ...CANDIDATES.map(([lo, hi]) => new KickDetector(context, source, lo, hi))];
        this.reset();
    }

    reset() {
        this.learned = this.fixed;
        this.heard = 0;
        this.quiet = 0;
        this.leader = null;
        this.leadFor = 0;
        for (const ear of this.ears) {
            ear.high = ear.usual = null;
            ear.rate = 0;
            ear.hitMean = null;
            ear.hitVar = 0;
        }
    }

    get kick() {
        return this.learned.kick;
    }

    get fired() {
        return this.learned.fired;
    }

    /** Always the fixed range's: where the kick is says nothing of the bass. */
    get sustain() {
        return this.fixed.sustain;
    }

    /** @param {number} gate  0..1, whether anything is playing. */
    update(dt, gate) {
        for (const ear of this.ears) ear.update(dt);

        if (gate < 0.2) {
            this.quiet += dt;
            if (this.quiet > GAP_SECONDS && this.heard > 0) this.reset();
            return;
        }
        this.quiet = 0;
        if (gate > 0.5) this.learn(dt);
    }

    learn(dt) {
        this.heard += dt;
        let loudest = -Infinity;
        for (const ear of this.ears) {
            if (ear.high === null) ear.high = ear.usual = ear.db;
            // Running quantiles: the level exceeded a tenth of the time, and
            // half of it.
            const step = QUANTILE_RATE * dt;
            ear.high += step * (ear.db > ear.high ? 0.9 : -0.1);
            ear.usual += step * (ear.db > ear.usual ? 0.5 : -0.5);
            loudest = Math.max(loudest, ear.high);

            ear.rate = ema(ear.rate, ear.fired ? 1 / dt : 0, dt, RATE_TAU);
            if (ear.fired) {
                if (ear.hitMean === null) ear.hitMean = ear.db;
                const off = ear.db - ear.hitMean;
                ear.hitMean += off * 0.15;
                ear.hitVar += (off * off - ear.hitVar) * 0.15;
            }
        }
        if (this.heard < LEARN_SECONDS) return;

        const score = (ear) => clamp(ear.high - ear.usual, 0, CLEAN_GAP)
            * smoothstep(0, RATE_FEW, ear.rate)
            * (1 - 0.8 * smoothstep(...RATE_MANY, ear.rate))
            / (1 + Math.sqrt(ear.hitVar) / SPREAD)
            * clamp(1 - (loudest - ear.high) / LEVEL_RANGE);
        let best = this.learned;
        for (const ear of this.ears) if (score(ear) > score(best)) best = ear;

        if (best === this.learned || score(best) < score(this.learned) * CLEARLY) {
            this.leader = null;
            return;
        }
        if (best !== this.leader) {
            this.leader = best;
            this.leadFor = 0;
        }
        this.leadFor += dt;
        if (this.leadFor > LEAD_SECONDS) {
            this.learned = best;
            this.leader = null;
        }
    }

    dispose() {
        for (const ear of this.ears) ear.dispose();
    }
}
