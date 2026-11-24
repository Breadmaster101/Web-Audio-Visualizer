import { ANALYSIS, CONFIG } from '../config.js';
import { clamp, ema, smoothstep } from './dsp.js';
import { Loudness } from './Loudness.js';
import { Chroma } from './Chroma.js';
import { ChordRange } from './ChordRange.js';
import { ChordReader } from './ChordReader.js';
import { LeadReader } from './LeadReader.js';
import { KickFinder } from './KickFinder.js';

/**
 * The Chladni analysis engine: it listens for the parts of the music, not for
 * how much energy there is in each band.
 *
 *   loudness   whether anything is playing
 *   chroma     pitch classes and the key
 *   chords     where the chords sit in this song, and which notes sound together
 *   lead       the lead note
 *   kick       the kick and the sustained bass, on their own low-latency tap
 *
 * Exposed to the visuals: kick, sustain, kickFired, strength, lift, weights,
 * leadHeight, tonic, isMinor, tonality.
 */
export class ChladniEngine {
    constructor() {
        this.analyser = null;
        this.source = null;
        this.data = null;
        this.kickFinder = null;
        this.sampleRate = 0;

        this.autoSensitivity = true;
        /** Manual gain. Only consulted while `autoSensitivity` is off. */
        this.sensitivity = 1;
        this.gain = 1;

        // These carry over when the source changes.
        this.chordRange = new ChordRange();
        this.chords = new ChordReader();

        this.kick = 0;
        this.sustain = 0;
        this.kickFired = false;
        this.strength = 0;
        this.lift = 0;

        this.configure(ANALYSIS.fftSize, 48000);
    }

    // --- Stream ----------------------------------------------------------

    /** Start listening to a live source node. */
    connect(context, source) {
        this.disconnect();
        this.analyser = context.createAnalyser();
        this.analyser.fftSize = ANALYSIS.fftSize;
        // The readers do their own time-aware smoothing.
        this.analyser.smoothingTimeConstant = 0;
        source.connect(this.analyser);
        this.source = source;

        this.data = new Float32Array(this.analyser.frequencyBinCount);
        this.kickFinder = new KickFinder(context, source);
        this.configure(this.analyser.fftSize, context.sampleRate);
    }

    /** Stop listening. Safe to call when nothing is connected. */
    disconnect() {
        if (!this.analyser) return;
        this.kickFinder.dispose();
        this.kickFinder = null;
        this.source.disconnect(this.analyser);
        this.analyser = null;
        this.source = null;
    }

    /** (Re)build everything that depends on the FFT geometry. */
    configure(fftSize, sampleRate) {
        if (this.sampleRate === sampleRate) return;
        this.sampleRate = sampleRate;
        this.loudness = new Loudness(fftSize, sampleRate);
        this.chroma = new Chroma(fftSize, sampleRate);
        this.lead = new LeadReader(fftSize, sampleRate);
    }

    // --- Sensitivity -----------------------------------------------------

    setSensitivity({ auto, manual }) {
        this.autoSensitivity = auto;
        this.sensitivity = manual;
    }

    /** Every detector calibrates itself, so Auto is always a gain of 1. */
    restoreGain() {
        this.gain = this.autoSensitivity ? 1 : this.sensitivity;
    }

    // --- Analysis --------------------------------------------------------

    /** Strength of each of the twelve pitch classes in the chord, C first. */
    get weights() {
        return this.chords.weights;
    }

    get leadHeight() {
        return this.lead.height;
    }

    get tonic() {
        return this.chroma.tonic;
    }

    get isMinor() {
        return this.chroma.isMinor;
    }

    get tonality() {
        return this.chroma.tonality;
    }

    /** Pull and analyse a fresh frame. False while no stream is connected. */
    update(deltaTime) {
        if (!this.analyser) return false;
        this.analyser.getFloatFrequencyData(this.data);

        // rAF deltas spike on tab focus changes; a runaway dt would blow every
        // time constant open at once.
        const dt = clamp(deltaTime, 1 / 240, ANALYSIS.stallSeconds);
        this.loudness.update(this.data, dt);
        const { gate, active } = this.loudness;
        this.chroma.analyse(this.data, dt, active);

        this.kickFinder.update(deltaTime, gate);
        this.lead.update(this.data, gate, deltaTime);
        this.chordRange.update(this.chroma, gate, deltaTime);
        this.chords.update(this.chordRange.raw, gate, deltaTime, this.lead);
        this.lift = this.chords.change * smoothstep(0.2, 0.6, this.chords.distance);

        this.gain = ema(this.gain, this.autoSensitivity ? 1 : this.sensitivity, dt, 0.2);
        const gain = CONFIG.trim * this.gain * gate;
        this.kick = clamp(this.kickFinder.kick * gain, 0, 1.2);
        this.sustain = clamp(this.kickFinder.sustain * gain, 0, 1.2);
        this.kickFired = this.kickFinder.fired;
        this.strength = clamp(gain, 0, 1.2);
        return true;
    }
}
