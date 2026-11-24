/**
 * Clip-space quad. Every full-screen pass draws a single full-screen rectangle and
 * ignores the camera entirely; the vertex shader's only job is to hand the
 * fragment shader a 0..1 uv.
 */
export const quadVertexShader = /* glsl */ `
    varying vec2 vUv;

    void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
    }
`;
