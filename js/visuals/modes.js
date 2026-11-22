import { ParticleSystem } from './ParticleSystem.js';
import { Flare } from './Flare.js';

/**
 * The visualiser registry.
 *
 * One entry per mode, holding everything the rest of the app needs to know
 * about it: what to call it, how to frame it, which controls apply to it, and
 * how to build it. Adding a visualiser means adding a row here and nothing else
 * — the picker, the keyboard shortcuts, the control-column filtering and the
 * saved preference all read from this list.
 *
 * `controls` names the controls that mean something for the mode. The ones it
 * leaves out are hidden rather than disabled, because a control that cannot
 * affect anything is not information, it is furniture. The three reactivity
 * controls are never listed: they act on the analysis engine, which is shared,
 * so they apply everywhere.
 *
 * `view.autoRotate` is the mode's *permission*, not the user's setting. A mode
 * that flies the camera forward denies it, and the preference survives intact
 * for the next mode that allows it. `view.bloomScale` is the mode's own
 * exposure, multiplied into whatever the Bloom slider is set to — a filled
 * surface needs far less of it than a cloud of points does.
 */
export const MODES = [
    {
        id: 'sphere',
        label: 'Sphere',
        tagline: 'A quarter-million points, displaced by the whole spectrum at once.',
        controls: ['particles', 'brightness', 'bloom', 'shake', 'rotate'],
        view: { position: [0, 2, 8], target: [0, 0, 0], autoRotate: true, bloomScale: 1 },
        create: (stage) => new ParticleSystem(stage)
    },
    {
        id: 'flare',
        label: 'Flare',
        tagline: 'A point of light, stared at. The music decides how hard it burns.',
        controls: ['brightness', 'bloom', 'chromatic'],
        // Drawn in clip space, so the camera is irrelevant: the position is a
        // formality and auto-rotate would have nothing to turn. The shader
        // tonemaps its own glare and already fills the frame with soft light, so
        // bloom has everything to catch: past about 0.2 it becomes one white disc.
        view: { position: [0, 0, 8], target: [0, 0, 0], autoRotate: false, bloomScale: 0.06 },
        create: (stage) => new Flare(stage)
    }
];

export const DEFAULT_MODE = MODES[0].id;

/** The mode with this id, or the default if the id is unknown. */
export function findMode(id) {
    return MODES.find((mode) => mode.id === id) ?? MODES[0];
}
