import { CONFIG } from '../config.js';

/**
 * Wires the slider inputs to CONFIG and to visual side effects.
 * Each `<input id="inp-x">` is paired with a `<span id="val-x">` readout.
 */
export class ControlPanel {
    constructor(particles) {
        this.bind('inp-particles', null, (val) => particles.setCount(val));
        this.bind('inp-brightness', 'brightness', (val) => particles.setBrightness(val));
        this.bind('inp-sensitivity', 'sensitivity');
        this.setupFullscreen();
    }

    /**
     * @param {string} id       Slider element id.
     * @param {?string} prop    CONFIG key to write, or null to skip.
     * @param {?Function} onChange  Extra side effect.
     */
    bind(id, prop, onChange) {
        const slider = document.getElementById(id);
        const readout = document.getElementById(id.replace('inp', 'val'));

        slider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            if (prop) CONFIG[prop] = val;
            if (readout) readout.textContent = val.toFixed(2);
            if (onChange) onChange(val);
        });
    }

    setupFullscreen() {
        document.getElementById('fullscreen-btn').addEventListener('click', () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen();
            } else if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        });
    }
}
