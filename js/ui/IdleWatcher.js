/**
 * Fades the chrome away after a period of no input, but only once the start
 * overlay is gone — the source buttons must never hide themselves.
 */
export class IdleWatcher {
    constructor(startOverlay, idleDelay = 2000) {
        this.startOverlay = startOverlay;
        this.idleDelay = idleDelay;
        this.timer = null;
        this.body = document.body;

        const reset = () => this.reset();
        window.addEventListener('mousemove', reset);
        window.addEventListener('click', reset);
        window.addEventListener('touchstart', reset);
        reset();
    }

    reset() {
        this.body.classList.remove('ui-idle');
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            if (this.startOverlay.isHidden) {
                this.body.classList.add('ui-idle');
            }
        }, this.idleDelay);
    }
}
