/**
 * Clip-space quad. Both flare passes draw a single full-screen rectangle and
 * ignore the camera entirely; the vertex shader's only job is to hand the
 * fragment shader a 0..1 uv.
 */
export const flareVertexShader = /* glsl */ `
    varying vec2 vUv;

    void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
    }
`;
