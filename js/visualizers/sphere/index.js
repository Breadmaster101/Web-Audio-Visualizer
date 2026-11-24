import { SphereEngine } from './engine/SphereEngine.js';
import { SphereStage } from './render/SphereStage.js';
import { ParticleSystem } from './render/ParticleSystem.js';
import { CameraShake } from './render/CameraShake.js';

/** A million points displaced by four audio-driven fields. */
export class SphereVisualizer {
    constructor(container) {
        this.engine = new SphereEngine();
        this.stage = new SphereStage(container);
        this.particles = new ParticleSystem(this.stage.scene);
        this.shake = new CameraShake(this.stage.camera);
        this.time = 0;
    }

    frame(dt) {
        this.time += dt;
        if (this.engine.update(dt)) {
            this.particles.setAudio(this.engine);
            this.shake.apply(this.engine, dt);
        }
        this.particles.setTime(this.time);

        this.stage.update();
        // Shake around wherever the orbit has taken the camera.
        this.shake.syncRestPosition();
        this.stage.render();
    }

    dispose() {
        this.engine.disconnect();
        this.particles.dispose();
        this.stage.dispose();
    }
}
