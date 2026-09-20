/**
 * Warp mode, display pass: bring the feedback buffer to the screen.
 *
 * The buffer holds linear light that stacks well past 1.0 where trails
 * overlap, so it is tonemapped rather than clipped, and dithered because most
 * of the frame is a dark gradient. A vignette holds the edges down: the tunnel
 * flows outward, and without it the brightest part of the image is the border.
 */
export const warpDisplayShader = /* glsl */ `
    uniform sampler2D uLight;
    uniform float uAspect;

    varying vec2 vUv;

    vec3 acesFilm(vec3 x) {
        const float a = 2.51;
        const float b = 0.03;
        const float c = 2.43;
        const float d = 0.59;
        const float e = 0.14;
        return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
    }

    float gradientNoise(vec2 coord) {
        return fract(52.9829189 * fract(0.06711056 * coord.x + 0.00583715 * coord.y));
    }

    void main() {
        vec3 light = texture2D(uLight, vUv).rgb;

        vec2 p = (vUv - 0.5) * 2.0 * vec2(uAspect, 1.0);
        float vignette = 1.0 - smoothstep(0.7, 1.6, length(p)) * 0.8;

        vec3 color = acesFilm(light * vignette);
        color += (gradientNoise(gl_FragCoord.xy) - 0.5) / 255.0;
        gl_FragColor = vec4(color, 1.0);
    }
`;
