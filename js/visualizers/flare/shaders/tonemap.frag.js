/**
 * Flare mode, display pass: upsample the half-resolution light buffer to the
 * screen, tonemap it, and dither it.
 *
 * ACES gives the incandescent look — a blinding core that rolls off into a
 * clean white instead of clipping to a flat disc. The dither is the difference
 * between a smooth halo and a set of concentric 8-bit terraces: nearly all of
 * this image is a gradient dark enough that one code value is a visible step.
 */
export const flareTonemapShader = /* glsl */ `
    uniform sampler2D uLight;

    varying vec2 vUv;

    vec3 acesFilm(vec3 x) {
        const float a = 2.51;
        const float b = 0.03;
        const float c = 2.43;
        const float d = 0.59;
        const float e = 0.14;
        return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
    }

    /** Interleaved gradient noise — cheap, and free of the grid patterns that
        the usual sin/fract hash shows at low amplitudes. */
    float gradientNoise(vec2 coord) {
        return fract(52.9829189 * fract(0.06711056 * coord.x + 0.00583715 * coord.y));
    }

    void main() {
        vec3 light = texture2D(uLight, vUv).rgb;
        vec3 color = acesFilm(light);
        color += (gradientNoise(gl_FragCoord.xy) - 0.5) / 255.0;
        gl_FragColor = vec4(color, 1.0);
    }
`;
