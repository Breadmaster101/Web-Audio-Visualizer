import { simplexNoise3D } from './noise.glsl.js';

/**
 * Displaces each particle on the sphere by four audio-driven fields:
 *   bass    -> radial expansion (plus a kick from the onset envelope)
 *   pulse   -> a small radial breath locked to the detected beat grid, so the
 *              cloud keeps moving in time through passages with no transients
 *   mid     -> turbulence (noise offset per axis)
 *   treble  -> spikes along the surface normal
 * Then spins the whole cloud slowly around Y and sizes the point by distance.
 *
 * uTilt is the spectral centroid, neutral at 0.5. It only nudges the resting
 * colour — dark, bass-led material sinks toward deep blue, airy material lifts
 * toward icy violet — leaving the bass/mid palette moves exactly as they were.
 */
export const particlesVertexShader = /* glsl */ `
    uniform float uTime;
    uniform float uBass;
    uniform float uMid;
    uniform float uTreble;
    uniform float uBeat;
    uniform float uPulse;
    uniform float uTilt;
    attribute float aSize;
    varying vec3 vColor;

    ${simplexNoise3D}

    void main() {
        vec3 pos = position;
        float noise = snoise(vec3(pos.x * 1.5 + uTime * 0.2, pos.y * 1.5 + uTime * 0.3, pos.z * 1.5));

        // Audio reactive modifications
        vec3 expansion = normalize(pos) * ((uBass * 3.0) + (uBeat * 0.5) + (uPulse * 0.35));
        vec3 turbulence = vec3(
            snoise(vec3(pos.x + uTime, pos.y, pos.z)),
            snoise(vec3(pos.x, pos.y + uTime, pos.z)),
            snoise(vec3(pos.x, pos.y, pos.z + uTime))
        ) * uMid * 2.0;
        vec3 spikes = normal * (noise * uTreble * 4.0);

        vec3 newPos = pos + expansion + turbulence + spikes;

        float angle = uTime * 0.1;
        mat3 rot = mat3(
            cos(angle), 0.0, sin(angle),
            0.0, 1.0, 0.0,
            -sin(angle), 0.0, cos(angle)
        );
        newPos = rot * newPos;

        vec4 mvPosition = modelViewMatrix * vec4(newPos, 1.0);
        gl_Position = projectionMatrix * mvPosition;

        gl_PointSize = (aSize * (1.0 + uTreble * 3.0 + uBeat * 2.0 + uPulse * 0.8)) * (100.0 / -mvPosition.z);

        // Palette: cyan at rest, red as bass rises, violet as mids fill in.
        vec3 c1 = vec3(1.0, 0.0, 0.3);
        vec3 c2 = vec3(0.0, 1.0, 1.0);
        vec3 c3 = vec3(0.5, 0.0, 1.0);

        // Timbre tilt, exactly neutral at 0.5 so the rest tone stays c2.
        float tilt = (uTilt - 0.5) * 2.0;
        vec3 rest = c2 + vec3(0.30, 0.0, 0.0) * max(tilt, 0.0)
                       - vec3(0.0, 0.32, 0.0) * max(-tilt, 0.0);

        vColor = mix(rest, c1, clamp(uBass, 0.0, 1.0));
        vColor = mix(vColor, c3, clamp(uMid, 0.0, 1.0));
    }
`;
