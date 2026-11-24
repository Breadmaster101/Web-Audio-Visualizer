import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CONFIG } from '../config.js';

/** The Sphere canvas: its own WebGL context, scene, orbiting camera and bloom chain. */
export class SphereStage {
    constructor(container) {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
        this.camera.position.set(...CONFIG.cameraPosition);

        this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        container.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.autoRotate = CONFIG.autoRotate;
        this.controls.autoRotateSpeed = CONFIG.autoRotateSpeed;
        this.controls.update();

        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            CONFIG.bloomStrength, CONFIG.bloomRadius, CONFIG.bloomThreshold
        );
        this.composer.addPass(this.bloomPass);

        this.onResize = () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
            this.composer.setSize(window.innerWidth, window.innerHeight);
        };
        window.addEventListener('resize', this.onResize);
    }

    /** Advance orbit damping / auto-rotate. Call before reading camera position. */
    update() {
        this.controls.update();
    }

    render() {
        this.composer.render();
    }

    /** Free the context too: browsers allow only a handful at a time. */
    dispose() {
        window.removeEventListener('resize', this.onResize);
        this.controls.dispose();
        this.bloomPass.dispose();
        this.composer.dispose();
        this.renderer.dispose();
        this.renderer.forceContextLoss();
        this.renderer.domElement.remove();
    }
}
