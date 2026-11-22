import { simplexNoise3D } from './noise.glsl.js';

/**
 * Places one grain of sand on a Chladni plate, tiled across the whole screen.
 *
 * The plate vibrates in a blend of two neighbouring mode shapes, `uModeA` and
 * `uModeB`, each as (m, n, s), with `uMix` how far it has moved from the first
 * to the second. The sand collects where the blend is zero. The mix changes
 * continuously, so the lines slide, bend, split and merge from one figure into
 * the next rather than switching.
 *
 * Each mode shape is the free-edge approximation for a square plate,
 *     f(x, y) = cos(n pi x) cos(m pi y) - s cos(m pi x) cos(n pi y)
 * a product of cosines, so it is defined everywhere and repeats by mirroring:
 * the unit plate's edges are lines of symmetry, and continuing the field past
 * them gives a seamless wallpaper of mirrored plates. The grains are spread
 * over the screen and the field is evaluated wherever they are, `uCells`
 * plates across. Drawn in clip space, so the camera has nothing to act on.
 *
 * Each grain has a fixed home on the screen (`position.xy`, 0..1). Its resting
 * place is that home projected onto the nearest nodal line by a few clamped
 * Newton steps along the gradient. That is all "settling" means here, and it
 * needs no state: the same home under the same mix always lands in the same
 * place, so the shader recomputes it from scratch every frame instead of
 * simulating a million grains.
 */
export const chladniVertexShader = /* glsl */ `
    uniform vec2 uCells;
    uniform float uVibe;
    uniform float uScatter;
    uniform float uBeat;
    uniform float uJitterTime;
    uniform vec3 uModeA;
    uniform vec3 uModeB;
    uniform float uMix;
    uniform vec3 uColor;

    attribute vec2 aRand;

    varying vec3 vColor;
    varying float vAlpha;

    ${simplexNoise3D}

    const float PI = 3.14159265359;

    // One mode shape and its gradient, packed as (f, df/dx, df/dy).
    vec3 mode(vec2 p, vec3 k) {
        float m = k.x * PI;
        float n = k.y * PI;
        float cnx = cos(n * p.x), snx = sin(n * p.x);
        float cmy = cos(m * p.y), smy = sin(m * p.y);
        float cmx = cos(m * p.x), smx = sin(m * p.x);
        float cny = cos(n * p.y), sny = sin(n * p.y);

        float f = cnx * cmy - k.z * cmx * cny;
        float dx = -n * snx * cmy + k.z * m * smx * cny;
        float dy = -m * cnx * smy + k.z * n * cmx * sny;
        return vec3(f, dx, dy);
    }

    // The plate: a blend of two neighbouring modes. Differentiation is linear,
    // so the gradient blends the same way.
    vec3 plate(vec2 p) {
        return mix(mode(p, uModeA), mode(p, uModeB), uMix);
    }

    // Newton projection onto f = 0. Steps are clamped so a grain sitting on a
    // flat antinode, where the gradient vanishes, walks off it instead of
    // being flung across the plate.
    vec2 settle(vec2 p) {
        for (int i = 0; i < 8; i++) {
            vec3 g = plate(p);
            vec2 step = g.x * g.yz / (dot(g.yz, g.yz) + 1e-4);
            float len = length(step);
            p -= step * min(1.0, 0.05 / max(len, 1e-6));
        }
        return p;
    }

    void main() {
        // Screen fraction to plate units, centred on the middle of a plate.
        vec2 home = 0.5 + (position.xy - 0.5) * uCells;
        vec2 p = settle(home);

        // How far the grain still is from a line, in plate units. Strays that
        // never converged stay faintly visible, like loose sand off the figure.
        vec3 g = plate(p);
        float dist = abs(g.x) / (length(g.yz) + 1e-3);

        // Grains never sit perfectly still on a vibrating plate. A fixed offset
        // gives each line some width; the moving one is the plate's agitation.
        vec2 rest = (aRand - 0.5) * 0.0035;
        float amp = 0.0012
                  + uVibe * 0.0035
                  + uBeat * 0.010
                  + uScatter * 0.05;
        vec2 jitter = vec2(
            snoise(vec3(position.xy * 160.0, uJitterTime)),
            snoise(vec3(position.yx * 160.0 + 17.0, uJitterTime))
        ) * amp;

        vec2 screen = 0.5 + (p + rest + jitter - 0.5) / uCells;
        gl_Position = vec4(screen * 2.0 - 1.0, 0.0, 1.0);

        gl_PointSize = (0.9 + aRand.y * 0.9)
                     * (1.0 + uVibe * 0.3 + uBeat * 0.35);

        // Kept modest: the grains are additive and pile up on the lines, so a
        // loud onset over loud bass otherwise turns the figure into one sheet.
        vColor = uColor * (0.6 + uVibe * 0.35 + uBeat * 0.25);
        // Strays kept faint: tiled across the whole screen, any real brightness
        // adds up to a haze over the dark between the lines.
        vAlpha = mix(1.0, 0.06, smoothstep(0.004, 0.03, dist));
    }
`;
