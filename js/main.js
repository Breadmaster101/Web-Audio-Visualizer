import { Visualizer } from './Visualizer.js';
import { StartOverlay } from './ui/StartOverlay.js';
import { IdleWatcher } from './ui/IdleWatcher.js';
import { Shortcuts } from './ui/Shortcuts.js';

const app = new Visualizer(document.getElementById('canvas-container'), {
    onAudioReady: () => overlay.hide()
});

const overlay = new StartOverlay({
    onStart: (name) => app.startAudio(name)
});

new IdleWatcher(overlay, [
    document.getElementById('hud-controls'),
    document.getElementById('hud-telemetry')
]);

new Shortcuts(app.controls);

app.start();
