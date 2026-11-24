import { ANALYSIS, BAND_GROUPS, CONFIG } from '../config.js';
import { clamp, ema, envelope, lerp, smoothLimit, smoothstep } from './dsp.js';
import { Spectrum } from './Spectrum.js';
import { BandNormalizer } from './BandNormalizer.js';
import { OnsetDetector } from './OnsetDetector.js';
import { TempoTracker } from './TempoTracker.js';

/**
 * The flare analysis engine. Taps the stream with its own FFT and turns each
 * frame into the values the visualizer draws, calibrating itself
 * continuously so that no genre needs a different sensitivity setting.
 *
 * The chain:
 *   spectrum      log-spaced perceptual bands + loudness
 *   normalizer    per-band floor/ceiling tracking, then per-band exponent
 *                 shaping toward a target average level
 *   onsets        spectral flux across all bands with an adaptive threshold
 *   tempo         autocorrelation of the novelty signal + a phase-locked grid
 *   AGC           slow master gain that holds overall activity at a target
 *   smoothing     attack/release times that adapt to the music's own pace
 *
 * Exposed to the visuals: bass, mid, treble, beat.
 */
export class FlareEngine {
    constructor() {
        this.analyser = null;
        this.source = null;
        this.data = null;

        this.autoSensitivity = true;
        /** Manual gain. Only consulted while `autoSensitivity` is off. */
        this.sensitivity = 1;

        this.bass = 0;
        this.mid = 0;
        this.treble = 0;
        this.smoothBass = 0;
        this.smoothMid = 0;
        this.smoothTreble = 0;
        this.beat = 0;
        this.beatDecay = 0;

        this.gain = 1;
        this.gate = 0;
        this.activity = ANALYSIS.agcTarget;

        this.loudCeil = ANALYSIS.hardFloorDb;
        this.loudEnvelope = ANALYSIS.hardFloorDb;
        this.settled = 0;

        this.configure(ANALYSIS.fftSize, 48000);
    }

    // --- Stream ----------------------------------------------------------

    /** Start listening to a live source node. */
    connect(context, source) {
        this.disconnect();
        this.analyser = context.createAnalyser();
        this.analyser.fftSize = ANALYSIS.fftSize;
        // The engine does its own time-aware smoothing; the built-in one would
        // blur the transients onset detection depends on.
        this.analyser.smoothingTimeConstant = 0;
        source.connect(this.analyser);
        this.source = source;

        // Float data keeps the full dynamic range. The byte API clamps to
        // minDecibels/maxDecibels, which throws away exactly the quiet detail
        // the adaptive normalizer needs to calibrate against.
        this.data = new Float32Array(this.analyser.frequencyBinCount);
        this.configure(this.analyser.fftSize, context.sampleRate);
    }

    /** Stop listening. Safe to call when nothing is connected. */
    disconnect() {
        if (!this.analyser) return;
        this.source.disconnect(this.analyser);
        this.analyser = null;
        this.source = null;
    }

    // --- Sensitivity -----------------------------------------------------

    setSensitivity({ auto, manual }) {
        this.autoSensitivity = auto;
        this.sensitivity = manual;
    }

    /**
     * Set the gain outright: the manual value, or where Auto last settled.
     *
     * With nothing saved, Auto starts mid-range: the loop lowers gain several
     * times faster than it raises it, so starting high costs a few seconds,
     * starting low a minute.
     */
    restoreGain(autoGain) {
        const [min, max] = ANALYSIS.agcRange;
        const start = Number.isFinite(autoGain) ? clamp(autoGain, min, max) : (min + max) / 2;
        this.gain = this.autoSensitivity ? start : this.sensitivity;
    }

    /** (Re)build everything that depends on the FFT geometry. */
    configure(fftSize, sampleRate) {
        if (this.spectrum
            && this.spectrum.fftSize === fftSize
            && this.spectrum.sampleRate === sampleRate) return;

        this.spectrum = new Spectrum(fftSize, sampleRate);
        this.bands = new BandNormalizer(this.spectrum.bandNames.length);
        this.onsets = new OnsetDetector(ANALYSIS.fluxBands);
        this.tempo = new TempoTracker();

        // Resolve the band-group weights to array indices once.
        this.groups = Object.entries(BAND_GROUPS).map(([key, weights]) => ({
            key,
            terms: Object.entries(weights).map(([name, weight]) => ({
                index: this.spectrum.bandNames.indexOf(name),
                weight
            }))
        }));
    }

    /** Pull and analyse a fresh frame. False while no stream is connected. */
    update(deltaTime) {
        if (!this.analyser) return false;
        this.analyser.getFloatFrequencyData(this.data);
        this.analyse(this.data, deltaTime);
        return true;
    }

    analyse(data, deltaTime) {
        const A = ANALYSIS;
        // rAF deltas spike on tab focus changes; a runaway dt would blow every
        // time constant open at once.
        const stalled = deltaTime > A.stallSeconds;
        const dt = clamp(deltaTime, 1 / 240, A.stallSeconds);

        const spectrum = this.spectrum;
        spectrum.analyse(data);

        // --- Silence gate, relative to the loudest recent moment -----------
        // The gate answers "is anything playing", so it runs off a loudness
        // envelope with a slow release rather than the instantaneous value.
        // Momentary loudness swings 40dB or more between a hit and the gap
        // after it; gating on that would chop the analysis into pieces.
        const loud = spectrum.loudnessDb;
        this.loudEnvelope = envelope(this.loudEnvelope, loud, dt,
            A.loudnessAttackTau, A.loudnessReleaseTau);
        this.loudCeil = Math.max(this.loudEnvelope, this.loudCeil - dt * A.gateFallDbPerSec);

        const gateDb = Math.max(this.loudCeil - A.gateRangeDb, A.absoluteGateDb);
        const active = this.loudEnvelope > gateDb;
        if (active) this.settled += dt;
        const readiness = clamp(this.settled / A.settleSeconds);
        this.gate = envelope(this.gate, smoothstep(gateDb, gateDb + 8, this.loudEnvelope), dt,
            A.gateOpenTau, A.gateCloseTau);

        const follow = clamp(CONFIG.loudnessFollow);
        this.bands.update(spectrum.bandsDb, dt, active, follow);
        this.onsets.update(spectrum.fluxDb, dt, active, stalled);

        this.tempo.push(this.onsets.flux, dt);
        this.tempo.tick(dt);
        this.tempo.advance(dt, this.onsets.strength);

        // --- Onset envelope, decaying in musical time ----------------------
        const beatRelease = clamp(this.tempo.period * 0.34, 0.10, 0.42);
        this.beatDecay = Math.max(
            this.onsets.strength,
            this.beatDecay * Math.exp(-dt / (beatRelease * 0.55))
        );

        // --- Fold the calibrated bands into the three visual drivers -------
        const raw = {};
        for (const group of this.groups) {
            let value = 0;
            for (const term of group.terms) value += this.bands.out[term.index] * term.weight;
            raw[group.key] = value;
        }

        // --- Auto sensitivity ----------------------------------------------
        // A closed loop on the *delivered* level, not on the raw signal. The
        // asymmetric smoothing below biases the output above its own input, so
        // regulating the input would consistently overshoot; measuring what the
        // shader actually receives makes agcTarget mean exactly what it says.
        if (active) {
            const delivered = (this.smoothBass + this.smoothMid + this.smoothTreble) / 3;
            // The loop measures over a longer window too, so that it sets the
            // song's overall level without chasing its sections.
            this.activity = ema(this.activity, delivered, dt,
                lerp(A.agcTau, A.followAgcTau, follow));
        }

        if (this.autoSensitivity) {
            const error = A.agcTarget - this.activity;

            // Raising gain is the one direction that can misbehave. When the
            // bands read low it is usually not because the gain is wrong: it is
            // silence, or a calibration that has not caught up with a track
            // change yet. Both resolve on their own, and integrating through
            // them just means the correct level arrives multiplied by whatever
            // the loop wound up to meanwhile. So gain only climbs on settled,
            // present audio; it is always free to come back down.
            const settledLevel = (this.loudCeil - this.loudEnvelope) < A.staleCeilingDb;
            const mayRaise = active && readiness >= 1
                && this.activity > A.agcFloor && settledLevel;
            if (error < 0 || mayRaise) {
                const rate = error > 0 ? A.agcRiseRate : A.agcFallRate;
                this.gain = clamp(this.gain * (1 + error * rate * dt),
                    A.agcRange[0], A.agcRange[1]);
            }
        } else {
            this.gain = ema(this.gain, this.sensitivity, dt, 0.2);
        }

        const g = this.gain * this.gate;

        // --- Smoothing that follows the music's own pace -------------------
        // Fast material wants short releases so hits stay separate; slow or
        // sustained material wants long ones so it breathes instead of
        // flickering. When the tempo is known it sets the scale directly, which
        // is both more musical and far steadier than counting onsets.
        const release = this.tempo.confidence > 0.3
            ? clamp(this.tempo.period * A.releaseBeats, A.releaseFast, A.releaseSlow)
            : lerp(A.releaseSlow, A.releaseFast, clamp(this.onsets.rate / A.motionRate));

        // Smooth first, limit second. Limiting the target would put a
        // non-linearity in front of the averaging, which makes the result
        // depend on how often the spiky target happens to be sampled — i.e. on
        // the display's refresh rate.
        this.smoothBass = envelope(this.smoothBass, raw.bass * g, dt, A.attack.bass, release);
        this.smoothMid = envelope(this.smoothMid, raw.mid * g, dt, A.attack.mid, release * 1.25);
        this.smoothTreble = envelope(this.smoothTreble, raw.treble * g, dt, A.attack.treble, release * 0.7);

        // Trim sits outside the auto-gain loop on purpose. The loop regulates
        // whatever it measures, so a trim folded in before the measurement
        // would be quietly cancelled out again within a few seconds. Scaling
        // the finished output — limiter headroom included, so "wilder" really
        // does get wilder — is what makes it a lasting taste control.
        const limit = (v) => smoothLimit(v, A.limitKnee, A.limitCeiling) * CONFIG.trim;

        this.bass = limit(this.smoothBass);
        this.mid = limit(this.smoothMid);
        this.treble = limit(this.smoothTreble);
        this.beat = limit(this.beatDecay * g);
    }
}
