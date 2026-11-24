import { SphereVisualizer } from './sphere/index.js';
import { FlareVisualizer } from './flare/index.js';
import { ChladniVisualizer } from './chladni/index.js';

/**
 * The visualizer registry. The picker, the number keys and the saved preference
 * all read this list.
 *
 * Every visualizer is a self-contained folder: its own analysis engine, tuning,
 * shaders, canvas and WebGL context. Folders never import from each other. The
 * rest of the app knows a visualizer only by this interface:
 *
 *   new Visualizer(container)  build, and add a canvas to the container
 *   frame(dt)                  analyse and draw one frame, with or without audio
 *   dispose()                  disconnect, free everything, remove the canvas
 *
 *   engine.connect(audioContext, sourceNode)
 *   engine.disconnect()
 *   engine.setSensitivity({ auto, manual })
 *   engine.restoreGain(autoGain)   start from a saved gain; NaN if none is saved
 *   engine.gain                    the gain in effect
 */
export const VISUALIZERS = [
    { id: 'sphere', label: 'Sphere', Visualizer: SphereVisualizer },
    { id: 'flare', label: 'Flare', Visualizer: FlareVisualizer },
    { id: 'chladni', label: 'Chladni', Visualizer: ChladniVisualizer }
];

/** The entry with this id, or the first if the id is unknown. */
export function findVisualizer(id) {
    return VISUALIZERS.find((entry) => entry.id === id) ?? VISUALIZERS[0];
}
