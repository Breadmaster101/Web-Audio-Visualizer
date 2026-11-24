import { findVisualizer } from './visualizers/index.js';
import { AudioCapture } from './capture/AudioCapture.js';
import { ControlPanel } from './ui/ControlPanel.js';

/**
 * The shell: holds the captured stream and the one visualizer on screen, and
 * hands the first to the second. It knows nothing about analysis or rendering.
 */
export class App {
    constructor(container, { onAudioReady } = {}) {
        this.container = container;
        this.visualizer = null;
        this.current = null;
        this.lastFrame = null;

        this.capture = new AudioCapture({
            onConnect: (context, source) => {
                this.visualizer.engine.connect(context, source);
                onAudioReady?.();
            },
            onDisconnect: () => this.visualizer.engine.disconnect()
        });

        this.controls = new ControlPanel({
            capture: this.capture,
            onSelect: (id) => this.setVisualizer(id)
        });

        this.setVisualizer(this.controls.initialVisualizer);
    }

    /**
     * Swap the visualizer. The outgoing one is disposed, engine and all, so
     * only what is on screen costs anything. The incoming one calibrates from
     * scratch, starting from its own saved sensitivity.
     */
    setVisualizer(id) {
        const entry = findVisualizer(id);
        if (this.current?.id === entry.id) return;

        this.controls.saveAutoGain();
        this.visualizer?.dispose();

        this.current = entry;
        this.visualizer = new entry.Visualizer(this.container);
        this.controls.attach(entry, this.visualizer.engine);

        if (this.capture.isReady) {
            this.visualizer.engine.connect(this.capture.audioContext, this.capture.sourceNode);
        }
    }

    /** @param {'system'|'mic'} name */
    async startAudio(name) {
        const started = await this.capture.start(name);
        this.controls.renderSource();
        return started;
    }

    start() {
        requestAnimationFrame((now) => this.renderFrame(now));
    }

    renderFrame(now) {
        requestAnimationFrame((next) => this.renderFrame(next));

        const dt = Math.max(0, (now - (this.lastFrame ?? now)) / 1000);
        this.lastFrame = now;

        this.visualizer.frame(dt);
        this.controls.update(dt);
    }
}
