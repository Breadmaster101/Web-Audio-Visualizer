/**
 * One timestep of the 2D wave equation, run on a ping-pong pair of render
 * targets.
 *
 *   u(t+1) = 2u(t) - u(t-1) + c^2 * laplacian(u)
 *
 * The red channel holds the current displacement and the green channel the
 * previous one, so a single texture carries the whole state and the pair of
 * targets is all the memory the simulation needs.
 *
 * `c` is the wave speed in texels per step and must satisfy the CFL condition —
 * above about 0.7 in two dimensions the scheme stops being merely inaccurate and
 * starts amplifying its own rounding error into a full-screen explosion. The
 * caller keeps it well inside that.
 *
 * This is the only mode whose state lives on the GPU across frames. Everything
 * else in the app recomputes itself from the current audio every frame and so
 * cannot show interference, reflection or resonance; here two ripples that meet
 * genuinely add, and a rim genuinely bounces them back.
 */
export const membraneSimShader = /* glsl */ `
    uniform sampler2D uState;
    uniform vec2 uTexel;
    uniform float uSpeed;      // c^2
    uniform float uDamping;    // per-step retention, just under 1
    uniform vec4 uImpulses[4]; // xy position in 0..1, z strength, w radius

    varying vec2 vUv;

    void main() {
        // The membrane is a disc, and everything outside it is clamped to rest.
        // A square boundary would put four straight reflectors around the field
        // and the standing patterns they produce look like plumbing; a circular
        // one produces the mode shapes of an actual drumhead.
        vec2 fromCentre = vUv - 0.5;
        if (length(fromCentre) > 0.49) {
            gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
            return;
        }

        vec2 state = texture2D(uState, vUv).rg;
        float u = state.r;
        float uPrev = state.g;

        float laplacian =
              texture2D(uState, vUv + vec2(uTexel.x, 0.0)).r
            + texture2D(uState, vUv - vec2(uTexel.x, 0.0)).r
            + texture2D(uState, vUv + vec2(0.0, uTexel.y)).r
            + texture2D(uState, vUv - vec2(0.0, uTexel.y)).r
            - 4.0 * u;

        float next = (2.0 * u - uPrev + uSpeed * laplacian) * uDamping;

        // Strikes are added as displacement, not velocity, so a hit appears
        // instantly as a dome that then collapses into a ring. Injecting
        // velocity is more physical and reads as a delay, because nothing is
        // visible until the first step has run.
        for (int i = 0; i < 4; i++) {
            vec4 hit = uImpulses[i];
            float falloff = 1.0 - smoothstep(0.0, hit.w, distance(vUv, hit.xy));
            next += hit.z * falloff * falloff;
        }

        // The scheme is stable but not unconditionally so, and a stalled frame
        // or a pathological strike can still push it out of range. Clamping
        // costs nothing and turns a permanent full-screen white-out into a
        // moment of clipping.
        next = clamp(next, -4.0, 4.0);

        gl_FragColor = vec4(next, u, 0.0, 1.0);
    }
`;

/** Passthrough vertex stage for the fullscreen simulation quad. */
export const membraneSimVertexShader = /* glsl */ `
    varying vec2 vUv;

    void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
    }
`;
