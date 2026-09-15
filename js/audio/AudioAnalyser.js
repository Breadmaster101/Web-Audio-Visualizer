import { ANALYSIS, BAND_GROUPS, CONFIG } from '../config.js';
import { clamp, ema, envelope, lerp, smoothLimit, smoothstep } from './dsp.js';
import { Spectrum } from './Spectrum.js';
import { BandNormalizer } from './BandNormalizer.js';
import { OnsetDetector } from './OnsetDetector.js';
import { TempoTracker } from './TempoTracker.js';
import { Chroma } from './Chroma.js';

/**
 * The analysis engine. Turns a raw FFT frame into the values the visuals
 * consume, calibrating itself continuously so that no genre needs a different
 * sensitivity setting.
 *
 * The chain:
 *   spectrum      log-spaced perceptual bands + timbre descriptors
 *   normalizer    per-band floor/ceiling tracking, then per-band exponent
 *                 shaping toward a target average level
 *   onsets        spectral flux across all bands with an adaptive threshold
 *   tempo         autocorrelation of the novelty signal + a phase-locked grid
 *   AGC           slow master gain that holds overall activity at a target
 *   smoothing     attack/release times that adapt to the music's own pace
 *
 * Exposed to the visuals: bass, mid, treble, beat, pulse, tilt, crest,
 * level, bpm, confidence, gain, gate, profile — plus, for the visualisers that
 * draw the spectrum or the harmony directly rather than a fold of them,
 * `detail` (a fine calibrated band set), `chroma` (pitch classes and key) and
 * `flatness` (tonal against noisy).
 */
export class AudioAnalyser {
    constructor(fftSize = ANALYSIS.fftSize, sampleRate = 48000) {
        this.bass = 0;
        this.mid = 0;
        this.treble = 0;
        this.smoothBass = 0;
        this.smoothMid = 0;
        this.smoothTreble = 0;
        this.beat = 0;
        this.pulse = 0;
        this.beatDecay = 0;

        this.gain = 1;
        this.gate = 0;
        this.level = 0;
        this.tilt = 0.5;
        this.crest = 0.5;
        this.flatness = 0.5;
        this.activity = ANALYSIS.agcTarget;

        this.loudCeil = ANALYSIS.hardFloorDb;
        this.loudEnvelope = ANALYSIS.hardFloorDb;
        this.settled = 0;
        this.loudMean = ANALYSIS.hardFloorDb;
        this.loudPeak = ANALYSIS.hardFloorDb;

        this.configure(fftSize, sampleRate);
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
        this.chroma = new Chroma(fftSize, sampleRate);

        // The detail set gets the same per-band calibration the perceptual
        // bands do, for the same reason: without it a visualiser drawing the
        // spectrum shows one shape for every track, dominated by wherever that
        // master happens to put its energy, instead of showing the music.
        this.detailBands = new BandNormalizer(ANALYSIS.detailBands);
        this.detail = new Float32Array(ANALYSIS.detailBands);

        // Resolve the band-group weights to array indices once.
        this.groups = Object.entries(BAND_GROUPS).map(([key, weights]) => ({
            key,
            terms: Object.entries(weights).map(([name, weight]) => ({
                index: this.spectrum.bandNames.indexOf(name),
                weight
            }))
        }));
    }

    get bpm() {
        return this.tempo.confidence > ANALYSIS.minConfidence ? this.tempo.bpm : 0;
    }

    get confidence() {
        return this.tempo.confidence;
    }

    /** Beats of the grid so far. Increments through silence once tempo is known. */
    get beatIndex() {
        return this.tempo.beatIndex;
    }

    /** True for exactly the frame a grid beat lands on. */
    get beatFired() {
        return this.tempo.beatFired;
    }

    /** Seconds per beat. Falls back to a 2Hz default before tempo is known. */
    get beatPeriod() {
        return this.tempo.period;
    }

    /** Detected key, e.g. "F# min", or an empty string while none is established. */
    get key() {
        return this.chroma.keyName;
    }

    /** Short human-readable description of the material the engine is hearing. */
    get profile() {
        if (this.gate < 0.35) return 'Listening';

        const rate = this.onsets.rate;
        const driven = this.tempo.confidence > 0.4 && rate > 1.4;
        const texture = driven ? 'Percussive' : rate < 0.8 ? 'Sustained' : 'Mixed';
        const tone = this.tilt > 0.58 ? 'Bright' : this.tilt < 0.34 ? 'Dark' : 'Even';
        return `${texture} / ${tone}`;
    }

    update(data, deltaTime) {
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
        this.detailBands.update(spectrum.detailDb, dt, active, follow);
        this.onsets.update(spectrum.fluxDb, dt, active, stalled);
        this.chroma.analyse(data, dt, active);

        this.tempo.push(this.onsets.flux, dt);
        this.tempo.tick(dt);
        this.tempo.advance(dt, this.onsets.strength);

        // --- Timbre + dynamics --------------------------------------------
        this.tilt = ema(this.tilt, active ? spectrum.centroid : 0.5, dt, 0.8);
        this.flatness = ema(this.flatness, active ? spectrum.flatness : 0.5, dt, 0.6);

        if (active) {
            this.loudMean = ema(this.loudMean, loud, dt, 3.0);
            this.loudPeak = loud > this.loudPeak ? loud : ema(this.loudPeak, loud, dt, 3.0);
        }
        // Crest factor: how much headroom the track leaves above its own
        // average. Compressed masters sit near 0, acoustic recordings much higher.
        this.crest = ema(this.crest,
            clamp((this.loudPeak - this.loudMean) / A.crestRangeDb), dt, 1.5);
        this.level = clamp((this.loudEnvelope - (this.loudCeil - A.gateRangeDb)) / A.gateRangeDb);

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

        if (CONFIG.autoSensitivity) {
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
            this.gain = ema(this.gain, CONFIG.sensitivity, dt, 0.2);
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
        this.pulse = limit(this.tempo.pulse * clamp(this.tempo.confidence) * g);

        // The detail set takes the same gain and limiter as the three bands, so
        // a visualiser drawing it sits at the same level as one drawing them,
        // and the Sensitivity and Trim controls mean one thing across all modes.
        for (let i = 0; i < this.detail.length; i++) {
            this.detail[i] = limit(this.detailBands.out[i] * g);
        }
    }
}
