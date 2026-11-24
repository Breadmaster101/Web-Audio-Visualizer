import { FlareEngine } from './engine/FlareEngine.js';
import { FlareStage } from './render/FlareStage.js';
import { FlareLight } from './render/FlareLight.js';

/** A point of light, stared at. */
export class FlareVisualizer {
    constructor(container) {
        this.engine = new FlareEngine();
        this.stage = new FlareStage(container);
        this.light = new FlareLight(this.stage);
        this.time = 0;
    }

    frame(dt) {
        this.time += dt;
        if (this.engine.update(dt)) this.light.setAudio(this.engine);
        this.light.setTime(this.time, dt);
        this.stage.render();
    }

    dispose() {
        this.engine.disconnect();
        this.light.dispose();
        this.stage.dispose();
    }
}
