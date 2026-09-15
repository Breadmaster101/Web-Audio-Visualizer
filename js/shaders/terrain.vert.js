/**
 * Spectral terrain.
 *
 * The mesh never moves. What scrolls is the read position into a ring buffer of
 * past spectra held in a texture — one row per tick, `uCursor` marking where the
 * newest row was written. Scrolling the geometry instead would mean either
 * rewriting a vertex buffer every frame or sliding the whole mesh and
 * teleporting it back, and the teleport is visible.
 *
 * The height at a vertex is one band's calibrated level at one moment in the
 * past, so the surface is a literal record of the last several seconds: a drop
 * is a cliff, a breakdown a valley, a hi-hat pattern a field of ridges.
 */
export const terrainVertexShader = /* glsl */ `
    uniform sampler2D uHistory;
    uniform float uCursor;
    uniform float uAgeSpan;
    uniform vec2 uTexel;
    uniform float uHeight;
    uniform float uBeat;

    varying float vHeight;
    varying float vBand;
    varying float vAge;
    varying float vSlope;
    varying vec3 vNormalView;

    /**
     * Height for one band at one age, where age counts backwards from 0 at the
     * newest row. The cursor is subtracted rather than added because the ring is
     * written forwards while the terrain is read backwards in time — the newest
     * row has to appear at the near edge wherever in the buffer it physically
     * sits.
     *
     * Age is clamped short of a full lap so the oldest row never wraps onto the
     * newest one. Without that the far edge shows the present, which reads as a
     * bright seam pinned to the horizon.
     */
    float sampleHistory(float band, float age) {
        float row = fract(uCursor - clamp(age, 0.0, uAgeSpan));
        return texture2D(uHistory, vec2(clamp(band, 0.0, 1.0), row)).r;
    }

    void main() {
        // uv.x is the log-frequency axis, low bands at 0.
        //
        // uv.y is the time axis, and it runs 1 at the *far* edge — PlaneGeometry
        // negates its vertical position while leaving the v coordinate alone, so
        // v increases the way the geometry recedes once the plane is laid flat.
        // Taking it the other way round puts the newest spectrum on the horizon
        // and leaves the near edge showing six-second-old audio.
        vBand = uv.x;
        vAge = uv.y * uAgeSpan;

        float h = sampleHistory(vBand, vAge);
        vHeight = h;

        // Central differences against the same field give a true surface normal.
        // Deriving one from the geometry is not an option — the geometry is flat.
        float dx = sampleHistory(vBand + uTexel.x, vAge) - sampleHistory(vBand - uTexel.x, vAge);
        float dz = sampleHistory(vBand, vAge + uTexel.y) - sampleHistory(vBand, vAge - uTexel.y);

        vec3 pos = position;
        pos.z += h * uHeight;

        // Ridges lift a little further on a hit, so a transient reads as a spine
        // thrown across the width rather than as the whole surface swelling.
        pos.z += uBeat * h * h * uHeight * 0.35;

        vSlope = length(vec2(dx, dz));

        vec3 tangentX = vec3(1.0, 0.0, dx * uHeight / uTexel.x * 0.02);
        vec3 tangentZ = vec3(0.0, 1.0, dz * uHeight / uTexel.y * 0.02);
        vNormalView = normalize(normalMatrix * normalize(cross(tangentX, tangentZ)));

        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
`;
