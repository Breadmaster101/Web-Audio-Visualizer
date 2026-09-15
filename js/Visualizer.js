import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Stage } from './visuals/Stage.js';
import { CameraShake } from './visuals/CameraShake.js';
import { findMode } from './visuals/modes.js';
import { AudioSource } from './audio/AudioSource.js';
import { ControlPanel } from './ui/ControlPanel.js';

/** Wires the audio, visual and control modules together and drives the frame loop. */
export class Visualizer {
    constructor(container, { onAudioReady } = {}) {
        this.stage = new Stage(container);
        this.shake = new CameraShake(this.stage.camera);
        this.audio = new AudioSource({ onReady: onAudioReady });
        this.mode = null;
        this.modeSpec = null;

        this.controls = new ControlPanel({
            visualizer: this,
            stage: this.stage,
            audio: this.audio,
            onModeChange: (id) => this.setMode(id)
        });

        this.clock = new THREE.Clock();
        this.setMode(this.controls.initialMode);
    }

    /**
     * Swap the visualiser.
     *
     * The outgoing mode is disposed rather than hidden. These are not small
     * objects — a million-point buffer, a pair of float render targets — and
     * keeping every mode the user has ever opened resident to save a rebuild
     * would trade a few hundred milliseconds against hundreds of megabytes.
     *
     * @param {string} id  A mode id from `visuals/modes.js`.
     */
    setMode(id) {
        const spec = findMode(id);
        if (this.modeSpec?.id === spec.id) return;

        this.mode?.dispose();

        this.modeSpec = spec;
        CONFIG.mode = spec.id;
        this.mode = spec.create(this.stage);

        this.stage.applyView(spec.view);
        // The camera has just moved, so the shake's rest point has to move with
        // it or the first beat will yank the view back to the previous mode's.
        this.shake.syncRestPosition();

        // A new mode starts at its own defaults and knows nothing about the
        // slider positions, so every control that applies to it is replayed.
        this.controls.applyMode(spec);
    }

    /** @param {'system'|'mic'} name */
    async startAudio(name) {
        const started = await this.audio.start(name);
        this.controls.renderSource();
        return started;
    }

    start() {
        this.renderFrame();
    }

    renderFrame() {
        requestAnimationFrame(() => this.renderFrame());

        const deltaTime = this.clock.getDelta();
        const time = this.clock.getElapsedTime();

        if (this.audio.update(deltaTime)) {
            this.mode.setAudio(this.audio.metrics, deltaTime);
            this.shake.apply(this.audio.metrics, deltaTime);
        }

        this.controls.reportMetrics(this.audio.metrics, this.audio.isReady, deltaTime);

        this.mode.setTime(time, deltaTime);
        this.stage.update();

        // Re-anchor the shake origin whenever the user is steering the camera.
        if (!this.stage.isUserDragging()) {
            this.shake.syncRestPosition();
        }

        this.stage.render();
    }
}
