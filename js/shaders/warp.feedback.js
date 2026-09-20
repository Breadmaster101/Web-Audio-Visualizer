/**
 * Warp mode, feedback pass: one step of the tunnel.
 *
 * Every frame the previous frame is read back, pulled toward the edges,
 * turned a little, dimmed a little and shifted a little in hue, and the
 * current spectrum is stamped on top of it as a ring around the centre. The
 * ring the music drew a moment ago is therefore still on screen, further out
 * and fainter, and the ring before that behind it, so the picture is a
 * history of the last few seconds flying past rather than a meter of now.
 *
 * The warp is done in polar coordinates around the screen centre. Zoom moves
 * content outward along its own radius, rotation turns it, and the wobble term
 * bends the rotation by radius so straight rays twist into spirals. All three
 * amounts are per-frame quantities that the mode has already scaled by dt.
 */
export const warpFeedbackShader = /* glsl */ `
    uniform sampler2D uPrev;
    uniform sampler2D uDetail;
    uniform vec2 uTexel;
    uniform float uAspect;
    uniform float uTime;

    uniform float uZoom;
    uniform float uPush;
    uniform float uRotate;
    uniform float uWobble;
    uniform float uDecay;
    uniform float uHueShift;

    uniform float uBass;
    uniform float uBeat;
    uniform float uPulse;
    uniform float uHue;
    uniform float uGain;
    uniform float uRingRadius;

    varying vec2 vUv;

    const float TAU = 6.28318530718;

    /** Screen-centred coordinates: y spans -1..1, x spans -aspect..aspect. */
    vec2 toCentered(vec2 uv) {
        return (uv - 0.5) * 2.0 * vec2(uAspect, 1.0);
    }

    vec2 toUv(vec2 p) {
        return p / (2.0 * vec2(uAspect, 1.0)) + 0.5;
    }

    /** Rotate hue in YIQ, which keeps luminance where it was. */
    vec3 hueRotate(vec3 color, float angle) {
        const mat3 toYIQ = mat3(
            0.299,  0.587,  0.114,
            0.596, -0.274, -0.322,
            0.211, -0.523,  0.312);
        const mat3 fromYIQ = mat3(
            1.0,  0.956,  0.621,
            1.0, -0.272, -0.647,
            1.0, -1.106,  1.703);
        vec3 yiq = color * toYIQ;
        float c = cos(angle);
        float s = sin(angle);
        yiq.yz = mat2(c, -s, s, c) * yiq.yz;
        return max(yiq * fromYIQ, 0.0);
    }

    /** A cosine palette: saturated, and it loops, so hue can drift forever. */
    vec3 palette(float t) {
        return 0.5 + 0.5 * cos(TAU * (t + vec3(0.0, 0.33, 0.67)));
    }

    /** The previous frame, read a pixel wide so the trails soften as they age. */
    vec3 previous(vec2 uv) {
        vec3 sum = texture2D(uPrev, uv + vec2( uTexel.x,  uTexel.y)).rgb
                 + texture2D(uPrev, uv + vec2(-uTexel.x,  uTexel.y)).rgb
                 + texture2D(uPrev, uv + vec2( uTexel.x, -uTexel.y)).rgb
                 + texture2D(uPrev, uv + vec2(-uTexel.x, -uTexel.y)).rgb;
        return sum * 0.25;
    }

    void main() {
        vec2 p = toCentered(vUv);
        float r = length(p);
        float angle = atan(p.y, p.x);

        // --- Feedback: where this pixel's content was last frame ----------
        // Content flows outward, so the source is a little further in, and it
        // turns, so the source is a little further round. The wobble bends the
        // turn by radius and time, which is what twists rays into spirals.
        //
        // Zoom alone scales about the centre, and the centre itself would
        // never move: whatever the beat flashes there would pile up into a
        // disc. The push is a fixed step outward that drains it, so a flash
        // leaves as an expanding shell. Past the centre the radius goes
        // negative, which just reads the opposite side.
        float srcR = abs(r * (1.0 - uZoom) - uPush);
        float srcA = angle - uRotate - uWobble * sin(r * 5.0 - uTime * 1.7);
        vec2 srcUv = toUv(srcR * vec2(cos(srcA), sin(srcA)));

        // Anything that would have come from off-screen fades instead of
        // smearing the clamped edge pixel across the frame.
        vec2 edge = smoothstep(0.0, 0.02, srcUv) * smoothstep(1.0, 0.98, srcUv);
        float inside = edge.x * edge.y;

        vec3 feedback = hueRotate(previous(srcUv), uHueShift) * uDecay * inside;
        feedback = min(feedback, vec3(6.0));

        // --- The ring: this frame's spectrum around the centre -----------
        // Low bands at the top, high at the bottom, mirrored left and right.
        float t = fract((angle + TAU * 0.25) / TAU + 0.5) - 0.5;
        float band = abs(t) * 2.0;
        float v = texture2D(uDetail, vec2(band, 0.5)).r;

        float base = uRingRadius * (1.0 + 0.12 * uBass);
        float ringR = base + v * 0.22;
        float thickness = 0.010 + v * 0.018;
        float d = r - ringR;
        float line = exp(-d * d / (thickness * thickness));
        // The bar between the resting ring and the displaced one, so a loud
        // band reads as a spike rather than a dot that moved.
        float bar = step(base, r) * step(r, ringR) * 0.35;
        float ring = (line * (0.25 + v * 1.4) + bar * v);

        vec3 ringColor = palette(uHue + band * 0.28 + v * 0.08);

        // --- The core: the beat, flashed at the centre --------------------
        // Kept small and soft: the flow carries it outward, so a hit becomes
        // a ripple crossing the ring rather than a disc sitting inside it.
        float core = uBeat * 0.6 * exp(-r * r * 70.0)
                   + uPulse * 0.10 * exp(-r * r * 16.0);
        vec3 coreColor = palette(uHue + 0.5);

        vec3 color = feedback + (ring * ringColor + core * coreColor) * uGain;
        gl_FragColor = vec4(color, 1.0);
    }
`;
