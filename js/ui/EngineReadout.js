import { ANALYSIS } from '../config.js';
import { ema } from '../audio/dsp.js';

/** Text is only legible if it holds still; the bars can run free. */
const TEXT_INTERVAL = 0.15;
/** Below this, the particle count is doing more harm than good. */
const SLOW_FPS = 50;

const PLACEHOLDER = '—';

/**
 * The telemetry panel: what the analysis engine has locked onto, plus the
 * three values actually handed to the shader this frame and a frame-rate
 * warning tied to the particle count.
 *
 * Numeric text is refreshed a few times a second rather than every frame —
 * digits changing at 60Hz are not readable, and at these sizes the flicker is
 * worse than the lag. The band bars are graphical, so they update every frame
 * where the smoothness is worth having.
 */
export class EngineReadout {
    constructor() {
        this.el = {
            bpm: document.getElementById('val-bpm'),
            conf: document.getElementById('val-conf'),
            onsets: document.getElementById('val-onsets'),
            gate: document.getElementById('val-gate'),
            gain: document.getElementById('val-gain'),
            crest: document.getElementById('val-crest'),
            key: document.getElementById('val-key'),
            fps: document.getElementById('val-fps'),
            profile: document.getElementById('val-profile')
        };

        this.bands = ['bass', 'mid', 'treble'].map((name) => ({
            name,
            bar: document.getElementById(`bar-${name}`),
            value: document.getElementById(`val-${name}`)
        }));

        this.elapsed = TEXT_INTERVAL;
        this.fps = 60;
        this.isFrameSlow = false;
    }

    update(metrics, isReady, deltaTime) {
        // A stalled frame — tab switch, GC pause, window drag — would drag the
        // average down for seconds and raise a performance warning about
        // something that was never the renderer's fault.
        if (deltaTime > 0 && deltaTime < ANALYSIS.stallSeconds) {
            this.fps = ema(this.fps, 1 / deltaTime, deltaTime, 1.0);
        }

        this.paintBands(metrics, isReady);

        this.elapsed += deltaTime;
        if (this.elapsed < TEXT_INTERVAL) return;
        this.elapsed = 0;

        this.isFrameSlow = this.fps < SLOW_FPS;
        this.el.fps.textContent = `${Math.round(this.fps)} FPS`;
        this.el.fps.classList.toggle('warn', this.isFrameSlow);

        if (!isReady) {
            this.paintIdle();
            return;
        }

        // Tempo is only worth showing once the tracker agrees with itself.
        this.el.bpm.textContent = metrics.bpm ? `${Math.round(metrics.bpm)} BPM` : 'Searching';
        this.el.conf.textContent = `${Math.round(metrics.confidence * 100)} %`;
        this.el.onsets.textContent = `${metrics.onsets.rate.toFixed(1)} /s`;
        this.el.gate.textContent = this.gateLabel(metrics.gate);
        this.el.gain.textContent = `${metrics.gain.toFixed(2)} x`;
        this.el.crest.textContent = `${Math.round(metrics.crest * 100)} %`;
        // Blank until the key estimate has stood clear of its runner-up for
        // long enough to mean anything. Percussion and atonal material never
        // get there, and showing a confident-looking key for them would be a lie.
        this.el.key.textContent = metrics.key || 'Atonal';
        this.el.profile.textContent = metrics.profile;
    }

    /** The gate is a continuous envelope, but three states is what you can act on. */
    gateLabel(gate) {
        if (gate > 0.65) return 'Open';
        if (gate > 0.2) return 'Closing';
        return 'Shut';
    }

    paintBands(metrics, isReady) {
        for (const band of this.bands) {
            const value = isReady ? metrics[band.name] : 0;
            // Bars are clamped for layout; the number beside them is not, so an
            // output riding the limiter's 1.10 ceiling is still visible as such.
            band.bar.style.width = `${Math.min(value, 1) * 100}%`;
            band.value.textContent = value.toFixed(2);
        }
    }

    paintIdle() {
        this.el.bpm.textContent = PLACEHOLDER;
        this.el.conf.textContent = PLACEHOLDER;
        this.el.onsets.textContent = PLACEHOLDER;
        this.el.gate.textContent = PLACEHOLDER;
        this.el.gain.textContent = PLACEHOLDER;
        this.el.crest.textContent = PLACEHOLDER;
        this.el.key.textContent = PLACEHOLDER;
        this.el.profile.textContent = 'Awaiting input';
    }
}
