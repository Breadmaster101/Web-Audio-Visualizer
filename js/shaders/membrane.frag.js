/**
 * Membrane shading.
 *
 * Luminance comes from slope rather than from height. That is the whole trick:
 * a wavefront is a place where the surface is steep, so shading the gradient
 * draws the travelling rings themselves, while shading the height would only
 * light up wherever the membrane happens to be displaced and leave the fronts
 * invisible as they cross flat water.
 */
export const membraneFragmentShader = /* glsl */ `
    uniform float uBrightness;
    uniform float uTilt;
    uniform float uTonality;

    varying float vHeight;
    varying float vSlope;
    varying vec3 vNormalView;
    varying vec2 vUv;

    void main() {
        float radius = length(vUv - 0.5) * 2.0;
        // The rim is a hard clamp in the simulation; fading the last few percent
        // keeps that from showing as a cut edge.
        float disc = 1.0 - smoothstep(0.92, 0.99, radius);
        if (disc <= 0.001) discard;

        // Crests and troughs get different colours, so a standing wave shows its
        // alternation instead of reading as one texture vibrating.
        vec3 crest = mix(vec3(0.10, 0.85, 1.00), vec3(1.00, 0.75, 0.30), clamp(uTilt, 0.0, 1.0));
        vec3 trough = vec3(0.45, 0.15, 0.85);
        vec3 tone = mix(trough, crest, smoothstep(-0.35, 0.35, vHeight));

        // Tonal material settles toward a cooler, more even surface; noisy
        // material keeps the harder colour separation. Matches how the two
        // sound: a struck drum rings in one colour, a cymbal does not.
        tone = mix(tone, vec3(0.35, 0.75, 1.0), clamp(uTonality, 0.0, 1.0) * 0.35);

        float fronts = pow(clamp(vSlope * 15.0, 0.0, 1.0), 0.8);
        float body = pow(clamp(abs(vHeight) * 1.2, 0.0, 1.0), 1.5) * 0.22;
        float facing = pow(clamp(abs(vNormalView.z), 0.0, 1.0), 1.5);

        // The facing term is mixed in rather than multiplied. Multiplied, a
        // wavefront seen edge-on would vanish exactly when it is steepest, which
        // is precisely when it is worth seeing.
        float shade = mix(1.0, 0.35 + facing * 0.65, 0.6);

        // The rim is drawn whether or not anything is moving.
        //
        // A membrane at rest is mathematically black — zero displacement
        // everywhere, so every term above vanishes — and a mode that renders an
        // empty screen during a quiet passage reads as broken rather than as
        // quiet. The rim costs nothing and makes the drumhead an object that is
        // sitting still, which is what it actually is.
        float rim = smoothstep(0.90, 0.958, radius) * (1.0 - smoothstep(0.958, 0.99, radius));

        vec3 color = tone * (fronts + body) * shade * disc + vec3(0.05, 0.11, 0.17) * rim;
        gl_FragColor = vec4(color * uBrightness, 1.0);
    }
`;
