import { App } from './App.js';
import { StartOverlay } from './ui/StartOverlay.js';
import { IdleWatcher } from './ui/IdleWatcher.js';
import { Shortcuts } from './ui/Shortcuts.js';

const app = new App(document.getElementById('canvas-container'), {
    onAudioReady: () => overlay.hide()
});

const overlay = new StartOverlay({
    onStart: (name) => app.startAudio(name)
});

new IdleWatcher(overlay, [document.getElementById('hud')]);

new Shortcuts(app.controls);

app.start();
