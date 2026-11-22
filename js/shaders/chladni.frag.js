/** Renders each grain as a soft round dot. */
export const chladniFragmentShader = /* glsl */ `
    uniform float uBrightness;
    varying vec3 vColor;
    varying float vAlpha;

    void main() {
        vec2 coord = gl_PointCoord - vec2(0.5);
        if (dot(coord, coord) > 0.25) discard;
        gl_FragColor = vec4(vColor, vAlpha * uBrightness);
    }
`;
