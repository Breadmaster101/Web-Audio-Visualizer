import { simplexNoise3D } from './noise.glsl.js';

/**
 * Flare mode, light pass: a point source seen straight on, with everything the
 * eye adds to one — a blown-out core, a corona, faint Airy rings, the horizontal
 * bar from a squint, and a field of diffraction needles split into R, G and B.
 *
 * This pass writes *linear light* to a half-resolution float target. It is not
 * tonemapped here on purpose: everything in this image is a soft gradient, so a
 * bilinear upsample of it is invisible, while the tonemap and the dither are
 * applied afterwards at full resolution where they belong.
 *
 * The needles are the expensive part. Every pixel evaluates four octaves of
 * noise three times (once per colour channel, at a slightly different angle),
 * which is why the pass runs at half resolution to begin with. The noise is
 * sampled on the unit circle rather than on the angle, so there is no seam at
 * ±π; time goes in the third dimension, so the rays evolve in place instead of
 * sliding sideways.
 */
export const flareFragmentShader = /* glsl */ `
    uniform float uTime;
    /** Overall emission. 0 is dark, 1 is a comfortable glare, beyond it blinds. */
    uniform float uIntensity;
    uniform float uBass;
    uniform float uTreble;
    /** Drawing-buffer aspect, so the flare stays round on any window. */
    uniform float uAspect;

    varying vec2 vUv;

    ${simplexNoise3D}

    /** Simplex noise folded into 0..1. */
    float noise01(vec3 p) {
        return snoise(p) * 0.5 + 0.5;
    }

    /**
     * The ray field along one direction.
     *
     * Four octaves at increasing angular frequency: long structural spikes, a
     * medium ciliary corona, fine crystalline needles, and a micro crackle that
     * the treble excites. Each is raised to a high power so that most of the
     * circle is dark and only the peaks of the noise become rays.
     */
    float needleLayer(float angle, float dist, float chromOffset) {
        float a = angle + chromOffset;
        vec2 p = vec2(cos(a), sin(a));

        float r1 = pow(noise01(vec3(p * 14.0,  uTime * 0.05 + 3.1)), 3.6) * 1.8;
        float r2 = pow(noise01(vec3(p * 42.0,  uTime * 0.11 + 7.7)), 4.2) * 2.8;
        float r3 = pow(noise01(vec3(p * 120.0, uTime * 0.30 + 1.9)), 4.8) * (3.5 + uTreble * 4.5);
        float r4 = pow(noise01(vec3(p * 280.0, uTime * 0.65 + 5.3)), 5.5) * (2.0 + uTreble * 7.0);

        float needles = r1 + r2 + r3 + r4;

        // Non-uniform reach: some rays pierce much further out than others.
        float reach = 0.45 + 1.1 * pow(noise01(vec3(p * 3.5, uTime * 0.025)), 1.8);
        float falloff = exp(-dist * (4.2 / reach)) / (dist + 0.07);

        return needles * falloff;
    }

    void main() {
        // Centred, with the short axis running -0.5..0.5.
        vec2 uv = (vUv - 0.5) * vec2(uAspect, 1.0);
        float dist = length(uv);
        float angle = atan(uv.y, uv.x);

        // 1. Incandescent core.
        float coreRadius = 0.0022 + uBass * 0.0035;
        float core = coreRadius / (dist * dist + 0.00065);

        // 2. Corona halo.
        float halo = exp(-dist * (7.0 - uBass * 1.8)) * 1.5;

        // 3. Faint Airy interference rings.
        float ringHarmonics = sin(dist * 55.0 - uTime * 2.5) * 0.5 + 0.5;
        float airyRings = exp(-dist * 12.0) * ringHarmonics * 0.35;

        // 4. Horizontal squint bar, with a slow shimmer along its length.
        float hStreak = 0.00065 / (abs(uv.y * 3.6 + uv.x * 0.025) + 0.0007);
        hStreak *= exp(-abs(uv.x) * 2.4);
        hStreak *= 1.0 + 0.15 * sin(uv.x * 60.0 - uTime * 6.0);

        // 5. Chromatic needles: the same field sampled at three angles, with
        //    the split widening with distance the way real dispersion does.
        float chromShift = (0.018 + uTreble * 0.022) * dist;
        vec3 rays = vec3(
            needleLayer(angle, dist, -chromShift),
            needleLayer(angle, dist, 0.0),
            needleLayer(angle, dist, chromShift)
        ) * 0.32;

        // Scintillation in the glare, only when there is treble to drive it.
        rays *= 1.0 + 0.12 * sin(angle * 45.0 + uTime * 18.0) * uTreble;

        vec3 light = vec3(0.0);
        light += (core + halo + airyRings) * vec3(1.0, 0.99, 0.97);
        light += hStreak * vec3(0.92, 0.96, 1.0) * (0.8 + uBass * 1.5);
        light += rays;
        light *= uIntensity;

        gl_FragColor = vec4(light, 1.0);
    }
`;
