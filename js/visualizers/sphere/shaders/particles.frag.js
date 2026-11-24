/** Renders each point as a soft round dot, discarding the square corners. */
export const particlesFragmentShader = /* glsl */ `
    uniform float uBrightness;
    varying vec3 vColor;

    void main() {
        vec2 coord = gl_PointCoord - vec2(0.5);
        float dist = length(coord);
        if (dist > 0.5) discard;
        gl_FragColor = vec4(vColor, uBrightness);
    }
`;
