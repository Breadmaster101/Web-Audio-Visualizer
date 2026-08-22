import * as THREE from 'three';
import { Stage } from './visuals/Stage.js';
import { ParticleSystem } from './visuals/ParticleSystem.js';
import { CameraShake } from './visuals/CameraShake.js';
import { AudioSource } from './audio/AudioSource.js';
import { ControlPanel } from './ui/ControlPanel.js';

/** Wires the audio, visual and control modules together and drives the frame loop. */
export class Visualizer {
    constructor(container, { onAudioReady } = {}) {
        this.stage = new Stage(container);
        this.particles = new ParticleSystem(this.stage.scene);
        this.shake = new CameraShake(this.stage.camera);
        this.audio = new AudioSource({ onReady: onAudioReady });
        this.controls = new ControlPanel(this.particles);
        this.clock = new THREE.Clock();
    }

    startSystemAudio() {
        return this.audio.startSystemAudio();
    }

    startMicAudio() {
        return this.audio.startMicAudio();
    }

    start() {
        this.renderFrame();
    }

    renderFrame() {
        requestAnimationFrame(() => this.renderFrame());

        const deltaTime = this.clock.getDelta();
        const time = this.clock.getElapsedTime();

        if (this.audio.update(deltaTime)) {
            const { bass, mid, treble, beat, beatDecay } = this.audio.metrics;
            this.particles.setAudio({ bass, mid, treble, beat });
            this.shake.apply({ bass, beatDecay });
        }

        this.particles.setTime(time);
        this.stage.update();

        // Re-anchor the shake origin whenever the user is steering the camera.
        if (!this.stage.isUserDragging()) {
            this.shake.syncRestPosition();
        }

        this.stage.render();
    }
}
