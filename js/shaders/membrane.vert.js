/**
 * Membrane surface.
 *
 * Reads the simulation's displacement field as a heightmap and derives a normal
 * from its gradient. The mesh itself is a flat disc; every bit of relief on
 * screen is the state of a simulation that has been running since the mode was
 * opened.
 */
export const membraneVertexShader = /* glsl */ `
    uniform sampler2D uState;
    uniform vec2 uTexel;
    uniform float uHeight;

    varying float vHeight;
    varying float vSlope;
    varying vec3 vNormalView;
    varying vec2 vUv;

    void main() {
        vUv = uv;

        float h = texture2D(uState, uv).r;
        vHeight = h;

        // Central differences on the same field. Sampling one texel out in each
        // direction matches the stencil the simulation itself runs on, so the
        // shading follows the wavefronts exactly rather than a blurred version
        // of them.
        float dx = texture2D(uState, uv + vec2(uTexel.x, 0.0)).r
                 - texture2D(uState, uv - vec2(uTexel.x, 0.0)).r;
        float dy = texture2D(uState, uv + vec2(0.0, uTexel.y)).r
                 - texture2D(uState, uv - vec2(0.0, uTexel.y)).r;

        vSlope = length(vec2(dx, dy));

        vec3 pos = position;
        pos.z += h * uHeight;

        vec3 tangentX = vec3(1.0, 0.0, dx * uHeight * 12.0);
        vec3 tangentY = vec3(0.0, 1.0, dy * uHeight * 12.0);
        vNormalView = normalize(normalMatrix * normalize(cross(tangentX, tangentY)));

        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
`;
