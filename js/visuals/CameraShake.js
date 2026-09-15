import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { ema } from '../audio/dsp.js';

/**
 * Jitters the camera on beats. The amount is scaled by the track's own dynamic
 * range, so a brick-walled master — where the onset envelope is busy but the
 * music never really lands — stays much calmer than a recording with real
 * transients. The rest position re-syncs to wherever the user has orbited to,
 * so shaking never fights their camera. `CONFIG.shake` scales the whole thing,
 * and at 0 the camera is left entirely alone.
 */
export class CameraShake {
    constructor(camera) {
        this.camera = camera;
        this.basePosition = new THREE.Vector3(0, 2, 8);
    }

    apply({ bass, beat, pulse, crest }, deltaTime) {
        const range = 0.55 + crest * 0.7;
        const hit = Math.max(beat, pulse * 0.6);
        const intensity = ((hit * 0.3 * range) + (bass * 0.1)) * CONFIG.shake;
        const { position } = this.camera;

        if (intensity > 0.05) {
            position.x = this.basePosition.x + (Math.random() - 0.5) * intensity;
            position.y = this.basePosition.y + (Math.random() - 0.5) * intensity;
        } else {
            position.x = ema(position.x, this.basePosition.x, deltaTime, 0.16);
            position.y = ema(position.y, this.basePosition.y, deltaTime, 0.16);
        }
    }

    /** Adopt the current camera position as the new rest point. */
    syncRestPosition() {
        this.basePosition.copy(this.camera.position);
    }
}
