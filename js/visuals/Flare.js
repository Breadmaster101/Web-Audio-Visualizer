import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { VisualMode } from './VisualMode.js';
import { envelope } from '../audio/dsp.js';
import { flareVertexShader } from '../shaders/flare.vert.js';
import { flareFragmentShader } from '../shaders/flare.frag.js';
import { flareTonemapShader } from '../shaders/flare.tonemap.js';

/**
 * The light pass runs at this fraction of the drawing buffer. The image is
 * entirely soft gradients, so a bilinear upsample from half resolution is
 * indistinguishable from the full-resolution render at a quarter of the cost.
 */
const LIGHT_SCALE = 0.5;

/**
 * Attack and release, in seconds, for the three signals the shader takes.
 *
 * Attack is near-instant everywhere: the mode exists to flash. The releases
 * are what make it read as light rather than as a meter — the glare lingers
 * after the hit the way an after-image does, and the bass swell of the core
 * subsides more slowly than the treble crackle in the rays.
 */
const ATTACK = 0.008;
const RELEASE = { intensity: 0.32, bass: 0.20, treble: 0.12 };

/** What the flare settles to with nothing playing: a dim but visible source. */
const IDLE = { intensity: 0.04, bass: 0.0, treble: 0.0 };

/**
 * Flare mode: a point of light seen straight on.
 *
 * Everything here is a picture of what the eye does to a bright source rather
 * than of the source itself — a blown-out core, a corona, faint interference
 * rings, the horizontal bar from a squint, and a field of diffraction needles
 * split into red, green and blue. The music drives how hard it burns.
 *
 * Two passes. The light is rendered as linear HDR into a half-resolution float
 * target, then a full-screen quad in the main scene upsamples it, tonemaps it
 * and dithers it. Both quads are drawn in clip space, so the camera, the orbit
 * controls and the beat-driven shake all have nothing to act on here; the
 * registry row denies auto-rotate and lists no camera controls for that reason.
 */
export class Flare extends VisualMode {
    constructor(stage) {
        super(stage);

        this.renderer = stage.renderer;
        this.brightness = CONFIG.brightness;

        this.target = { intensity: IDLE.intensity, bass: 0, treble: 0 };
        this.smooth = { intensity: 0, bass: 0, treble: 0 };
        this.audioThisFrame = false;

        this.lightTarget = this.createTarget();

        this.lightMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uIntensity: { value: 0 },
                uBass: { value: 0 },
                uTreble: { value: 0 },
                uAspect: { value: 1 }
            },
            vertexShader: flareVertexShader,
            fragmentShader: flareFragmentShader,
            depthTest: false,
            depthWrite: false
        });

        // A private scene for the light pass. The quad is written in clip space
        // so the camera never matters, but a render still needs one.
        this.lightScene = new THREE.Scene();
        this.lightCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.lightQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.lightMaterial);
        this.lightQuad.frustumCulled = false;
        this.lightScene.add(this.lightQuad);

        this.displayMaterial = new THREE.ShaderMaterial({
            uniforms: { uLight: { value: this.lightTarget.texture } },
            vertexShader: flareVertexShader,
            fragmentShader: flareTonemapShader,
            depthTest: false,
            depthWrite: false
        });

        const display = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.displayMaterial);
        display.frustumCulled = false;
        this.add(display);
    }

    /**
     * Half float if it can be rendered to, else 8-bit.
     *
     * The light is stored before tonemapping, and the tonemap curve is doing
     * real work well above 1.0 — that is where the core goes from bright to
     * blinding. An 8-bit target clips all of that to a flat white disc, so the
     * fallback is a visible downgrade rather than a free one, and exists only
     * because rendering to a float target needs an extension.
     */
    createTarget() {
        const type = this.renderer.extensions.has('EXT_color_buffer_float')
            ? THREE.HalfFloatType
            : THREE.UnsignedByteType;

        return new THREE.WebGLRenderTarget(1, 1, {
            type,
            format: THREE.RGBAFormat,
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            wrapS: THREE.ClampToEdgeWrapping,
            wrapT: THREE.ClampToEdgeWrapping,
            depthBuffer: false,
            stencilBuffer: false
        });
    }

    /**
     * Keep the light target at half the drawing buffer.
     *
     * Checked every frame rather than on the resize event, because the drawing
     * buffer also changes size when the window moves to a display with a
     * different pixel ratio, and nothing fires for that.
     */
    fitTarget() {
        const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
        const width = Math.max(1, Math.round(size.x * LIGHT_SCALE));
        const height = Math.max(1, Math.round(size.y * LIGHT_SCALE));

        if (this.lightTarget.width !== width || this.lightTarget.height !== height) {
            this.lightTarget.setSize(width, height);
        }
        this.lightMaterial.uniforms.uAspect.value = size.x / size.y;
    }

    setBrightness(value) {
        this.brightness = value;
    }

    /**
     * Only the targets are set here; the smoothing happens in `setTime`, which
     * runs whether or not audio is connected. That is what lets the flare fade
     * back to its idle glow when the stream stops instead of freezing on the
     * last value it was handed.
     */
    setAudio({ bass, mid, treble, beat }) {
        this.audioThisFrame = true;
        // The onset envelope is what makes a hit *flash*: the bands alone have
        // already been through the engine's release and read as a swell. Bass
        // is squared so a steady groove sits at a glow and only a real drop
        // burns; the tonemap saturates early, so the range has to be spent on
        // reach rather than on the core, which is white either way.
        this.target.intensity = IDLE.intensity + bass * bass * 0.6 + mid * 0.15 + beat * 0.9;
        this.target.bass = bass;
        this.target.treble = treble;
    }

    setTime(time, dt) {
        if (!this.audioThisFrame) Object.assign(this.target, IDLE);
        this.audioThisFrame = false;

        const s = this.smooth;
        const t = this.target;
        s.intensity = envelope(s.intensity, t.intensity, dt, ATTACK, RELEASE.intensity);
        s.bass = envelope(s.bass, t.bass, dt, ATTACK, RELEASE.bass);
        s.treble = envelope(s.treble, t.treble, dt, ATTACK, RELEASE.treble);

        const u = this.lightMaterial.uniforms;
        u.uTime.value = time;
        // The slider's default is the shader's tuned exposure; the rest of its
        // range is headroom in both directions.
        u.uIntensity.value = s.intensity * (this.brightness / 0.8);
        u.uBass.value = s.bass;
        u.uTreble.value = s.treble;

        this.renderLight();
    }

    renderLight() {
        this.fitTarget();
        const previous = this.renderer.getRenderTarget();
        this.renderer.setRenderTarget(this.lightTarget);
        this.renderer.render(this.lightScene, this.lightCamera);
        this.renderer.setRenderTarget(previous);
    }

    dispose() {
        super.dispose();
        this.lightTarget.dispose();
        this.lightQuad.geometry.dispose();
        this.lightMaterial.dispose();
    }
}
