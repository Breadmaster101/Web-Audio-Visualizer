import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { particlesVertexShader } from '../shaders/particles.vert.js';
import { particlesFragmentShader } from '../shaders/particles.frag.js';

/**
 * A sphere of points. The full `maxParticles` buffer is allocated once at
 * startup; the particle-count slider only moves the draw range, so changing it
 * costs nothing at runtime.
 */
export class ParticleSystem {
    constructor(scene) {
        this.material = this.createMaterial();
        this.points = new THREE.Points(this.createGeometry(), this.material);
        this.points.frustumCulled = false;
        scene.add(this.points);
    }

    createGeometry() {
        const geometry = new THREE.BufferGeometry();
        const positions = [];
        const sizes = [];
        const r = 4;

        for (let i = 0; i < CONFIG.maxParticles; i++) {
            // Uniform distribution over the sphere surface.
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos((Math.random() * 2) - 1);
            positions.push(
                r * Math.sin(phi) * Math.cos(theta),
                r * Math.sin(phi) * Math.sin(theta),
                r * Math.cos(phi)
            );
            sizes.push(Math.random() * CONFIG.particleSize);
        }

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
        geometry.setDrawRange(0, CONFIG.initialParticles);
        return geometry;
    }

    createMaterial() {
        return new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uBass: { value: 0 },
                uMid: { value: 0 },
                uTreble: { value: 0 },
                uBeat: { value: 0 },
                uBrightness: { value: CONFIG.brightness }
            },
            vertexShader: particlesVertexShader,
            fragmentShader: particlesFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });
    }

    setCount(count) {
        this.points.geometry.setDrawRange(0, count);
    }

    setBrightness(value) {
        this.material.uniforms.uBrightness.value = value;
    }

    setTime(time) {
        this.material.uniforms.uTime.value = time;
    }

    /** Push the analysed audio bands into the shader. */
    setAudio({ bass, mid, treble, beat }) {
        const u = this.material.uniforms;
        u.uBass.value = bass;
        u.uMid.value = mid;
        u.uTreble.value = treble;
        u.uBeat.value = beat;
    }
}
