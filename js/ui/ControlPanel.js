import { CONFIG, ANALYSIS } from '../config.js';
import { MODES, DEFAULT_MODE, findMode } from '../visuals/modes.js';
import { Settings } from './Settings.js';

/** Text is only legible if it holds still; refresh it a few times a second. */
const TEXT_INTERVAL = 0.15;

/**
 * Where Auto starts before it has ever settled. The middle of its range, and
 * above the old 1.00 on purpose: the loop lowers gain several times faster
 * than it raises it, so starting high costs a few seconds, starting low a minute.
 */
const AUTO_GAIN_DEFAULT = (ANALYSIS.agcRange[0] + ANALYSIS.agcRange[1]) / 2;

/** Seconds between saves of the gain Auto has reached. */
const AUTO_SAVE_INTERVAL = 5;

/**
 * Owns the floating bar: visualiser picker, audio source, tempo readout,
 * sensitivity (auto or manual), and fullscreen.
 *
 * Everything else the app used to expose is fixed in `config.js` and
 * `visuals/modes.js`. Only the visualiser and the sensitivity choice persist.
 */
export class ControlPanel {
    constructor({ visualizer, stage, audio, onModeChange }) {
        this.ctx = { visualizer, stage, audio };
        this.onModeChange = onModeChange;
        this.settings = new Settings();
        this.elapsed = TEXT_INTERVAL;

        this.setupModes();
        this.setupSensitivity();
        this.setupSource();
        this.setupFullscreen();

        this.bpmValue = document.getElementById('val-bpm');
    }

    // --- Visualiser picker ---------------------------------------------

    /**
     * Built from the registry, so adding a mode needs no markup. The stored id
     * is validated rather than trusted, since a mode may have been renamed or
     * removed since it was saved.
     */
    setupModes() {
        const list = document.getElementById('mode-list');
        this.modeButtons = new Map();

        for (const [index, mode] of MODES.entries()) {
            const button = document.createElement('button');
            button.className = 'seg-btn';
            button.type = 'button';
            button.setAttribute('role', 'radio');
            button.setAttribute('aria-checked', 'false');
            button.title = `${mode.label} (${index + 1})`;
            button.textContent = mode.label;
            button.addEventListener('click', () => this.selectMode(mode.id));

            list.append(button);
            this.modeButtons.set(mode.id, button);
        }

        this.initialMode = findMode(this.settings.get('mode', DEFAULT_MODE)).id;
    }

    selectMode(id) {
        this.settings.set('mode', id);
        this.onModeChange(id);
    }

    /** Step to the next visualiser in registry order, wrapping at the end. */
    cycleMode(step = 1) {
        const current = MODES.findIndex((mode) => mode.id === CONFIG.mode);
        const next = (current + step + MODES.length) % MODES.length;
        this.selectMode(MODES[next].id);
    }

    /** Pick by position, for the number-key shortcuts. Out of range is ignored. */
    selectModeAt(index) {
        if (index >= 0 && index < MODES.length) this.selectMode(MODES[index].id);
    }

    /** Called by the visualiser once a mode has been built. */
    applyMode(spec) {
        for (const [id, button] of this.modeButtons) {
            button.setAttribute('aria-checked', String(id === spec.id));
        }
    }

    // --- Sensitivity ---------------------------------------------------

    /**
     * Auto hands the gain to the analysis engine and the readout shows what it
     * settled on. Manual reveals a slider that starts from that value, so the
     * handover never jumps.
     */
    setupSensitivity() {
        this.autoButton = document.getElementById('btn-auto-sensitivity');
        this.slider = document.getElementById('inp-sensitivity');
        this.sensValue = document.getElementById('val-sensitivity');

        CONFIG.autoSensitivity = this.settings.get('autoSensitivity', true) !== false;
        CONFIG.sensitivity = this.clampSensitivity(
            this.settings.get('sensitivity', CONFIG.sensitivity)
        );

        // Auto resumes from the gain it last settled on rather than from a
        // fixed 1.00, so a new session does not spend its first minute
        // climbing back to where the previous one already was.
        this.autoGain = this.clampAutoGain(this.settings.get('autoGain', NaN));
        this.lastAutoSave = 0;
        this.ctx.audio.metrics.gain = CONFIG.autoSensitivity ? this.autoGain : CONFIG.sensitivity;
        this.showSensitivity(this.ctx.audio.metrics.gain);
        window.addEventListener('pagehide', () => {
            this.saveAutoGain();
            this.settings.flush();
        });

        this.slider.addEventListener('input', () => {
            CONFIG.sensitivity = parseFloat(this.slider.value);
            this.showSensitivity(CONFIG.sensitivity);
            this.settings.set('sensitivity', CONFIG.sensitivity);
        });

        this.autoButton.addEventListener('click', () => this.toggleAutoSensitivity());
        this.renderSensitivity();
    }

    /** Stored values may predate the current range, or not be numbers at all. */
    clampSensitivity(value) {
        const number = parseFloat(value);
        const min = parseFloat(this.slider.min);
        const max = parseFloat(this.slider.max);
        if (!Number.isFinite(number)) return parseFloat(this.slider.defaultValue);
        return Math.min(Math.max(number, min), max);
    }

    /** The auto loop's own range, with its midpoint for a first-ever run. */
    clampAutoGain(value) {
        const [min, max] = ANALYSIS.agcRange;
        const number = parseFloat(value);
        if (!Number.isFinite(number)) return AUTO_GAIN_DEFAULT;
        return Math.min(Math.max(number, min), max);
    }

    /** Remember where Auto has got to, for the next session to start from. */
    saveAutoGain() {
        if (!CONFIG.autoSensitivity || !this.ctx.audio.isReady) return;
        const gain = Math.round(this.ctx.audio.metrics.gain * 100) / 100;
        if (gain === this.autoGain) return;
        this.autoGain = gain;
        this.settings.set('autoGain', gain);
    }

    toggleAutoSensitivity() {
        if (CONFIG.autoSensitivity) this.saveAutoGain();
        CONFIG.autoSensitivity = !CONFIG.autoSensitivity;
        if (!CONFIG.autoSensitivity) {
            // Adopt whatever Auto had reached, so switching does not jump.
            CONFIG.sensitivity = this.clampSensitivity(this.ctx.audio.metrics.gain);
            this.showSensitivity(CONFIG.sensitivity);
            this.settings.set('sensitivity', CONFIG.sensitivity);
        }
        this.settings.set('autoSensitivity', CONFIG.autoSensitivity);
        this.renderSensitivity();
    }

    renderSensitivity() {
        const auto = CONFIG.autoSensitivity;
        this.autoButton.setAttribute('aria-pressed', String(auto));
        this.autoButton.textContent = auto ? 'Auto' : 'Manual';
        this.slider.hidden = auto;
    }

    showSensitivity(value) {
        this.slider.value = value;
        this.sensValue.textContent = value.toFixed(2);
        const min = parseFloat(this.slider.min);
        const max = parseFloat(this.slider.max);
        const fraction = (value - min) / (max - min);
        this.slider.style.setProperty('--fill', `${(fraction * 100).toFixed(2)}%`);
    }

    // --- Audio source --------------------------------------------------

    setupSource() {
        const buttons = {
            system: document.getElementById('btn-src-system'),
            mic: document.getElementById('btn-src-mic')
        };

        this.renderSource = () => {
            for (const [name, button] of Object.entries(buttons)) {
                button.setAttribute('aria-pressed', String(this.ctx.audio.sourceName === name));
            }
        };

        for (const [name, button] of Object.entries(buttons)) {
            button.addEventListener('click', async () => {
                // Re-selecting the live source would tear down a working stream
                // and re-prompt for permission to get back to where we already are.
                if (this.ctx.audio.sourceName === name) return;
                await this.ctx.audio.start(name);
                this.renderSource();
            });
        }

        this.renderSource();
    }

    // --- Fullscreen ----------------------------------------------------

    setupFullscreen() {
        document.getElementById('fullscreen-btn')
            .addEventListener('click', () => this.toggleFullscreen());
    }

    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
        } else if (document.exitFullscreen) {
            document.exitFullscreen();
        }
    }

    // --- Live readout --------------------------------------------------

    /** Called every frame; throttles its own text updates. */
    reportMetrics(metrics, isReady, deltaTime) {
        // Throttled well below the settings debounce, which a write every few
        // frames would keep resetting so that nothing ever reached storage.
        this.lastAutoSave += deltaTime;
        if (this.lastAutoSave >= AUTO_SAVE_INTERVAL) {
            this.lastAutoSave = 0;
            this.saveAutoGain();
        }

        this.elapsed += deltaTime;
        if (this.elapsed < TEXT_INTERVAL) return;
        this.elapsed = 0;

        if (!isReady) {
            this.bpmValue.textContent = '—';
            return;
        }

        // Tempo is only worth showing once the tracker agrees with itself.
        this.bpmValue.textContent = metrics.bpm ? `${Math.round(metrics.bpm)} BPM` : 'Searching';

        if (CONFIG.autoSensitivity) this.showSensitivity(metrics.gain);
    }
}
