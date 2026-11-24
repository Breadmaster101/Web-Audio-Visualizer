/**
 * Chladni, grain pass: how much sand covers each pixel.
 *
 * Drawn additively into its own float target rather than to the screen, so the
 * pile-up on a line can be measured and then lit, instead of adding up to white
 * before the music has had any say in it.
 */
export const chladniGrainVertexShader = /* glsl */ `
    uniform highp sampler2D uState;
    uniform highp sampler2D uField;
    uniform vec2 uExtent;
    uniform vec2 uView;
    uniform float uSize;

    varying float vAmount;

    void main() {
        vec4 state = texelFetch(uState, ivec2(position.xy), 0);
        vec3 g = texture2D(uField, (state.xy / uExtent) * 0.5 + 0.5).xyz;
        float dist = abs(g.x) / (length(g.yz) + 1e-3);

        // Loose sand lying off the lines is faint; sand on the move is not.
        float onLine = 1.0 - smoothstep(0.012, 0.05, dist);
        float flying = smoothstep(0.15, 0.7, length(state.zw)) * 0.35;
        vAmount = max(max(onLine, flying), 0.04);

        gl_Position = vec4(state.xy / uView, 0.0, 1.0);
        gl_PointSize = uSize;
    }
`;

export const chladniGrainFragmentShader = /* glsl */ `
    uniform float uGrain;
    varying float vAmount;

    void main() {
        vec2 coord = gl_PointCoord - vec2(0.5);
        if (dot(coord, coord) > 0.25) discard;
        gl_FragColor = vec4(vAmount * uGrain);
    }
`;

/**
 * Display pass: light the sand.
 *
 * Coverage is squashed to 0..1, so a line is equally solid whatever its pile,
 * and `uLight` then sets how bright solid sand is. That is the whole range the
 * kick has to work with, and it starts near the bottom of it.
 */
export const chladniDisplayShader = /* glsl */ `
    uniform sampler2D uDensity;
    uniform vec3 uColor;
    uniform float uLight;
    uniform float uHeat;

    varying vec2 vUv;

    void main() {
        float sand = 1.0 - exp(-texture2D(uDensity, vUv).r);
        vec3 color = uColor * sand * uLight;
        // The hardest-hit sand burns toward white at the thick of the line.
        color += vec3(sand * sand * sand) * uHeat;
        gl_FragColor = vec4(color, 1.0);
    }
`;
