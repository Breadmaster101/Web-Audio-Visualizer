/** The pre-flight screen: picks an audio source, then fades itself out. */
export class StartOverlay {
    constructor({ onSystemAudio, onMicAudio }) {
        this.element = document.getElementById('start-overlay');
        document.getElementById('start-system-btn').addEventListener('click', onSystemAudio);
        document.getElementById('start-mic-btn').addEventListener('click', onMicAudio);
    }

    hide() {
        this.element.classList.add('hidden');
    }

    get isHidden() {
        return this.element.classList.contains('hidden');
    }
}
