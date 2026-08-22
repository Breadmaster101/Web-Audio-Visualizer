import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { AudioAnalyser } from '../audio/AudioAnalyser.js';

/**
 * Jitters the camera on beats. Shake is scaled by sensitivity so a low slider
 * setting stays calm, and the rest position re-syncs to wherever the user has
 * orbited to, so shaking never fights their camera.
 */
export class CameraShake {
    constructor(camera) {
        this.camera = camera;
        this.basePosition = new THREE.Vector3(0, 2, 8);
    }

    apply({ bass, beatDecay }) {
        const intensity = (beatDecay * CONFIG.sensitivity * 0.3) + (bass * 0.1);
        const { position } = this.camera;

        if (intensity > 0.05) {
            position.x = this.basePosition.x + (Math.random() - 0.5) * intensity;
            position.y = this.basePosition.y + (Math.random() - 0.5) * intensity;
        } else {
            position.x = AudioAnalyser.smooth(position.x, this.basePosition.x, 0.1, 0.1);
            position.y = AudioAnalyser.smooth(position.y, this.basePosition.y, 0.1, 0.1);
        }
    }

    /** Adopt the current camera position as the new rest point. */
    syncRestPosition() {
        this.basePosition.copy(this.camera.position);
    }
}
