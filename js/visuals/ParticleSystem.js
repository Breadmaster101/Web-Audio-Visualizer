import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { VisualMode } from './VisualMode.js';
import { particlesVertexShader } from '../shaders/particles.vert.js';
import { particlesFragmentShader } from '../shaders/particles.frag.js';

/**
 * Sphere mode: a sphere of points displaced by audio-driven fields.
 *
 * The point count is fixed at `CONFIG.particles`.
 */
export class ParticleSystem extends VisualMode {
    constructor(stage) {
        super(stage);
        this.material = this.createMaterial();
        this.points = new THREE.Points(this.createGeometry(), this.material);
        this.points.frustumCulled = false;
        this.add(this.points);
    }

    createGeometry() {
        const geometry = new THREE.BufferGeometry();
        const positions = [];
        const sizes = [];
        const r = 4;

        for (let i = 0; i < CONFIG.particles; i++) {
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
                uPulse: { value: 0 },
                uTilt: { value: 0.5 },
                uBrightness: { value: 1 }
            },
            vertexShader: particlesVertexShader,
            fragmentShader: particlesFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });
    }

    setBrightness(value) {
        this.material.uniforms.uBrightness.value = value;
    }

    setTime(time) {
        this.material.uniforms.uTime.value = time;
    }

    /** Push the analysed audio metrics into the shader. */
    setAudio({ bass, mid, treble, beat, pulse, tilt }) {
        const u = this.material.uniforms;
        u.uBass.value = bass;
        u.uMid.value = mid;
        u.uTreble.value = treble;
        u.uBeat.value = beat;
        u.uPulse.value = pulse;
        u.uTilt.value = tilt;
    }
}
