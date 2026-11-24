import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { VisualMode } from './VisualMode.js';
import { ChordReader } from '../audio/ChordReader.js';
import { ChordRange } from '../audio/ChordRange.js';
import { LeadReader } from '../audio/LeadReader.js';
import { clamp, ema, envelope, smoothstep } from '../audio/dsp.js';
import { flareVertexShader } from '../shaders/flare.vert.js';
import { chladniFieldShader } from '../shaders/chladni.field.js';
import { chladniSimShader } from '../shaders/chladni.sim.js';
import {
    chladniDisplayShader,
    chladniGrainFragmentShader,
    chladniGrainVertexShader
} from '../shaders/chladni.grains.js';

/** The grains are a square texture this many on a side: 1,048,576 of them. */
const SIDE = 1024;

/** Size of the field texture. Its finest wave spans dozens of texels. */
const FIELD_SIZE = 512;

/**
 * How far past the screen's edge the plate and its sand go on. Enough that when
 * the lead rises and the figure shrinks, there is sand out there to come in.
 */
const OVERSCAN = 1.1;

/**
 * One wave per pitch class, C first: (m, n, symmetry), m and n being the
 * half-waves across half the screen's shorter side. None are whole numbers, so
 * the pattern never repeats across the width. Neighbouring notes are kept far
 * apart, so a chord that changes by a semitone changes visibly. A symmetry of 1
 * is a figure with the plate's full square symmetry; -1 keeps only its mirrors.
 */
const WAVES = [
    [3.35, 1.15, 1],       // C
    [4.60, 2.10, -1],      // C#
    [2.45, 2.05, 1],       // D
    [5.15, 0.75, 1],       // D#
    [4.10, 2.65, -1],      // E
    [2.70, 0.60, 1],       // F
    [5.30, 3.20, 1],       // F#
    [3.80, 1.95, 1],       // G
    [4.85, 3.55, -1],      // G#
    [3.05, 2.55, 1],       // A
    [5.60, 1.70, 1],       // A#
    [4.40, 1.35, -1]       // B
];

/** Warm sand, the colour with no key established. */
const SAND = new THREE.Color(1.0, 0.86, 0.64);

/**
 * How bright solid sand is: at rest, added by a full sustained bass, and added
 * by a full kick. The rest is dim on purpose. It is what the kick has to rise
 * from, and lines that start bright have nowhere left to go.
 */
const LIGHT = { rest: 0.3, sustain: 0.28, kick: 1.4 };

/** Seconds for the flash to arrive and to fade. */
const FLASH_ATTACK = 0.008;
const FLASH_RELEASE = 0.16;

/** White added at the thick of the lines by a full kick. */
const HEAT = 0.5;

/** Bloom at rest, and what a full kick adds. */
const BLOOM = { rest: 0.06, kick: 0.2 };

/** Plate units per second a kick's wavefront travels, and how it weakens. */
const RIPPLE_SPEED = 2.8;
const RIPPLE_TAU = 0.45;

/**
 * How much smaller the lead's highest note draws the figure, and its lowest
 * larger. A breath, not a zoom: a step in the melody moves it well under 1%.
 */
const LEAD_ZOOM = 1.06;

/** Seconds the sand takes to lift as a chord changes, and to settle after. */
const LIFT_ATTACK = 0.02;
const LIFT_RELEASE = 0.14;

/**
 * Chladni mode: sand with momentum on a plate shaped by chords.
 *
 * Each part of the music has one job and nothing else shares it:
 *   kick      a flash of light, and a ripple that throws the sand outward
 *   bass      the glow the flash rises from
 *   chords    the shape, the sand lifting as it changes
 *   lead      a slight breath in the size of the figure
 *   key       the colour
 *
 * The shape is a sum of twelve standing waves, one per pitch class, weighted by
 * what is sounding. The same chord always draws the same figure, chords that
 * share notes draw figures that share features, and there is no list of figures
 * to snap between. The sand is simulated rather than recomputed, so when the
 * shape changes the grains travel to it.
 *
 * Where in the spectrum the kick and the chords are is learned for each song, by
 * `KickFinder` and `ChordRange`. The figure is drawn in clip space, so the camera,
 * orbit controls and shake have nothing to act on, and bloom is driven by the
 * kick from here rather than being set once by the registry.
 */
export class Chladni extends VisualMode {
    constructor(stage) {
        super(stage);
        this.renderer = stage.renderer;
        this.brightness = 1;

        this.chords = new ChordReader();
        this.chordRange = new ChordRange();
        this.lead = null;
        this.target = { kick: 0, sustain: 0, lift: 0 };
        this.smooth = { kick: 0, sustain: 0, lift: 0 };
        this.ripples = Array.from({ length: 4 }, () => new THREE.Vector2(-10, 0));
        this.nextRipple = 0;
        this.color = SAND.clone();
        this.targetColor = SAND.clone();
        this.audioThisFrame = false;
        this.frame = 0;

        this.buildTargets();
        this.buildPasses();
    }

    get wantsKick() {
        return true;
    }

    buildTargets() {
        // Full float for the grains: at half precision, 1080p is finer than the
        // steps a position can take. Devices without it get a coarser plate.
        const float = this.renderer.extensions.has('EXT_color_buffer_float');
        const make = (width, height, type, filter) => new THREE.WebGLRenderTarget(width, height, {
            type,
            format: THREE.RGBAFormat,
            minFilter: filter,
            magFilter: filter,
            depthBuffer: false,
            stencilBuffer: false
        });
        const grain = float ? THREE.FloatType : THREE.HalfFloatType;
        this.state = make(SIDE, SIDE, grain, THREE.NearestFilter);
        this.nextState = make(SIDE, SIDE, grain, THREE.NearestFilter);
        this.field = make(FIELD_SIZE, FIELD_SIZE, THREE.HalfFloatType, THREE.LinearFilter);
        this.density = make(1, 1, THREE.HalfFloatType, THREE.NearestFilter);
    }

    buildPasses() {
        this.passCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.quad = new THREE.PlaneGeometry(2, 2);
        const pass = (fragmentShader, uniforms) => {
            const mesh = new THREE.Mesh(this.quad, new THREE.ShaderMaterial({
                uniforms,
                vertexShader: flareVertexShader,
                fragmentShader,
                depthTest: false,
                depthWrite: false
            }));
            mesh.frustumCulled = false;
            return mesh;
        };
        const alone = (object) => {
            const scene = new THREE.Scene();
            scene.add(object);
            return scene;
        };

        this.extent = new THREE.Vector2(1, 1);
        this.view = new THREE.Vector2(1, 1);

        this.fieldMesh = pass(chladniFieldShader, {
            uExtent: { value: this.extent },
            uWaves: { value: WAVES.map((wave) => new THREE.Vector3(...wave)) },
            uZoom: { value: 1 },
            uWeights: { value: this.chords.weights }
        });
        this.fieldScene = alone(this.fieldMesh);

        this.simMesh = pass(chladniSimShader, {
            uState: { value: null },
            uField: { value: this.field.texture },
            uExtent: { value: this.extent },
            uDt: { value: 0 },
            uFrame: { value: 0 },
            uReset: { value: true },
            uStretch: { value: 1 },
            uTremble: { value: 0 },
            uLift: { value: 0 },
            uRipples: { value: this.ripples }
        });
        this.simScene = alone(this.simMesh);

        // Each point only needs to know which texel it is.
        const ids = new Float32Array(SIDE * SIDE * 3);
        for (let i = 0; i < SIDE * SIDE; i++) {
            ids[i * 3] = i % SIDE;
            ids[i * 3 + 1] = Math.floor(i / SIDE);
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(ids, 3));
        this.grains = new THREE.Points(geometry, new THREE.ShaderMaterial({
            uniforms: {
                uState: { value: null },
                uField: { value: this.field.texture },
                uExtent: { value: this.extent },
                uView: { value: this.view },
                uSize: { value: 1 },
                uGrain: { value: 0.1 }
            },
            vertexShader: chladniGrainVertexShader,
            fragmentShader: chladniGrainFragmentShader,
            transparent: true,
            depthTest: false,
            depthWrite: false,
            blending: THREE.CustomBlending,
            blendSrc: THREE.OneFactor,
            blendDst: THREE.OneFactor
        }));
        this.grains.frustumCulled = false;
        this.grainScene = alone(this.grains);

        this.display = this.add(pass(chladniDisplayShader, {
            uDensity: { value: this.density.texture },
            uColor: { value: this.color },
            uLight: { value: LIGHT.rest },
            uHeat: { value: 0 }
        }));
    }

    setBrightness(value) {
        this.brightness = value;
    }

    setAudio(metrics, dt, { kick, dataArray, analyser, audioContext }) {
        this.audioThisFrame = true;
        // Built to the stream's own rate, so again if the source changes to another.
        if (this.lead?.sampleRate !== audioContext.sampleRate) {
            this.lead = new LeadReader(analyser.fftSize, audioContext.sampleRate);
        }
        this.lead.update(dataArray, metrics.gate, dt);
        this.chordRange.update(metrics.chroma, metrics.gate, dt);
        this.chords.update(this.chordRange.raw, metrics.gate, dt, this.lead);
        this.target.lift = this.chords.change * smoothstep(0.2, 0.6, this.chords.distance);

        // The detector calibrates itself, so only the controls a person sets
        // scale it. Auto-gain would be correcting it twice.
        const gain = CONFIG.trim * (CONFIG.autoSensitivity ? 1 : metrics.gain) * metrics.gate;
        this.target.kick = clamp((kick?.kick ?? 0) * gain, 0, 1.2);
        this.target.sustain = clamp((kick?.sustain ?? 0) * gain, 0, 1.2);
        if (kick?.fired) this.launchRipple(clamp(gain, 0, 1.2));

        const { tonic, isMinor, tonality } = metrics.chroma;
        const hue = ((tonic * 7) % 12) / 12;
        const keyColor = new THREE.Color().setHSL(hue, 0.8, isMinor ? 0.5 : 0.62);
        this.targetColor.copy(SAND).lerp(keyColor, smoothstep(0.15, 0.6, tonality) * 0.85);
    }

    /** Send a wavefront out from the centre, replacing the oldest one. */
    launchRipple(strength) {
        this.ripples[this.nextRipple].set(0, strength);
        this.nextRipple = (this.nextRipple + 1) % this.ripples.length;
    }

    setTime(time, dt) {
        if (!this.audioThisFrame) {
            this.target.kick = this.target.sustain = this.target.lift = 0;
            this.targetColor.copy(SAND);
        }
        this.audioThisFrame = false;

        const s = this.smooth;
        s.kick = envelope(s.kick, this.target.kick, dt, FLASH_ATTACK, FLASH_RELEASE);
        s.sustain = ema(s.sustain, this.target.sustain, dt, 0.06);
        s.lift = envelope(s.lift, this.target.lift, dt, LIFT_ATTACK, LIFT_RELEASE);
        this.color.lerp(this.targetColor, 1 - Math.exp(-dt / 1.5));

        for (const ripple of this.ripples) {
            ripple.x += RIPPLE_SPEED * dt;
            ripple.y *= Math.exp(-dt / RIPPLE_TAU);
        }

        const u = this.display.material.uniforms;
        u.uLight.value = this.brightness
            * (LIGHT.rest + s.sustain * LIGHT.sustain + s.kick * LIGHT.kick);
        u.uHeat.value = this.brightness * s.kick * s.kick * HEAT;
        this.stage.setBloomScale(BLOOM.rest + s.kick * BLOOM.kick);

        this.fit();
        this.step(Math.min(dt, 1 / 30));
    }

    /** Match the plate and the density target to the screen. */
    fit() {
        const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
        const shorter = Math.max(1, Math.min(size.x, size.y));
        this.view.set(size.x / shorter, size.y / shorter);
        this.extent.copy(this.view).multiplyScalar(OVERSCAN);

        if (this.density.width !== size.x || this.density.height !== size.y) {
            this.density.setSize(Math.max(1, size.x), Math.max(1, size.y));
        }
        // Keeps the same sand equally solid whatever the resolution: the points
        // grow with the screen, and each counts for less once they overlap more.
        const u = this.grains.material.uniforms;
        const scale = shorter / 1080;
        const point = Math.max(1, 1.4 * scale);
        u.uSize.value = point;
        u.uGrain.value = 0.17 * (1.4 * scale / point) ** 2;
    }

    step(dt) {
        const renderer = this.renderer;
        const previous = renderer.getRenderTarget();
        const draw = (scene, target) => {
            renderer.setRenderTarget(target);
            renderer.render(scene, this.passCamera);
        };

        const zoom = this.fieldMesh.material.uniforms.uZoom;
        const before = zoom.value;
        zoom.value = LEAD_ZOOM ** (this.lead?.height ?? 0);
        this.simMesh.material.uniforms.uStretch.value = before / zoom.value;
        draw(this.fieldScene, this.field);

        const sim = this.simMesh.material.uniforms;
        sim.uState.value = this.state.texture;
        sim.uDt.value = dt;
        sim.uFrame.value = this.frame;
        sim.uReset.value = this.frame === 0;
        sim.uTremble.value = 0.1 + this.smooth.sustain * 0.12;
        sim.uLift.value = this.smooth.lift;
        draw(this.simScene, this.nextState);
        [this.state, this.nextState] = [this.nextState, this.state];
        this.frame++;

        this.grains.material.uniforms.uState.value = this.state.texture;
        draw(this.grainScene, this.density);

        renderer.setRenderTarget(previous);
    }

    dispose() {
        super.dispose();
        for (const target of [this.state, this.nextState, this.field, this.density]) {
            target.dispose();
        }
        this.quad.dispose();
        this.fieldMesh.material.dispose();
        this.simMesh.material.dispose();
        this.grains.geometry.dispose();
        this.grains.material.dispose();
    }
}
