import { ChladniEngine } from './engine/ChladniEngine.js';
import { ChladniStage } from './render/ChladniStage.js';
import { ChladniPlate } from './render/ChladniPlate.js';

/** Sand on a vibrating plate shaped by chords. */
export class ChladniVisualizer {
    constructor(container) {
        this.engine = new ChladniEngine();
        this.stage = new ChladniStage(container);
        this.plate = new ChladniPlate(this.stage, this.engine.weights);
        this.time = 0;
    }

    frame(dt) {
        this.time += dt;
        if (this.engine.update(dt)) this.plate.setAudio(this.engine);
        this.plate.setTime(this.time, dt);
        this.stage.render();
    }

    dispose() {
        this.engine.disconnect();
        this.plate.dispose();
        this.stage.dispose();
    }
}
