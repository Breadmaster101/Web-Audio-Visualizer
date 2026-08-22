import { Visualizer } from './Visualizer.js';
import { StartOverlay } from './ui/StartOverlay.js';
import { IdleWatcher } from './ui/IdleWatcher.js';

const app = new Visualizer(document.getElementById('canvas-container'), {
    onAudioReady: () => overlay.hide()
});

const overlay = new StartOverlay({
    onSystemAudio: () => app.startSystemAudio(),
    onMicAudio: () => app.startMicAudio()
});

new IdleWatcher(overlay);

app.start();
