const STORAGE_KEY = 'emoney-visualizer/v1';

/**
 * Persists control values to localStorage so a session survives a reload.
 *
 * Writes are debounced because the obvious caller is a slider's `input` event,
 * which fires on every pixel of a drag. Reads are tolerant of anything: storage
 * can be disabled outright (private windows, blocked third-party contexts) and
 * whatever is in there was written by an older version of this file, so every
 * value is re-validated by the caller before it is used.
 */
export class Settings {
    constructor(delay = 250) {
        this.delay = delay;
        this.timer = null;
        this.values = this.read();
    }

    read() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : null;
            // Guards against `null`, arrays and primitives, all valid JSON.
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }

    /** Stored value for `key`, or `fallback` if it was never saved. */
    get(key, fallback) {
        return Object.prototype.hasOwnProperty.call(this.values, key)
            ? this.values[key]
            : fallback;
    }

    set(key, value) {
        this.values[key] = value;
        this.schedule();
    }

    clear() {
        this.values = {};
        clearTimeout(this.timer);
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch {
            /* Nothing to do — the session simply will not persist. */
        }
    }

    schedule() {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.flush(), this.delay);
    }

    flush() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.values));
        } catch {
            /* Quota or a disabled store. Not worth interrupting the visuals for. */
        }
    }
}
