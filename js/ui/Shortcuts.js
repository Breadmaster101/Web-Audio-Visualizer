/**
 * Keyboard shortcuts.
 *
 * `H` is a deliberate hide and is tracked separately from the idle fade, so
 * moving the mouse does not undo it — the two states are independent classes on
 * <body> and either one is enough to take the bar away.
 *
 * The digits pick a visualiser directly and `V` steps through them, so modes
 * can be switched with the bar hidden, which is how the app is meant to be
 * watched.
 */
export class Shortcuts {
    constructor(controls) {
        this.controls = controls;
        window.addEventListener('keydown', (event) => this.onKey(event));
    }

    onKey(event) {
        // Never steal a chord the browser or OS owns.
        if (event.ctrlKey || event.metaKey || event.altKey) return;

        switch (event.key) {
            case 'h':
            case 'H':
                document.body.classList.toggle('ui-hidden');
                break;

            case 'f':
            case 'F':
                this.controls.toggleFullscreen();
                break;

            case 'a':
            case 'A':
                this.controls.toggleAutoSensitivity();
                break;

            case 'v':
            case 'V':
                this.controls.cycleMode(event.shiftKey ? -1 : 1);
                break;

            default:
                // Digits pick a visualiser by position. Anything past the end of
                // the list is ignored rather than wrapping.
                if (event.key >= '1' && event.key <= '9') {
                    this.controls.selectModeAt(Number(event.key) - 1);
                    break;
                }
                return;
        }

        // Only reached when a key was handled, so arrow keys keep working on a
        // focused slider.
        event.preventDefault();
    }
}
