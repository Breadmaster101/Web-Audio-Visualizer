import { clamp, ema, envelope, linToDb, smoothstep } from './dsp.js';

/**
 * Low end only, filtered to where a kick's body sits. Steep enough that a
 * snare's fundamental, around 180Hz, stays well out of it.
 */
const LOWPASS_HZ = 105;
const HIGHPASS_HZ = 28;

/**
 * Seconds of signal each level reading covers. Just over one cycle of a 50Hz
 * kick: shorter and the reading ripples with the waveform itself, longer and
 * the hit arrives late.
 */
const WINDOW_SECONDS = 0.021;

/** How far back, in seconds, a rise in level is measured from. */
const RISE_SECONDS = 0.09;

/** Nothing below this is music. */
const SILENCE_DB = -75;

/** The loudest recent low end is forgotten at this rate, in dB per second. */
const CEIL_FALL = 0.8;

/**
 * Bounds on the rise, in dB, a full-strength hit is expected to make. A kick on
 * its own climbs out of silence; one over a held bassline only adds a few dB,
 * so the expectation follows what the track actually does, between these.
 */
const RISE_RANGE = [5, 12];
const RISE_FORGET_TAU = 6;

/** Re-arm and fire levels, and the shortest gap, for counting separate hits. */
const FIRE = 0.5;
const REARM = 0.2;
const MIN_GAP = 0.14;

/**
 * Hears the kick, and the sustained bass under it, separately.
 *
 * The engine's onset detector listens to every band at once, so a snare scores
 * higher on it than a kick does. Its bass level is a good measure of how much
 * low end there is but cannot tell a kick from a held note. And both read a
 * 4096-point FFT, whose window is 85ms long. This is a separate tap: the
 * stream through its own low-pass filters into a short time-domain buffer, read
 * as a level every frame.
 *
 * The kick is how sharply that level has *risen*, so a bassline held at any
 * volume leaves it at zero, and how close it has come to the loudest recent low
 * end, so a rumble in a quiet passage does too. It is a continuous amount, not
 * a detection, so a borderline hit comes out as a faint one rather than as a
 * flash that appears or not by luck. `fired` counts the clear ones.
 */
export class KickDetector {
    /**
     * @param {BaseAudioContext} context
     * @param {AudioNode} source  Left otherwise untouched; `dispose` unhooks it.
     * @param {number} lowHz    The range listened to.
     * @param {number} highHz
     */
    constructor(context, source, lowHz = HIGHPASS_HZ, highHz = LOWPASS_HZ) {
        this.source = source;
        this.range = [lowHz, highHz];

        const filter = (type, frequency) => {
            const node = context.createBiquadFilter();
            node.type = type;
            node.frequency.value = frequency;
            node.Q.value = 0;   // dB: flat, no resonance at the corner
            return node;
        };
        // The low-pass twice, for 24dB per octave. The high-pass too for a range
        // that has to keep out a bassline below it, rather than just rumble.
        this.nodes = [
            filter('highpass', lowHz),
            ...(lowHz > HIGHPASS_HZ ? [filter('highpass', lowHz)] : []),
            filter('lowpass', highHz),
            filter('lowpass', highHz)
        ];

        this.tap = context.createAnalyser();
        const wanted = WINDOW_SECONDS * context.sampleRate;
        this.tap.fftSize = 2 ** Math.round(Math.log2(wanted));
        this.samples = new Float32Array(this.tap.fftSize);

        let node = source;
        for (const next of [...this.nodes, this.tap]) {
            node.connect(next);
            node = next;
        }

        this.db = SILENCE_DB;
        this.history = [];          // [seconds ago, dB], newest last
        this.ceil = SILENCE_DB + 15;
        this.riseRef = RISE_RANGE[1];
        this.armed = true;
        this.sinceHit = 1;

        /** How hard a kick is landing this instant, 0..1. */
        this.kick = 0;
        /** Level of the low end that stays, 0..1. */
        this.sustain = 0;
        /** True for exactly the frame a clear hit lands on. */
        this.fired = false;
    }

    update(dt) {
        this.tap.getFloatTimeDomainData(this.samples);
        let sum = 0;
        for (const v of this.samples) sum += v * v;
        this.push(linToDb(Math.sqrt(sum / this.samples.length)), dt);
    }

    /** One level reading, in dB. Separate from `update` so it can be tested. */
    push(db, dt) {
        this.db = Math.max(db, SILENCE_DB);
        this.sinceHit += dt;
        this.ceil = Math.max(SILENCE_DB + 15, db, this.ceil - CEIL_FALL * dt);

        // The lowest level in the recent past is what this one rose from.
        let floor = db;
        for (const entry of this.history) {
            entry[0] += dt;
            floor = Math.min(floor, entry[1]);
        }
        this.history.push([0, db]);
        while (this.history[0][0] > RISE_SECONDS) this.history.shift();

        // Measured from no further down than 18dB under the ceiling, so the
        // depth of the silence before a hit does not decide how big it is.
        const rise = Math.max(0, db - Math.max(floor, this.ceil - 18));
        const near = smoothstep(-13, -4, db - this.ceil);
        if (near > 0.5 && rise > this.riseRef) this.riseRef = Math.min(rise, RISE_RANGE[1]);
        this.riseRef = Math.max(RISE_RANGE[0], ema(this.riseRef, RISE_RANGE[0], dt, RISE_FORGET_TAU));

        const audible = smoothstep(SILENCE_DB, SILENCE_DB + 10, db);
        this.kick = smoothstep(0.45, 0.9, rise / this.riseRef) * near * audible;

        this.fired = this.armed && this.kick > FIRE && this.sinceHit > MIN_GAP;
        if (this.fired) {
            this.armed = false;
            this.sinceHit = 0;
        } else if (this.kick < REARM) {
            this.armed = true;
        }

        const level = clamp((db - (this.ceil - 22)) / 22) * audible;
        this.sustain = envelope(this.sustain, level, dt, 0.22, 0.3);
    }

    dispose() {
        this.source.disconnect(this.nodes[0]);
        for (const node of this.nodes) node.disconnect();
        this.tap.disconnect();
    }
}
