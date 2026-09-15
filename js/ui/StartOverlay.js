/** The pre-flight screen: picks an audio source, then fades itself out. */
export class StartOverlay {
    constructor({ onStart }) {
        this.element = document.getElementById('start-overlay');
        document.getElementById('start-system-btn')
            .addEventListener('click', () => onStart('system'));
        document.getElementById('start-mic-btn')
            .addEventListener('click', () => onStart('mic'));
    }

    hide() {
        this.element.classList.add('hidden');
    }

    get isHidden() {
        return this.element.classList.contains('hidden');
    }
}
