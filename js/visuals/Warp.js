import * as THREE from 'three';
import { CONFIG, ANALYSIS } from '../config.js';
import { VisualMode } from './VisualMode.js';
import { ema, envelope } from '../audio/dsp.js';
import { flareVertexShader } from '../shaders/flare.vert.js';
import { warpFeedbackShader } from '../shaders/warp.feedback.js';
import { warpDisplayShader } from '../shaders/warp.display.js';

/**
 * The feedback buffer runs at this fraction of the drawing buffer. Unlike the
 * flare it holds sharp lines at the moment they are drawn, so it needs more
 * than half resolution; past three quarters the resampling blur that ages
 * the trails hides any further gain.
 */
const WARP_SCALE = 0.75;

/** Where the spectrum ring rests, as a fraction of the screen's half-height. */
const RING_RADIUS = 0.32;

/**
 * Attack and release, in seconds. Bass and beat are fast so the tunnel kicks
 * on the hit; the hue is slow because it is tracking harmony, and a chord
 * change that snaps the whole palette reads as a glitch.
 */
const ATTACK = 0.01;
const RELEASE = { bass: 0.18, treble: 0.10, beat: 0.09, pulse: 0.08 };
const HUE_TAU = 1.6;
const SPIN_TAU = 0.7;

/**
 * How fast the tunnel moves, before the music adds to it.
 *
 * Zoom is the fraction of the radius content travels per second, and push
 * is a fixed distance per second (in half-heights) added to it; spin is
 * radians per second. Decay is the fraction of a trail's brightness that
 * survives one second, and hue drift is radians of hue rotation per second
 * applied to everything already in the buffer, which is what turns a single
 * colour of ring into a rainbow of trails.
 */
const FLOW = {
    zoom: 0.28,
    zoomBass: 0.30,
    zoomBeat: 1.4,
    push: 0.10,
    pushBeat: 0.45,
    spin: 0.10,
    spinPulse: 0.55,
    decay: 0.36,
    hueDrift: 0.45,
    wobble: 0.015,
    wobbleTreble: 0.10,
    /** Beats between reversals of the spin direction. */
    reverseEvery: 8
};

/** What the tunnel does with nothing playing: a slow breath on a dim ring. */
const IDLE = { bass: 0.08, treble: 0.0, beat: 0.0, pulse: 0.0 };

/**
 * Warp mode: a feedback tunnel in the style of the old Winamp visualisers.
 *
 * The whole picture lives in a pair of render targets. Each frame one is read
 * and the other written: the previous frame comes back zoomed outward, turned,
 * dimmed and hue-shifted, and this frame's spectrum is drawn over it as a ring
 * around the centre. Nothing is cleared, so the ring the music drew a moment
 * ago is still there behind the current one, further out and fainter. The
 * result has memory in a way the other two modes do not: a fill, a drop, a
 * bar of silence are all visible for seconds afterward, flying past.
 *
 * The music drives the flow rather than just the ring. Bass and each onset
 * kick the zoom, so hits push the whole history outward. The beat grid drives
 * the spin: it accelerates on every beat and eases off, so the tunnel breathes
 * in time, and the direction reverses every eight beats. Treble twists the
 * rotation by radius, which bends straight rays into spirals. The palette
 * follows the chroma: the strongest pitch classes are averaged around the
 * circle of fifths and the result picks the ring's hue, so a key change
 * changes the colour of everything drawn from then on.
 *
 * Both quads are drawn in clip space, so the camera, orbit controls and shake
 * have nothing to act on here; the registry row denies auto-rotate.
 */
export class Warp extends VisualMode {
    constructor(stage) {
        super(stage);

        this.renderer = stage.renderer;
        this.brightness = CONFIG.brightness;

        this.target = { ...IDLE };
        this.smooth = { bass: 0, treble: 0, beat: 0, pulse: 0 };
        this.audioThisFrame = false;

        this.hue = 0;
        this.hueTarget = 0;
        this.tonality = 0;
        this.spinDirection = 1;
        this.spinTarget = 1;
        this.confidence = 0;

        // The spectrum crosses to the shader as a one-row texture so the ring
        // can be sampled by angle with hardware interpolation between bands.
        this.detailData = new Uint8Array(ANALYSIS.detailBands);
        this.detailTexture = new THREE.DataTexture(
            this.detailData, ANALYSIS.detailBands, 1, THREE.RedFormat, THREE.UnsignedByteType);
        this.detailTexture.minFilter = THREE.LinearFilter;
        this.detailTexture.magFilter = THREE.LinearFilter;
        this.detailTexture.wrapS = THREE.ClampToEdgeWrapping;
        this.detailTexture.wrapT = THREE.ClampToEdgeWrapping;
        this.detailTexture.needsUpdate = true;

        this.targets = [this.createTarget(), this.createTarget()];
        this.current = 0;

        this.feedbackMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uPrev: { value: null },
                uDetail: { value: this.detailTexture },
                uTexel: { value: new THREE.Vector2(1, 1) },
                uAspect: { value: 1 },
                uTime: { value: 0 },
                uZoom: { value: 0 },
                uPush: { value: 0 },
                uRotate: { value: 0 },
                uWobble: { value: 0 },
                uDecay: { value: 1 },
                uHueShift: { value: 0 },
                uBass: { value: 0 },
                uBeat: { value: 0 },
                uPulse: { value: 0 },
                uHue: { value: 0 },
                uGain: { value: 1 },
                uRingRadius: { value: RING_RADIUS }
            },
            vertexShader: flareVertexShader,
            fragmentShader: warpFeedbackShader,
            depthTest: false,
            depthWrite: false
        });

        this.feedbackScene = new THREE.Scene();
        this.feedbackCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.feedbackQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.feedbackMaterial);
        this.feedbackQuad.frustumCulled = false;
        this.feedbackScene.add(this.feedbackQuad);

        this.displayMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uLight: { value: this.targets[0].texture },
                uAspect: { value: 1 }
            },
            vertexShader: flareVertexShader,
            fragmentShader: warpDisplayShader,
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
     * Trails overlap and stack well above 1.0 before the tonemap, and the
     * decay multiplies the buffer by a little under one every frame; in 8 bits
     * the faint end of every trail quantises to a hard step and then to
     * nothing, so the fallback is a visible downgrade.
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
     * Keep both targets at the working resolution. Checked every frame for
     * the same reason the flare does: the drawing buffer changes size on a
     * pixel-ratio change and nothing fires for that. Resizing clears the
     * buffers, so the history is lost across a resize; it refills in seconds.
     */
    fitTargets() {
        const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
        const width = Math.max(1, Math.round(size.x * WARP_SCALE));
        const height = Math.max(1, Math.round(size.y * WARP_SCALE));

        for (const target of this.targets) {
            if (target.width !== width || target.height !== height) {
                target.setSize(width, height);
            }
        }
        this.feedbackMaterial.uniforms.uTexel.value.set(1 / width, 1 / height);
        this.feedbackMaterial.uniforms.uAspect.value = size.x / size.y;
        this.displayMaterial.uniforms.uAspect.value = size.x / size.y;
    }

    setBrightness(value) {
        this.brightness = value;
    }

    /**
     * Only targets are set here; the smoothing happens in `setTime`, which runs
     * whether or not audio is connected, so the tunnel eases back to its idle
     * drift when the stream stops instead of freezing.
     */
    setAudio(metrics) {
        this.audioThisFrame = true;
        this.target.bass = metrics.bass;
        this.target.treble = metrics.treble;
        this.target.beat = metrics.beat;
        this.target.pulse = metrics.pulse;
        this.confidence = metrics.confidence;
        this.tonality = metrics.tonality;

        const detail = metrics.detail;
        for (let i = 0; i < detail.length; i++) {
            this.detailData[i] = Math.min(255, Math.max(0, detail[i] * 255)) | 0;
        }
        this.detailTexture.needsUpdate = true;

        this.hueTarget = Warp.chromaHue(metrics.chromaValues, this.hueTarget);

        // Reverse the spin every few bars. The target flips instantly and the
        // smoothed direction follows over a fraction of a second, so the
        // tunnel slows, stops and winds back up rather than snapping.
        const bars = Math.floor(metrics.beatIndex / FLOW.reverseEvery);
        this.spinTarget = bars % 2 === 0 ? 1 : -1;
    }

    /**
     * A hue from the chroma vector: each pitch class sits at its angle on the
     * circle of fifths, and the classes are averaged as vectors weighted by
     * strength. Adjacent fifths pull in nearly the same direction, so a chord
     * lands on a definite colour, while a cluster of unrelated notes cancels
     * toward the centre and the previous hue is kept.
     */
    static chromaHue(chroma, fallback) {
        let x = 0;
        let y = 0;
        for (let i = 0; i < 12; i++) {
            const angle = ((i * 7) % 12) / 12 * Math.PI * 2;
            x += Math.cos(angle) * chroma[i];
            y += Math.sin(angle) * chroma[i];
        }
        if (x * x + y * y < 0.01) return fallback;
        return (Math.atan2(y, x) / (Math.PI * 2) + 1) % 1;
    }

    setTime(time, dt) {
        if (!this.audioThisFrame) {
            Object.assign(this.target, IDLE);
            this.target.bass = IDLE.bass + 0.06 * Math.sin(time * 1.3);
            // A gentle standing pattern so the ring is not a flat circle
            // before audio arrives.
            for (let i = 0; i < this.detailData.length; i++) {
                const wave = 0.5 + 0.5 * Math.sin(time * 1.1 + i * 0.35);
                this.detailData[i] = (18 + wave * 40) | 0;
            }
            this.detailTexture.needsUpdate = true;
            this.confidence = 0;
            this.tonality = 0;
        }
        this.audioThisFrame = false;

        const s = this.smooth;
        const t = this.target;
        s.bass = envelope(s.bass, t.bass, dt, ATTACK, RELEASE.bass);
        s.treble = envelope(s.treble, t.treble, dt, ATTACK, RELEASE.treble);
        s.beat = envelope(s.beat, t.beat, dt, ATTACK, RELEASE.beat);
        s.pulse = envelope(s.pulse, t.pulse, dt, ATTACK, RELEASE.pulse);

        // With no key established the hue wanders on its own; with one, it
        // tracks the chroma. Wrapped so the path between two hues is the short
        // way round the wheel.
        if (this.tonality < 0.15) {
            this.hueTarget = (this.hueTarget + 0.015 * dt) % 1;
        }
        let delta = this.hueTarget - this.hue;
        if (delta > 0.5) delta -= 1;
        if (delta < -0.5) delta += 1;
        this.hue = (ema(this.hue, this.hue + delta, dt, HUE_TAU) + 1) % 1;

        this.spinDirection = ema(this.spinDirection, this.spinTarget, dt, SPIN_TAU);

        const zoomRate = FLOW.zoom + FLOW.zoomBass * s.bass + FLOW.zoomBeat * s.beat;
        const spinRate = this.spinDirection
            * (FLOW.spin + FLOW.spinPulse * s.pulse * this.confidence);

        const u = this.feedbackMaterial.uniforms;
        u.uTime.value = time;
        // Per-second rates become per-frame amounts here, so the flow looks
        // the same at any refresh rate.
        u.uZoom.value = 1 - Math.exp(-zoomRate * dt);
        u.uPush.value = (FLOW.push + FLOW.pushBeat * s.beat) * dt;
        u.uRotate.value = spinRate * dt;
        u.uWobble.value = (FLOW.wobble + FLOW.wobbleTreble * s.treble) * dt * 60;
        u.uDecay.value = Math.pow(FLOW.decay, dt);
        u.uHueShift.value = FLOW.hueDrift * dt;
        u.uBass.value = s.bass;
        u.uBeat.value = s.beat;
        u.uPulse.value = s.pulse;
        u.uHue.value = this.hue;
        // The slider's default is the shader's tuned exposure.
        u.uGain.value = this.brightness / 0.8;

        this.step();
    }

    /** Read one target, write the other, then show what was written. */
    step() {
        this.fitTargets();
        const read = this.targets[this.current];
        const write = this.targets[1 - this.current];

        this.feedbackMaterial.uniforms.uPrev.value = read.texture;

        const previous = this.renderer.getRenderTarget();
        this.renderer.setRenderTarget(write);
        this.renderer.render(this.feedbackScene, this.feedbackCamera);
        this.renderer.setRenderTarget(previous);

        this.displayMaterial.uniforms.uLight.value = write.texture;
        this.current = 1 - this.current;
    }

    dispose() {
        super.dispose();
        for (const target of this.targets) target.dispose();
        this.detailTexture.dispose();
        this.feedbackQuad.geometry.dispose();
        this.feedbackMaterial.dispose();
    }
}
