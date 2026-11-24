/**
 * Chladni, simulation pass: one step of every grain.
 *
 * Each texel is a grain, (x, y, vx, vy) in plate units, where the shorter half
 * of the screen is 1. A grain is pulled toward the nearest nodal line by a
 * spring, so when the shape changes it has to travel to the new line rather
 * than appearing on it.
 *
 * Grains are replaced at random a few times a minute. Lines that shrink away
 * leave their sand behind and lines that appear start with none, so without a
 * steady trickle of new sand the plate would slowly empty in some places and
 * clog in others. A grain stranded far from any line is replaced sooner.
 */
export const chladniSimShader = /* glsl */ `
    uniform highp sampler2D uState;
    uniform highp sampler2D uField;
    uniform vec2 uExtent;
    uniform float uDt;
    uniform uint uFrame;
    uniform bool uReset;
    /** How much the figure grew since last frame; the sand is carried with it. */
    uniform float uStretch;
    uniform float uTremble;
    /** 0..1 while the chord is changing: the sand lifts, and moves faster. */
    uniform float uLift;
    /** Kicks in flight: (distance the wavefront has reached, strength). */
    uniform vec2 uRipples[4];

    /** Pull toward the line, in radians per second, and its damping ratio. */
    const float PULL = 13.0;
    const float DAMPING = 0.75;
    /** What a full lift adds to the pull, and to the shaking. */
    const float LIFT_PULL = 10.0;
    const float LIFT_TREMBLE = 6.0;
    /** Longest distance, in plate units, the pull grows over. */
    const float REACH = 0.09;
    /** Half the spread of the grains across a line. */
    const float LINE_WIDTH = 0.008;
    /** Seconds a grain stays before it is replaced, on average. */
    const float LIFE = 9.0;
    const float STRANDED_LIFE = 1.2;
    /** Thickness and push of a kick's wavefront. */
    const float RIPPLE_WIDTH = 0.16;
    const float RIPPLE_PUSH = 9.0;

    /** Three uniform randoms in 0..1 from any three integers. */
    vec3 hash3(uvec3 v) {
        v = v * 1664525u + 1013904223u;
        v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
        v ^= v >> 16u;
        v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
        return vec3(v) / 4294967295.0;
    }

    void main() {
        ivec2 id = ivec2(gl_FragCoord.xy);
        uvec2 uid = uvec2(id);
        vec4 state = texelFetch(uState, id, 0);
        vec2 p = state.xy * uStretch;
        vec2 v = state.zw;

        vec3 fresh = hash3(uvec3(uid, uFrame));
        vec3 own = hash3(uvec3(uid, 0x7fffffffu));

        vec3 g = texture2D(uField, (p / uExtent) * 0.5 + 0.5).xyz;
        float slope = length(g.yz) + 1e-3;

        // Each grain settles at its own small offset from the line, which is
        // what gives the line its width.
        float offset = (own.x + own.y - 1.0) * 2.0 * LINE_WIDTH;
        float f = g.x - offset * slope;
        vec2 d = -f * g.yz / (slope * slope + 0.6);
        float len = length(d);
        d *= min(1.0, REACH / max(len, 1e-6));

        float pull = PULL + LIFT_PULL * uLift;
        vec2 a = pull * pull * d;

        // The wavefront shoves the sand outward, each grain a little differently.
        float r = length(p);
        vec2 angle = vec2(cos(own.z * 6.2832), sin(own.z * 6.2832));
        vec2 away = p / max(r, 1e-3) + angle * 0.5;
        for (int i = 0; i < 4; i++) {
            float x = (r - uRipples[i].x) / RIPPLE_WIDTH;
            a += away * exp(-x * x) * uRipples[i].y * RIPPLE_PUSH * (0.4 + 1.2 * own.y);
        }

        // Damping taken implicitly, so a long frame cannot blow it up.
        v = (v + a * uDt) / (1.0 + 2.0 * DAMPING * pull * uDt);
        v += (fresh.xy - 0.5) * (uTremble + LIFT_TREMBLE * uLift) * sqrt(uDt);
        p += v * uDt;

        float life = mix(LIFE, STRANDED_LIFE, smoothstep(0.02, 0.06, abs(g.x) / slope));
        bool gone = any(greaterThan(abs(p), uExtent));
        if (uReset || gone || fresh.z < uDt / life) {
            p = (hash3(uvec3(uid.yx, uFrame + 4096u)).xy * 2.0 - 1.0) * uExtent;
            v = vec2(0.0);
        }
        gl_FragColor = vec4(p, v);
    }
`;
