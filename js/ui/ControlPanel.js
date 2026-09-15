import { CONFIG } from '../config.js';
import { MODES, DEFAULT_MODE, findMode } from '../visuals/modes.js';
import { EngineReadout } from './EngineReadout.js';
import { Settings } from './Settings.js';

/**
 * Declarative description of every slider.
 *
 * `id` names both the input (`inp-<id>`) and its value readout (`val-<id>`), and
 * also the block that wraps them (`ctl-<id>`), which is what lets a mode's
 * `controls` list decide what the column shows.
 *
 * Defaults are not repeated here: the `value` attribute in the markup is the
 * single source of truth, read back through `slider.defaultValue`, so a reset
 * cannot drift out of step with what the page ships.
 *
 * `apply` reaches the live mode through `ctx.visualizer.mode`, resolved at call
 * time rather than captured. The mode object is replaced on every switch, and a
 * captured reference would keep pushing values into a disposed one.
 */
const SLIDERS = [
    {
        id: 'particles',
        format: (v) => v.toLocaleString('en-US'),
        apply: (v, ctx) => ctx.visualizer.mode?.setCount(v)
    },
    {
        id: 'brightness',
        prop: 'brightness',
        apply: (v, ctx) => ctx.visualizer.mode?.setBrightness(v)
    },
    {
        id: 'bloom',
        prop: 'bloomStrength',
        apply: (v, ctx) => ctx.stage.setBloomStrength(v)
    },
    { id: 'sensitivity', prop: 'sensitivity' },
    { id: 'trim', prop: 'trim' },
    { id: 'dynamics', prop: 'loudnessFollow' },
    { id: 'shake', prop: 'shake' },
    {
        id: 'rotate',
        prop: 'autoRotateSpeed',
        apply: (v, ctx) => ctx.stage.setAutoRotateSpeed(v)
    },
    {
        id: 'speed',
        prop: 'speed',
        apply: (v, ctx) => ctx.visualizer.mode?.setSpeed(v)
    },
    {
        id: 'damping',
        prop: 'damping',
        apply: (v, ctx) => ctx.visualizer.mode?.setDamping(v)
    }
];

/** Controls that act on the shared analysis engine, so every mode has them. */
const ENGINE_CONTROLS = ['sensitivity', 'trim', 'dynamics'];

/** Blocks that only exist for some modes, and the group heading they sit under. */
const MODE_GROUP = ['speed', 'damping'];

/**
 * Owns the control column: the visualiser picker, slider wiring, the two
 * toggles, the audio source selector, the how-it-works section, and persistence
 * for all of it.
 */
export class ControlPanel {
    constructor({ visualizer, stage, audio, onModeChange }) {
        this.ctx = { visualizer, stage, audio };
        this.onModeChange = onModeChange;
        this.settings = new Settings();
        this.sliders = new Map();

        for (const spec of SLIDERS) this.bindSlider(spec);

        this.setupModes();
        this.setupAutoSensitivity();
        this.setupAutoRotate();
        this.setupSource();
        this.setupDoc();
        this.setupFullscreen();

        this.readout = new EngineReadout();
        this.particlesValue = document.getElementById('val-particles');
    }

    // --- Visualiser picker ---------------------------------------------

    /**
     * Build the picker from the registry, so adding a mode needs no markup.
     *
     * The stored id is validated against the registry rather than trusted:
     * whatever is in storage was written by an older version of this app, and a
     * mode that has since been renamed or removed would otherwise leave the
     * picker pointing at nothing.
     */
    setupModes() {
        this.modeList = document.getElementById('mode-list');
        this.modeButtons = new Map();

        for (const [index, mode] of MODES.entries()) {
            const button = document.createElement('button');
            button.className = 'mode-btn';
            button.type = 'button';
            button.setAttribute('role', 'radio');
            button.setAttribute('aria-checked', 'false');
            button.dataset.mode = mode.id;

            const name = document.createElement('span');
            name.className = 'mode-name';
            name.textContent = mode.label;

            const key = document.createElement('span');
            key.className = 'mode-key';
            key.textContent = String(index + 1);

            const tag = document.createElement('span');
            tag.className = 'mode-tag';
            tag.textContent = mode.tagline;

            button.append(name, key, tag);
            button.addEventListener('click', () => this.selectMode(mode.id));

            this.modeList.append(button);
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

    /**
     * Re-point the column at a newly built mode.
     *
     * Two jobs. Controls the mode does not use are hidden — a slider that cannot
     * affect anything is furniture, not information. And every control it does
     * use is replayed into it, because the mode was constructed from CONFIG
     * defaults and knows nothing about where the sliders are sitting.
     */
    applyMode(spec) {
        for (const button of this.modeButtons.values()) {
            button.setAttribute('aria-checked', String(button.dataset.mode === spec.id));
        }

        const active = new Set([...spec.controls, ...ENGINE_CONTROLS]);

        for (const [id, entry] of this.sliders) {
            const block = document.getElementById(`ctl-${id}`);
            const shown = active.has(id);
            if (block) block.hidden = !shown;
            if (shown && entry.spec.apply) entry.spec.apply(parseFloat(entry.slider.value), this.ctx);
        }

        // Trim has a second reason to be hidden, so it gets the last word.
        this.renderAutoSensitivity();
        this.renderAutoRotate();

        const hasModeGroup = MODE_GROUP.some((id) => active.has(id));
        document.getElementById('grp-mode').hidden = !hasModeGroup;
        document.getElementById('rule-mode').hidden = !hasModeGroup;
    }

    // --- Sliders -------------------------------------------------------

    bindSlider(spec) {
        const slider = document.getElementById(`inp-${spec.id}`);
        const readout = document.getElementById(`val-${spec.id}`);
        const digits = spec.id === 'particles' ? 0 : 2;
        const format = spec.format || ((v) => v.toFixed(digits));

        const entry = { spec, slider, readout, format };
        this.sliders.set(spec.id, entry);

        slider.addEventListener('input', () => {
            this.commit(entry, parseFloat(slider.value));
            this.settings.set(spec.id, parseFloat(slider.value));
        });

        const stored = this.settings.get(spec.id, parseFloat(slider.defaultValue));
        this.commit(entry, this.sanitise(slider, stored));
    }

    /**
     * A stored value can be out of range or not a number at all — the markup's
     * min/max may have changed since it was written. Clamp rather than discard,
     * so a narrowed range keeps the user near where they left off.
     */
    sanitise(slider, value) {
        const number = parseFloat(value);
        if (!Number.isFinite(number)) return parseFloat(slider.defaultValue);
        return Math.min(Math.max(number, parseFloat(slider.min)), parseFloat(slider.max));
    }

    /** Push a value into the DOM, CONFIG and the visuals. Does not persist. */
    commit(entry, value) {
        const { spec, slider, readout, format } = entry;
        slider.value = value;
        if (readout) readout.textContent = format(value);
        if (spec.prop) CONFIG[spec.prop] = value;
        if (spec.apply) spec.apply(value, this.ctx);
        this.paint(entry);
    }

    /**
     * Repaints the filled portion of the track. WebKit has no equivalent of
     * Firefox's ::-moz-range-progress, so the fill is a gradient stop driven by
     * a custom property instead.
     */
    paint({ slider }) {
        const min = parseFloat(slider.min);
        const max = parseFloat(slider.max);
        const fraction = max > min ? (parseFloat(slider.value) - min) / (max - min) : 0;
        slider.style.setProperty('--fill', `${(fraction * 100).toFixed(2)}%`);
    }

    // --- Toggles -------------------------------------------------------

    /**
     * Auto mode hands the gain to the analysis engine and turns the slider into
     * a live display of what it settled on. Switching back to manual adopts
     * that value, so the handover never jumps.
     *
     * Trim only exists because auto-gain would cancel out a change made with
     * the Sensitivity slider. With Auto off there is nothing to work around —
     * Sensitivity does the same job directly — so the control is taken away
     * rather than left sitting there as a second, redundant gain.
     */
    setupAutoSensitivity() {
        this.autoButton = document.getElementById('btn-auto-sensitivity');
        this.trimRow = document.getElementById('ctl-trim');
        const entry = this.sliders.get('sensitivity');

        CONFIG.autoSensitivity = this.settings.get('autoSensitivity', true) !== false;

        this.renderAutoSensitivity = () => {
            this.autoButton.setAttribute('aria-pressed', String(CONFIG.autoSensitivity));
            entry.slider.disabled = CONFIG.autoSensitivity;
            this.trimRow.hidden = !CONFIG.autoSensitivity;
        };

        this.autoButton.addEventListener('click', () => this.toggleAutoSensitivity());
        this.renderAutoSensitivity();
    }

    toggleAutoSensitivity() {
        CONFIG.autoSensitivity = !CONFIG.autoSensitivity;
        if (!CONFIG.autoSensitivity) {
            CONFIG.sensitivity = parseFloat(this.sliders.get('sensitivity').slider.value);
        }
        this.settings.set('autoSensitivity', CONFIG.autoSensitivity);
        this.renderAutoSensitivity();
    }

    setupAutoRotate() {
        this.rotateButton = document.getElementById('btn-auto-rotate');
        const entry = this.sliders.get('rotate');

        CONFIG.autoRotate = this.settings.get('autoRotate', true) !== false;

        this.renderAutoRotate = () => {
            this.rotateButton.setAttribute('aria-pressed', String(CONFIG.autoRotate));
            this.rotateButton.textContent = CONFIG.autoRotate ? 'On' : 'Off';
            entry.slider.disabled = !CONFIG.autoRotate;
            this.ctx.stage.setAutoRotate(CONFIG.autoRotate);
        };

        this.rotateButton.addEventListener('click', () => {
            CONFIG.autoRotate = !CONFIG.autoRotate;
            this.settings.set('autoRotate', CONFIG.autoRotate);
            this.renderAutoRotate();
        });

        this.renderAutoRotate();
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

    // --- How it works --------------------------------------------------

    setupDoc() {
        this.docButton = document.getElementById('btn-how');
        this.docBody = document.getElementById('doc-body');

        this.docButton.addEventListener('click', () => this.toggleDoc());

        if (this.settings.get('docOpen', false) === true) this.setDoc(true);
    }

    setDoc(open) {
        this.docButton.setAttribute('aria-expanded', String(open));
        this.docBody.hidden = !open;
        this.settings.set('docOpen', open);
    }

    toggleDoc() {
        this.setDoc(this.docButton.getAttribute('aria-expanded') !== 'true');
        // Opening from the keyboard should actually show the thing it opened.
        if (!this.docBody.hidden) {
            this.docButton.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

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

    /** Restore every control to the value the markup ships with. */
    reset() {
        this.settings.clear();

        for (const entry of this.sliders.values()) {
            this.commit(entry, parseFloat(entry.slider.defaultValue));
        }

        if (!CONFIG.autoSensitivity) this.toggleAutoSensitivity();
        if (!CONFIG.autoRotate) this.rotateButton.click();
        this.setDoc(false);

        // Last, because switching modes replays the sliders into the new one and
        // there is no sense doing that twice.
        if (CONFIG.mode !== DEFAULT_MODE) this.onModeChange(DEFAULT_MODE);

        // The steps above re-persist as they go, so clear once more to leave
        // storage genuinely empty.
        this.settings.clear();
    }

    /** Called every frame; the readout throttles itself. */
    reportMetrics(metrics, isReady, deltaTime) {
        if (CONFIG.autoSensitivity && isReady) {
            const entry = this.sliders.get('sensitivity');
            entry.slider.value = metrics.gain;
            entry.readout.textContent = metrics.gain.toFixed(2);
            this.paint(entry);
        }

        this.readout.update(metrics, isReady, deltaTime);
        this.particlesValue.classList.toggle('warn', this.readout.isFrameSlow);
    }
}
