import * as THREE from 'three';
import { VisualMode } from './VisualMode.js';
import { ema, envelope, smoothstep } from '../audio/dsp.js';
import { chladniVertexShader } from '../shaders/chladni.vert.js';
import { chladniFragmentShader } from '../shaders/chladni.frag.js';

/**
 * Grains of sand, spread over the whole screen. The lines cover a small share
 * of it, so this is what keeps them dense once the figure is tiled.
 */
const GRAINS = 1000000;

/** How many plates fit across the shorter side of the screen. */
const CELLS_SHORT = 2;

/** Warm sand, the colour with no key established. */
const SAND = new THREE.Color(1.0, 0.86, 0.64);

/**
 * The plate's modes, lowest first. A real plate's mode rings at a frequency
 * that rises with m^2 + n^2, so ordering by that is ordering by pitch: the
 * first few are the broad figures a deep sound excites, the last the fine
 * lattices that only high frequencies reach. The symmetry alternates so
 * neighbouring modes read as different figures rather than as one figure
 * gaining a line.
 */
const MODES = [];
for (let m = 2; m <= 8; m++) {
    for (let n = 1; n < m; n++) MODES.push([m, n]);
}
MODES.sort((a, b) => (a[0] ** 2 + a[1] ** 2) - (b[0] ** 2 + b[1] ** 2) || a[0] - b[0]);
MODES.length = 16;
MODES.forEach((mode, i) => mode.push(i % 2 === 0 ? 1 : -1));

/** Where the plate sits on the mode list before any music arrives. */
const IDLE_POSITION = 3;

/**
 * Attack and release, in seconds, for each slice's level before the balance
 * point is taken. Enough to stop single frames counting, no more: the real
 * smoothing is done once, on the balance point itself.
 */
const ATTACK = 0.1;
const RELEASE = 0.5;

/**
 * Seconds the balance point takes to follow the music. This is the one knob
 * that trades steadiness against response. Music alternates its low and high
 * content within every beat (kick, hat, kick, hat); followed any faster, the
 * plate swings between a broad figure and a fine one on every beat and much
 * of the sand jumps lines each time, which reads as flicker rather than as
 * music. At this rate a hit nudges the figure and a sustained change of
 * balance — a breakdown, a drop, a new instrument — carries it somewhere new.
 */
const BALANCE_TAU = 0.8;

/**
 * How far the centroid is stretched from the middle of the mode list. The
 * per-band calibration keeps it within a few modes of the centre; this lets a
 * genuinely dark or bright passage reach the ends.
 */
const BALANCE_GAIN = 3;

/**
 * Chladni mode: sand on a vibrating plate, gathered on the nodal lines.
 *
 * The plate is driven by the spectrum, the way a real one is. Each of its
 * sixteen modes is given a slice of the 72 detail bands, lowest mode to the
 * lowest slice, and the plate rings where the spectrum's weight currently
 * sits: the level-weighted balance point of the slices, as a position along
 * the mode list. The two modes either side of it are blended by
 * how close it is to each, and the sand settles on the lines of the blend.
 *
 * So deep material always means broad, simple figures and bright material
 * always means fine detail, the same sound always draws the same figure, and
 * as the balance shifts the lines slide, bend and split continuously into the
 * next figure. It is deliberately driven by one number averaged over every
 * band rather than by the individual bands' levels: those are noisy, and a
 * figure built from their differences jumps about with the noise.
 *
 * Onsets jolt the plate, bass drives it harder, and noisy material (high
 * spectral flatness) scatters the sand off the lines altogether. The colour is
 * the detected key around the circle of fifths, fading back to bare sand when
 * no key stands out.
 *
 * The figure is tiled across the whole screen as a wallpaper of mirrored
 * plates, drawn in clip space so the camera, orbit controls and shake have
 * nothing to act on. The motion is computed per grain in the vertex shader from
 * closed-form mode shapes, so there are no simulation buffers — see
 * `chladni.vert.js`.
 */
export class Chladni extends VisualMode {
    constructor(stage) {
        super(stage);
        this.camera = stage.camera;

        /** Smoothed level of each mode's slice of the spectrum. */
        this.strength = new Float32Array(MODES.length);
        /** Where on the mode list the plate is ringing, 0..15, fractional. */
        this.position = IDLE_POSITION;

        this.target = { vibe: 0.1, beat: 0, scatter: 0, treble: 0 };
        this.smooth = { vibe: 0.1, beat: 0, scatter: 0, treble: 0 };
        this.color = SAND.clone();
        this.targetColor = SAND.clone();
        this.jitterTime = 0;
        this.audioThisFrame = false;

        this.material = this.createMaterial();
        this.points = new THREE.Points(this.createGeometry(), this.material);
        this.points.frustumCulled = false;
        this.add(this.points);

        this.writePosition();
    }

    createGeometry() {
        const home = new Float32Array(GRAINS * 3);
        const rand = new Float32Array(GRAINS * 2);
        for (let i = 0; i < GRAINS; i++) {
            home[i * 3] = Math.random();
            home[i * 3 + 1] = Math.random();
            rand[i * 2] = Math.random();
            rand[i * 2 + 1] = Math.random();
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(home, 3));
        geometry.setAttribute('aRand', new THREE.BufferAttribute(rand, 2));
        return geometry;
    }

    createMaterial() {
        return new THREE.ShaderMaterial({
            uniforms: {
                uCells: { value: new THREE.Vector2(CELLS_SHORT, CELLS_SHORT) },
                uVibe: { value: 0.1 },
                uScatter: { value: 0 },
                uBeat: { value: 0 },
                uJitterTime: { value: 0 },
                uModeA: { value: new THREE.Vector3() },
                uModeB: { value: new THREE.Vector3() },
                uMix: { value: 0 },
                uColor: { value: SAND.clone() },
                uBrightness: { value: 1 }
            },
            vertexShader: chladniVertexShader,
            fragmentShader: chladniFragmentShader,
            transparent: true,
            depthTest: false,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });
    }

    setBrightness(value) {
        this.material.uniforms.uBrightness.value = value;
    }

    setAudio(metrics, dt) {
        this.audioThisFrame = true;
        const { bass, treble, beat, flatness } = metrics;

        this.target.vibe = 0.1 + bass * 0.9;
        this.target.beat = beat;
        this.target.treble = treble;
        // Tonal material sits well under 0.45; drums, distortion and noise rise
        // toward 1. Only the top of that range should lift the sand off.
        this.target.scatter = smoothstep(0.45, 0.85, flatness);

        this.drive(metrics.detail, dt);
        this.readKey(metrics);
    }

    /**
     * Find where the spectrum's weight sits along the mode list.
     *
     * A plain level-weighted centroid, which is linear in every band and so
     * moves smoothly and in proportion as the balance shifts. Anything that
     * picks out the slices standing out above the rest — thresholding them,
     * or squaring their excess — turns it into a contest the kick and the hats
     * win in turn on every beat, and the figure swings end to end with them.
     *
     * The bands are calibrated per band, so over time every slice averages out
     * at about the same level and the raw centroid stays near the middle of
     * the list. `BALANCE_GAIN` stretches it back out to reach both ends. With
     * nothing playing the plate holds where it is.
     */
    drive(detail, dt) {
        const per = detail.length / MODES.length;
        let moment = 0;
        let weight = 0;
        for (let i = 0; i < MODES.length; i++) {
            const lo = Math.floor(i * per);
            const hi = Math.max(lo + 1, Math.floor((i + 1) * per));
            let sum = 0;
            for (let b = lo; b < hi; b++) sum += detail[b];
            this.strength[i] = envelope(this.strength[i], sum / (hi - lo), dt, ATTACK, RELEASE);
            moment += this.strength[i] * i;
            weight += this.strength[i];
        }
        if (weight > 1e-3) {
            const middle = (MODES.length - 1) / 2;
            const centroid = moment / weight;
            // Clamped before smoothing, so a very dark or bright passage parks
            // the plate at the end of the list rather than winding up past it
            // and taking seconds to come back.
            const target = Math.min(MODES.length - 1, Math.max(0,
                middle + (centroid - middle) * BALANCE_GAIN));
            this.position = ema(this.position, target, dt, BALANCE_TAU);
        }
        this.writePosition();
    }

    /** The two modes either side of the balance point, and the blend between them. */
    writePosition() {
        const u = this.material.uniforms;
        const base = Math.min(MODES.length - 2, Math.max(0, Math.floor(this.position)));
        const mix = Math.min(1, Math.max(0, this.position - base));
        u.uModeA.value.set(...MODES[base]);
        u.uModeB.value.set(...MODES[base + 1]);
        u.uMix.value = mix;
    }

    /** Colour from the key: the circle of fifths around the hue wheel. */
    readKey(metrics) {
        const { tonic, isMinor, tonality } = metrics.chroma;
        const hue = ((tonic * 7) % 12) / 12;
        const keyColor = new THREE.Color().setHSL(hue, 0.8, isMinor ? 0.5 : 0.62);
        this.targetColor.copy(SAND).lerp(keyColor, smoothstep(0.15, 0.6, tonality) * 0.85);
    }

    /** Plates across and down, keeping them square at any aspect ratio. */
    fitCells(cells) {
        const aspect = this.camera.aspect;
        if (aspect >= 1) cells.set(CELLS_SHORT * aspect, CELLS_SHORT);
        else cells.set(CELLS_SHORT, CELLS_SHORT / aspect);
    }

    setTime(time, dt) {
        if (!this.audioThisFrame) {
            Object.assign(this.target, { vibe: 0.1, beat: 0, scatter: 0, treble: 0 });
            this.targetColor.copy(SAND);
        }
        this.audioThisFrame = false;

        const s = this.smooth;
        const t = this.target;
        s.vibe = envelope(s.vibe, t.vibe, dt, 0.02, 0.25);
        s.beat = envelope(s.beat, t.beat, dt, 0.008, 0.18);
        s.scatter = envelope(s.scatter, t.scatter, dt, 0.15, 0.6);
        s.treble = envelope(s.treble, t.treble, dt, 0.03, 0.2);

        const k = 1 - Math.exp(-dt / 1.5);
        this.color.lerp(this.targetColor, k);

        // Integrated rather than scaled, so a change in rate never makes the
        // grains jump: treble makes the sand chatter faster.
        this.jitterTime += dt * (1.5 + s.treble * 6 + s.vibe * 2);

        const u = this.material.uniforms;
        this.fitCells(u.uCells.value);
        u.uVibe.value = s.vibe;
        u.uBeat.value = s.beat;
        u.uScatter.value = s.scatter;
        u.uJitterTime.value = this.jitterTime;
        u.uColor.value.copy(this.color);
    }
}
