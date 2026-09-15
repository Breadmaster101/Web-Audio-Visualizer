import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { VisualMode } from './VisualMode.js';
import { clamp, lerp } from '../audio/dsp.js';
import { membraneSimShader, membraneSimVertexShader } from '../shaders/membrane.sim.js';
import { membraneVertexShader } from '../shaders/membrane.vert.js';
import { membraneFragmentShader } from '../shaders/membrane.frag.js';

/** Simulation grid. Square, and a power of two. */
const SIM = 512;
/** Mesh subdivision. Below the simulation resolution — the extra detail is in the shading. */
const SEGMENTS = 256;
const RADIUS = 7;
const HEIGHT = 1.5;

/**
 * Simulation steps per second, held fixed regardless of frame rate.
 *
 * The wave equation has no notion of elapsed time — one step is one step, and
 * the speed of a ripple is set by how many of them run. Tying steps to frames
 * would make the membrane ring visibly faster on a 144Hz display than on a
 * 60Hz one.
 */
const STEPS_PER_SECOND = 190;
/** Wave speed squared, in texels per step. The CFL limit in 2D is around 0.5. */
const WAVE_SPEED = 0.22;
const MAX_IMPULSES = 4;

/**
 * Membrane mode: the music as a struck drumhead.
 *
 * A wave equation runs continuously on a pair of render targets, and onsets
 * strike it. Because the state persists from frame to frame, this is the only
 * mode in the app that can show interference: two hits landing close together
 * produce a genuine interference pattern, the rim genuinely reflects, and a
 * lightly damped passage builds up standing waves that no amount of per-frame
 * displacement could imitate.
 *
 * Where a strike lands is chosen by the spectral centroid, following the modal
 * layout of a real drumhead — low content near the centre, where the fundamental
 * mode has its antinode, and bright content out toward the rim, where the higher
 * modes live. A bass drop therefore booms out from the middle and a hi-hat
 * pattern stipples the edge, without either being scripted.
 */
export class Membrane extends VisualMode {
    constructor(stage) {
        super(stage);

        this.renderer = stage.renderer;
        this.accumulator = 0;
        this.damping = CONFIG.damping;
        this.pending = [];

        const type = this.pickTextureType();
        this.targets = [this.createTarget(type), this.createTarget(type)];
        this.current = 0;

        this.impulses = [];
        for (let i = 0; i < MAX_IMPULSES; i++) this.impulses.push(new THREE.Vector4(0, 0, 0, 0.05));

        this.simMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uState: { value: this.targets[0].texture },
                uTexel: { value: new THREE.Vector2(1 / SIM, 1 / SIM) },
                uSpeed: { value: WAVE_SPEED },
                uDamping: { value: 0.9994 },
                uImpulses: { value: this.impulses }
            },
            vertexShader: membraneSimVertexShader,
            fragmentShader: membraneSimShader,
            depthTest: false,
            depthWrite: false
        });

        // A private scene for the simulation pass. The quad is written directly
        // in clip space, so the camera never actually matters — but a render
        // still needs one.
        this.simScene = new THREE.Scene();
        this.simCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.simQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.simMaterial);
        this.simQuad.frustumCulled = false;
        this.simScene.add(this.simQuad);

        this.clearTargets();

        this.material = new THREE.ShaderMaterial({
            uniforms: {
                uState: { value: this.targets[0].texture },
                uTexel: { value: new THREE.Vector2(1 / SIM, 1 / SIM) },
                uHeight: { value: HEIGHT },
                uTilt: { value: 0.5 },
                uTonality: { value: 0 },
                uBrightness: { value: CONFIG.brightness }
            },
            vertexShader: membraneVertexShader,
            fragmentShader: membraneFragmentShader,
            side: THREE.DoubleSide
        });

        const geometry = new THREE.PlaneGeometry(RADIUS * 2, RADIUS * 2, SEGMENTS, SEGMENTS);
        this.mesh = new THREE.Mesh(geometry, this.material);
        this.mesh.rotation.x = -Math.PI / 2;
        this.mesh.frustumCulled = false;
        this.add(this.mesh);
    }

    /**
     * Half float unless full float can actually be rendered to.
     *
     * The scheme subtracts two nearly equal numbers every step, so precision is
     * not a luxury here: at half float the quiet tail of a ripple quantises
     * into visible terraces long before it has decayed away. Half float is the
     * fallback rather than the default only because rendering to a 32-bit target
     * needs an extension, and an extension is never guaranteed.
     */
    pickTextureType() {
        const supported = this.renderer.extensions.has('EXT_color_buffer_float');
        return supported ? THREE.FloatType : THREE.HalfFloatType;
    }

    createTarget(type) {
        return new THREE.WebGLRenderTarget(SIM, SIM, {
            type,
            format: THREE.RGBAFormat,
            // Nearest throughout. The simulation reads exact neighbours, and
            // filtering a float texture needs an extension of its own that
            // buys nothing here — the mesh is coarser than the grid anyway.
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
            wrapS: THREE.ClampToEdgeWrapping,
            wrapT: THREE.ClampToEdgeWrapping,
            depthBuffer: false,
            stencilBuffer: false
        });
    }

    /** A render target's contents are undefined until something is drawn to it. */
    clearTargets() {
        const previous = this.renderer.getRenderTarget();
        for (const target of this.targets) {
            this.renderer.setRenderTarget(target);
            this.renderer.clear(true, false, false);
        }
        this.renderer.setRenderTarget(previous);
    }

    setBrightness(value) {
        this.material.uniforms.uBrightness.value = value;
    }

    /**
     * How long the membrane rings.
     *
     * Retention is per *step*, and there are ~190 steps a second, so the useful
     * range is a hair below 1 — 0.999 is already a ring of a couple of seconds
     * and 0.99 is a dead thud. Exposing that range directly would make almost
     * the whole slider useless, so the control is mapped onto it rather than
     * being it.
     */
    setDamping(value) {
        this.damping = value;
    }

    setAudio(metrics, dt) {
        this.material.uniforms.uTilt.value = metrics.tilt;
        this.material.uniforms.uTonality.value = metrics.chroma.tonality;

        // Noisy material is damped harder than tonal material, which is how the
        // two behave: a struck drum rings, a cymbal wash does not resolve into
        // anything that could.
        // Retention per step, and there are ~190 steps a second, so the whole
        // useful range sits just under 1. The top of it is deliberately short of
        // where it could go: a membrane struck three times a second takes in
        // energy faster than a longer ring gives it back, and the head saturates
        // into a single white sheet within a few bars. What looks like a
        // brighter setting is really an unbounded one.
        const ring = lerp(0.995, 0.9993, clamp(this.damping));
        this.simMaterial.uniforms.uDamping.value = lerp(ring, ring - 0.0025, metrics.flatness);

        this.collectStrikes(metrics);
        this.step(dt);
    }

    /**
     * Turn this frame's audio into strikes on the head.
     *
     * Onsets do the striking. The beat grid adds a much softer strike at the
     * centre on each beat, for the same reason the sphere has an idle pulse: a
     * sustained passage with no transients in it would otherwise let the
     * membrane decay to a flat, black disc.
     */
    collectStrikes(metrics) {
        this.pending.length = 0;

        if (metrics.onsets.strength > 0) {
            // Bright content strikes near the rim, low content near the centre,
            // following where a real drumhead's modes actually have their
            // antinodes. Nothing about the sound is being illustrated here — the
            // physics does the rest once the strike lands in the right place.
            const radius = clamp(0.06 + metrics.tilt * 0.42, 0, 0.46);
            const angle = Math.random() * Math.PI * 2;
            this.pending.push({
                x: 0.5 + Math.cos(angle) * radius,
                y: 0.5 + Math.sin(angle) * radius,
                strength: 0.02 + metrics.onsets.strength * 0.11 * (0.4 + metrics.crest),
                radius: 0.012 + (1 - metrics.tilt) * 0.05
            });
        }

        if (metrics.beatFired && metrics.confidence > 0.3) {
            this.pending.push({
                x: 0.5,
                y: 0.5,
                strength: 0.012 + metrics.bass * 0.04,
                radius: 0.05
            });
        }
    }

    /**
     * Advance the simulation by whole steps.
     *
     * Strikes are applied on the first step of the frame only. Applying them on
     * every step of a frame that happened to run four of them would inject four
     * times the energy for the same hit, and the membrane's response would then
     * depend on the frame rate.
     */
    step(dt) {
        this.accumulator += dt;
        const stepTime = 1 / STEPS_PER_SECOND;

        // Capped, so a stalled frame does not try to catch up with a hundred
        // steps at once and drop several more frames doing it.
        let steps = Math.min(Math.floor(this.accumulator / stepTime), 6);
        this.accumulator -= steps * stepTime;
        if (this.accumulator > stepTime * 6) this.accumulator = 0;

        // A frame with no step in it still has to place its strikes somewhere,
        // or a hit on a fast display is silently dropped.
        if (steps === 0 && this.pending.length > 0) steps = 1;

        const previousTarget = this.renderer.getRenderTarget();

        for (let i = 0; i < steps; i++) {
            this.setImpulses(i === 0 ? this.pending : null);

            const source = this.targets[this.current];
            const destination = this.targets[1 - this.current];

            this.simMaterial.uniforms.uState.value = source.texture;
            this.renderer.setRenderTarget(destination);
            this.renderer.render(this.simScene, this.simCamera);

            this.current = 1 - this.current;
        }

        this.renderer.setRenderTarget(previousTarget);
        this.material.uniforms.uState.value = this.targets[this.current].texture;
    }

    setImpulses(strikes) {
        for (let i = 0; i < MAX_IMPULSES; i++) {
            const strike = strikes && strikes[i];
            const slot = this.impulses[i];
            if (strike) {
                slot.set(strike.x, strike.y, strike.strength, strike.radius);
            } else {
                slot.set(0, 0, 0, 0.05);
            }
        }
    }

    dispose() {
        super.dispose();
        for (const target of this.targets) target.dispose();
        this.simQuad.geometry.dispose();
        this.simMaterial.dispose();
    }
}
