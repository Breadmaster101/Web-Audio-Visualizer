import { ParticleSystem } from './ParticleSystem.js';
import { SpectralTerrain } from './SpectralTerrain.js';
import { Membrane } from './Membrane.js';

/**
 * The visualiser registry.
 *
 * One entry per mode, holding everything the rest of the app needs to know
 * about it: what to call it, how to frame it, which controls apply to it, and
 * how to build it. Adding a visualiser means adding a row here and nothing else
 * — the picker, the keyboard shortcuts, the control-column filtering and the
 * saved preference all read from this list.
 *
 * `controls` names the sliders that mean something for the mode. The ones it
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
        id: 'terrain',
        label: 'Terrain',
        tagline: 'The spectrum over time, as landscape. The horizon is six seconds ago.',
        controls: ['brightness', 'bloom', 'shake', 'speed'],
        // High enough that the near ridges do not hide the history behind them.
        // At eye level the first loud band becomes a wall across the strip and
        // the six seconds the mode exists to show are all behind it.
        view: { position: [0, 12, 16], target: [0, 0.5, -10], autoRotate: false, bloomScale: 0.35 },
        create: (stage) => new SpectralTerrain(stage)
    },
    {
        id: 'membrane',
        label: 'Membrane',
        tagline: 'A drumhead the music strikes. Ripples interfere and the rim reflects.',
        controls: ['brightness', 'bloom', 'shake', 'rotate', 'damping'],
        // Far enough back that the whole head is in frame. Closer, the rim runs
        // off both sides and the ripples have no boundary to visibly reflect
        // off, which is most of what makes it read as a drumhead.
        view: { position: [0, 9.5, 13.5], target: [0, 0, 0], autoRotate: true, bloomScale: 0.5 },
        create: (stage) => new Membrane(stage)
    }
];

export const DEFAULT_MODE = MODES[0].id;

/** The mode with this id, or the default if the id is unknown. */
export function findMode(id) {
    return MODES.find((mode) => mode.id === id) ?? MODES[0];
}
