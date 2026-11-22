import { ParticleSystem } from './ParticleSystem.js';
import { Flare } from './Flare.js';

/**
 * The visualiser registry.
 *
 * One entry per mode, holding everything the rest of the app needs to know
 * about it: what to call it, how bright to draw it, how to frame it, and how to
 * build it. Adding a visualiser means adding a row here and nothing else; the
 * picker, the keyboard shortcuts and the saved preference all read this list.
 *
 * `brightness` is fixed per mode rather than shared, because the two mean very
 * different things: the sphere is a million additive points, the flare a
 * tonemapped light whose tuned exposure is 0.8.
 *
 * `view.autoRotate` is the mode's permission to auto-rotate. `view.bloomScale`
 * is the mode's own exposure, multiplied into `CONFIG.bloomStrength`, since a
 * filled frame needs far less bloom than a cloud of points.
 */
export const MODES = [
    {
        id: 'sphere',
        label: 'Sphere',
        brightness: 0.10,
        view: { position: [0, 2, 8], target: [0, 0, 0], autoRotate: true, bloomScale: 1 },
        create: (stage) => new ParticleSystem(stage)
    },
    {
        id: 'flare',
        label: 'Flare',
        brightness: 0.8,
        // Drawn in clip space, so the camera is irrelevant and auto-rotate would
        // have nothing to turn. The shader already fills the frame with soft
        // light, so past about 0.2 bloom turns it into one white disc.
        view: { position: [0, 0, 8], target: [0, 0, 0], autoRotate: false, bloomScale: 0.06 },
        create: (stage) => new Flare(stage)
    }
];

export const DEFAULT_MODE = MODES[0].id;

/** The mode with this id, or the default if the id is unknown. */
export function findMode(id) {
    return MODES.find((mode) => mode.id === id) ?? MODES[0];
}
