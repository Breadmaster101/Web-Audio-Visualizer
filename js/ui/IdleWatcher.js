const IDLE_DELAY = 3000;

/**
 * Hides the bar after the cursor has been still for `idleDelay`, and at once
 * when the cursor leaves the page.
 *
 * Two things hold it open, both so it never vanishes out from under someone
 * using it: the pointer resting on the bar, and a slider drag in progress
 * (pointer capture means no mousemove reaches the window during a drag, so a
 * slow one would otherwise time out). Nothing happens until the start screen
 * is gone, since the bar is not shown before then.
 */
export class IdleWatcher {
    constructor(startOverlay, panels, idleDelay = IDLE_DELAY) {
        this.startOverlay = startOverlay;
        this.panels = panels;
        this.idleDelay = idleDelay;
        this.timer = null;
        this.body = document.body;
        this.pointerInside = false;
        this.interacting = false;

        const wake = () => this.wake();
        window.addEventListener('mousemove', wake);
        window.addEventListener('touchstart', wake);
        window.addEventListener('keydown', wake);
        window.addEventListener('wheel', wake, { passive: true });

        // `mouseleave` on the root fires when the cursor leaves the page, which
        // covers moving to another window, the tab strip or another monitor.
        document.documentElement.addEventListener('mouseleave', () => {
            this.pointerInside = false;
            if (!this.interacting) this.sleep();
        });

        for (const panel of panels) {
            panel.addEventListener('mouseenter', () => {
                this.pointerInside = true;
                this.wake();
            });
            panel.addEventListener('mouseleave', () => {
                this.pointerInside = false;
                this.wake();
            });
        }

        window.addEventListener('pointerdown', () => {
            this.interacting = true;
            this.wake();
        });
        window.addEventListener('pointerup', () => {
            this.interacting = false;
            this.wake();
        });

        this.wake();
    }

    get isHeld() {
        return this.pointerInside || this.interacting;
    }

    wake() {
        this.body.classList.remove('ui-idle');
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.onTimeout(), this.idleDelay);
    }

    onTimeout() {
        // Held open: re-arm rather than give up, so the fade still happens once
        // the hold ends even if no further input arrives.
        if (!this.startOverlay.isHidden || this.isHeld) {
            this.wake();
            return;
        }
        this.sleep();
    }

    sleep() {
        clearTimeout(this.timer);
        if (this.startOverlay.isHidden) this.body.classList.add('ui-idle');
    }
}
