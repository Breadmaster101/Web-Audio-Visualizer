/**
 * Terrain surface shading.
 *
 * Colour comes from frequency, brightness from height and facing. Mapping
 * colour to height instead is the obvious choice and the wrong one: it makes
 * every ridge the same colour regardless of what caused it, which throws away
 * the one thing the horizontal axis is carrying.
 *
 * Age fades toward the far edge so the horizon does not read as a hard cut, and
 * so the eye is drawn to what is happening now.
 */
export const terrainFragmentShader = /* glsl */ `
    uniform float uBrightness;
    uniform float uTilt;

    varying float vHeight;
    varying float vBand;
    varying float vAge;
    varying float vSlope;
    varying vec3 vNormalView;

    void main() {
        // Deep blue in the bass, through cyan and green, to warm white in the air
        // band. Ordered so that the palette itself tells you where you are
        // looking along the spectrum.
        vec3 low = vec3(0.15, 0.20, 0.95);
        vec3 mid = vec3(0.00, 0.95, 0.85);
        vec3 high = vec3(1.00, 0.55, 0.35);

        vec3 tone = vBand < 0.5
            ? mix(low, mid, vBand * 2.0)
            : mix(mid, high, (vBand - 0.5) * 2.0);

        // The spectral centroid warms or cools the whole surface, the same
        // neutral-at-0.5 treatment the sphere uses, so the two modes agree about
        // what a bright track looks like.
        tone += vec3(0.12, 0.02, -0.06) * (uTilt - 0.5) * 2.0;

        // Facing ratio. The terrain is lit by nothing, so this stands in for
        // shading — slopes turned away from the camera fall off, which is what
        // makes the ridges read as three-dimensional rather than as stripes.
        float facing = clamp(abs(vNormalView.z), 0.0, 1.0);
        float shade = 0.25 + 0.75 * pow(facing, 0.6);

        float lum = clamp(vHeight, 0.0, 1.0);

        // Most of the light comes from *slope*, not height.
        //
        // Lit by height alone, the terrain is brightest exactly where it is
        // flattest — a band that stays loud becomes a glowing plateau, and the
        // ridges that carry the actual detail are lost inside it. Slope draws
        // the edges instead: the contour where one band rises above its
        // neighbours, and the step where one instant differs from the last.
        float ridge = pow(clamp(vSlope * 7.0, 0.0, 1.0), 0.75);

        // Fade with distance. Squared, because a linear fade leaves the far half
        // of the strip an even grey haze with no depth in it.
        float depth = 1.0 - vAge * vAge;

        vec3 color = tone * (0.02 + lum * 0.34 + ridge * 0.62) * shade * depth;
        gl_FragColor = vec4(color * uBrightness, 1.0);
    }
`;
