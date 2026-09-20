import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CONFIG } from '../config.js';

/**
 * Scene, camera, renderer, orbit controls and the bloom post-processing chain.
 *
 * Everything here is shared by every visualiser mode; a mode only ever adds its
 * own objects to `scene` and takes them away again. The one thing modes do get
 * to dictate is the view, because the right camera for a sphere you orbit and
 * the right camera for a corridor you fly down have nothing in common.
 */
export class Stage {
    constructor(container) {
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x000000, 0.02);

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
        this.camera.position.set(0, 2, 8);

        this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        container.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.autoRotateSpeed = CONFIG.autoRotateSpeed;

        // Modes that fly the camera forward opt out of auto-rotate entirely.
        // Orbiting a corridor is not a view of anything.
        this.allowAutoRotate = true;
        this.controls.autoRotate = CONFIG.autoRotate;

        /**
         * How much of the Bloom setting this mode actually wants.
         *
         * The slider is the user's taste and applies everywhere; this is the
         * mode's own exposure. They are genuinely different quantities. The
         * sphere is mostly empty space, so bloom has little to catch and a
         * strong setting reads as a glow around the points; a filled surface
         * covering half the screen would need far less before it turned into
         * one flat white sheet. Scaling here rather than in each shader keeps
         * one number in the HUD meaning one thing.
         */
        this.bloomScale = 1;
        this.bloomStrength = CONFIG.bloomStrength;

        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            CONFIG.bloomStrength, CONFIG.bloomRadius, CONFIG.bloomThreshold
        );
        this.composer.addPass(this.bloomPass);

        window.addEventListener('resize', () => this.onResize());
    }

    onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.composer.setSize(window.innerWidth, window.innerHeight);
    }

    setBloomStrength(value) {
        this.bloomStrength = value;
        this.bloomPass.strength = value * this.bloomScale;
    }

    setBloomScale(scale) {
        this.bloomScale = scale;
        this.bloomPass.strength = this.bloomStrength * scale;
    }

    setAutoRotate(enabled) {
        this.controls.autoRotate = enabled && this.allowAutoRotate;
    }

    /**
     * Point the camera the way a mode wants it.
     *
     * Called on every mode switch, including the first. `autoRotate` here is the
     * mode's *permission*, not the user's setting — a mode that denies it keeps
     * the preference intact so it comes back when they switch to one that does.
     */
    applyView({ position, target, autoRotate = true, bloomScale = 1 }) {
        this.camera.position.set(...position);
        this.controls.target.set(...target);
        this.setBloomScale(bloomScale);
        this.allowAutoRotate = autoRotate;
        this.controls.autoRotate = CONFIG.autoRotate && autoRotate;
        this.controls.update();
    }

    setAutoRotateSpeed(value) {
        this.controls.autoRotateSpeed = value;
    }

    /** True while the user is actively dragging the camera. */
    isUserDragging() {
        return Boolean(this.controls.state) && this.controls.state !== -1;
    }

    /** Advance orbit damping / auto-rotate. Call before reading camera position. */
    update() {
        this.controls.update();
    }

    render() {
        this.composer.render();
    }
}
