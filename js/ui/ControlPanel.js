import { VISUALIZERS, findVisualizer } from '../visualizers/index.js';
import { Settings } from './Settings.js';

/** Text is only legible if it holds still; refresh it a few times a second. */
const TEXT_INTERVAL = 0.15;

/** Seconds between saves of the gain Auto has reached. */
const AUTO_SAVE_INTERVAL = 5;

/**
 * Owns the floating bar: visualizer picker, audio source, sensitivity (auto or
 * manual), and fullscreen.
 *
 * The chosen visualizer persists, and each visualizer keeps its own sensitivity.
 */
export class ControlPanel {
    constructor({ capture, onSelect }) {
        this.capture = capture;
        this.onSelect = onSelect;
        this.settings = new Settings();
        this.elapsed = TEXT_INTERVAL;
        this.lastAutoSave = 0;

        /** The visualizer on screen and its engine, set by `attach`. */
        this.currentId = null;
        this.engine = null;

        this.setupPicker();
        this.setupSensitivity();
        this.setupSource();
        this.setupFullscreen();
    }

    // --- Visualiser picker ---------------------------------------------

    /**
     * Built from the registry, so adding a visualizer needs no markup. The stored id
     * is validated rather than trusted, since one may have been renamed or
     * removed since it was saved.
     */
    setupPicker() {
        const list = document.getElementById('mode-list');
        this.modeButtons = new Map();

        for (const [index, entry] of VISUALIZERS.entries()) {
            const button = document.createElement('button');
            button.className = 'seg-btn';
            button.type = 'button';
            button.setAttribute('role', 'radio');
            button.setAttribute('aria-checked', 'false');
            button.title = `${entry.label} (${index + 1})`;
            button.textContent = entry.label;
            button.addEventListener('click', () => this.selectMode(entry.id));

            list.append(button);
            this.modeButtons.set(entry.id, button);
        }

        this.initialVisualizer = findVisualizer(this.settings.get('mode')).id;
    }

    selectMode(id) {
        this.settings.set('mode', id);
        this.onSelect(id);
    }

    /** Step to the next visualizer in registry order, wrapping at the end. */
    cycleMode(step = 1) {
        const count = VISUALIZERS.length;
        const current = VISUALIZERS.findIndex((entry) => entry.id === this.currentId);
        this.selectMode(VISUALIZERS[(current + step + count) % count].id);
    }

    /** Pick by position, for the number-key shortcuts. Out of range is ignored. */
    selectModeAt(index) {
        if (index >= 0 && index < VISUALIZERS.length) this.selectMode(VISUALIZERS[index].id);
    }

    /** Called once a visualizer has been built: take over its sensitivity. */
    attach({ id }, engine) {
        this.currentId = id;
        this.engine = engine;

        for (const [buttonId, button] of this.modeButtons) {
            button.setAttribute('aria-checked', String(buttonId === id));
        }
        this.loadSensitivity();
    }

    // --- Sensitivity ---------------------------------------------------

    /**
     * Auto hands the gain to the visualizer's engine and the readout shows what
     * it settled on. Manual reveals a slider that starts from that value, so
     * the handover never jumps.
     */
    setupSensitivity() {
        this.autoButton = document.getElementById('btn-auto-sensitivity');
        this.slider = document.getElementById('inp-sensitivity');
        this.sensValue = document.getElementById('val-sensitivity');

        window.addEventListener('pagehide', () => {
            this.saveAutoGain();
            this.settings.flush();
        });

        this.slider.addEventListener('input', () => {
            this.manual = parseFloat(this.slider.value);
            this.showSensitivity(this.manual);
            this.store('sensitivity', this.manual);
            this.applySensitivity();
        });

        this.autoButton.addEventListener('click', () => this.toggleAutoSensitivity());
    }

    /**
     * This visualizer's own saved value. One that has none yet starts from the
     * single setting older versions shared between all of them.
     */
    recall(key, fallback) {
        return this.settings.get(`${this.currentId}.${key}`, this.settings.get(key, fallback));
    }

    store(key, value) {
        this.settings.set(`${this.currentId}.${key}`, value);
    }

    loadSensitivity() {
        this.auto = this.recall('autoSensitivity', true) !== false;
        this.manual = this.clampSensitivity(this.recall('sensitivity'));
        this.applySensitivity();

        // Auto resumes from the gain it last settled on rather than from a
        // fixed 1.00, so it does not spend its first minute climbing back.
        this.engine.restoreGain(parseFloat(this.recall('autoGain')));
        this.autoGain = null;
        this.lastAutoSave = 0;
        this.showSensitivity(this.engine.gain);
        this.renderSensitivity();
    }

    applySensitivity() {
        this.engine.setSensitivity({ auto: this.auto, manual: this.manual });
    }

    /** Stored values may predate the current range, or not be numbers at all. */
    clampSensitivity(value) {
        const number = parseFloat(value);
        const min = parseFloat(this.slider.min);
        const max = parseFloat(this.slider.max);
        if (!Number.isFinite(number)) return parseFloat(this.slider.defaultValue);
        return Math.min(Math.max(number, min), max);
    }

    /** Remember where Auto has got to, for the next time this visualizer is shown. */
    saveAutoGain() {
        if (!this.engine || !this.auto || !this.capture.isReady) return;
        const gain = Math.round(this.engine.gain * 100) / 100;
        if (gain === this.autoGain) return;
        this.autoGain = gain;
        this.store('autoGain', gain);
    }

    toggleAutoSensitivity() {
        if (this.auto) this.saveAutoGain();
        this.auto = !this.auto;
        if (!this.auto) {
            // Adopt whatever Auto had reached, so switching does not jump.
            this.manual = this.clampSensitivity(this.engine.gain);
            this.showSensitivity(this.manual);
            this.store('sensitivity', this.manual);
        }
        this.store('autoSensitivity', this.auto);
        this.applySensitivity();
        this.renderSensitivity();
    }

    renderSensitivity() {
        this.autoButton.setAttribute('aria-pressed', String(this.auto));
        this.autoButton.textContent = this.auto ? 'Auto' : 'Manual';
        this.slider.hidden = this.auto;
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
                button.setAttribute('aria-pressed', String(this.capture.sourceName === name));
            }
        };

        for (const [name, button] of Object.entries(buttons)) {
            button.addEventListener('click', async () => {
                // Re-selecting the live source would tear down a working stream
                // and re-prompt for permission to get back to where we already are.
                if (this.capture.sourceName === name) return;
                await this.capture.start(name);
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
    update(deltaTime) {
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

        if (this.auto && this.capture.isReady) this.showSensitivity(this.engine.gain);
    }
}
