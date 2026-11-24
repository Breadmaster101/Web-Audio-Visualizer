import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { CONFIG } from '../config.js';

/** The Flare canvas: its own WebGL context, scene, and bloom chain. */
export class FlareStage {
    constructor(container) {
        this.scene = new THREE.Scene();
        // Everything is drawn in clip space; a render still needs a camera.
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

        this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        container.appendChild(this.renderer.domElement);

        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            CONFIG.bloomStrength, CONFIG.bloomRadius, CONFIG.bloomThreshold
        );
        this.composer.addPass(this.bloomPass);

        this.onResize = () => {
            this.renderer.setSize(window.innerWidth, window.innerHeight);
            this.composer.setSize(window.innerWidth, window.innerHeight);
        };
        window.addEventListener('resize', this.onResize);
    }

    render() {
        this.composer.render();
    }

    /** Free the context too: browsers allow only a handful at a time. */
    dispose() {
        window.removeEventListener('resize', this.onResize);
        this.bloomPass.dispose();
        this.composer.dispose();
        this.renderer.dispose();
        this.renderer.forceContextLoss();
        this.renderer.domElement.remove();
    }
}
