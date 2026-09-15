const IDLE_DELAY = 6000;

/**
 * Fades the chrome away after a period of no input.
 *
 * Three things suppress it, all for the same reason: the interface must never
 * disappear out from under someone who is using it. It stays while the pointer
 * is over a panel (you are reading, and reading does not move the mouse), while
 * a control is being dragged, and while focus is inside the HUD. It also stays
 * until the start overlay is gone, so the source buttons cannot hide themselves.
 */
export class IdleWatcher {
    constructor(startOverlay, panels, idleDelay = IDLE_DELAY) {
        this.startOverlay = startOverlay;
        this.idleDelay = idleDelay;
        this.timer = null;
        this.body = document.body;
        this.pointerInside = false;
        this.interacting = false;

        const reset = () => this.reset();
        window.addEventListener('mousemove', reset);
        window.addEventListener('click', reset);
        window.addEventListener('touchstart', reset);
        window.addEventListener('keydown', reset);
        window.addEventListener('wheel', reset, { passive: true });

        for (const panel of panels) {
            panel.addEventListener('mouseenter', () => {
                this.pointerInside = true;
                this.reset();
            });
            panel.addEventListener('mouseleave', () => {
                this.pointerInside = false;
                this.reset();
            });
            panel.addEventListener('scroll', reset, { passive: true });
        }

        // Pointer capture on a slider means no further mousemove reaches the
        // window, so a slow drag would otherwise time out mid-adjustment.
        window.addEventListener('pointerdown', () => {
            this.interacting = true;
            this.reset();
        });
        window.addEventListener('pointerup', () => {
            this.interacting = false;
            this.reset();
        });

        this.panels = panels;
        reset();
    }

    get isHeld() {
        return this.pointerInside
            || this.interacting
            || this.panels.some((panel) => panel.contains(document.activeElement));
    }

    reset() {
        this.body.classList.remove('ui-idle');
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            if (this.startOverlay.isHidden && !this.isHeld) {
                this.body.classList.add('ui-idle');
            } else {
                // Held open. Re-arm rather than give up, so the fade still
                // happens once the hold ends even if no further input arrives.
                this.reset();
            }
        }, this.idleDelay);
    }
}
