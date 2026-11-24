/**
 * Chladni, field pass: the shape of the vibrating plate.
 *
 * One standing wave per pitch class, summed by how strongly each is sounding.
 * Writes the height and its gradient, (f, df/dx, df/dy), so the million grains
 * can each look the plate up instead of each adding up twelve waves.
 *
 * `uWaves` is (m, n, s) per pitch class, the free-edge approximation for a
 * square plate. Built from cosines alone, so every sum of them is mirrored about
 * the centre both ways. `uZoom` is how small the figure is drawn.
 */
export const chladniFieldShader = /* glsl */ `
    uniform vec2 uExtent;
    uniform float uZoom;
    uniform vec3 uWaves[12];
    uniform float uWeights[12];

    varying vec2 vUv;

    const float PI = 3.14159265359;

    void main() {
        vec2 p = (vUv * 2.0 - 1.0) * uExtent * uZoom;
        vec3 sum = vec3(0.0);
        for (int i = 0; i < 12; i++) {
            vec3 w = uWaves[i];
            float m = w.x * PI;
            float n = w.y * PI;
            vec4 a = vec4(n * p.x, m * p.y, m * p.x, n * p.y);
            vec4 c = cos(a);
            vec4 s = sin(a);
            sum += uWeights[i] * vec3(
                c.x * c.y + w.z * c.z * c.w,
                -n * s.x * c.y - w.z * m * s.z * c.w,
                -m * c.x * s.y - w.z * n * c.z * s.w);
        }
        gl_FragColor = vec4(sum.x, sum.yz * uZoom, 1.0);
    }
`;
