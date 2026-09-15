/**
 * Small shared DSP helpers.
 *
 * Every smoothing routine here is parameterised by a time constant in *seconds*
 * and takes the frame delta, so the engine behaves identically at 30fps and
 * 144fps. (The previous per-frame lerp constants made the visualiser noticeably
 * twitchier on high-refresh displays.)
 */

export const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);

export const lerp = (a, b, t) => a + (b - a) * t;

/** EMA blend factor for time constant `tau` over `dt` seconds. */
export function emaCoef(dt, tau) {
    return tau > 0 ? 1 - Math.exp(-dt / tau) : 1;
}

/** One-pole exponential move toward `target`. */
export function ema(current, target, dt, tau) {
    return current + (target - current) * emaCoef(dt, tau);
}

/** Asymmetric one-pole: separate time constants for rising and falling. */
export function envelope(current, target, dt, attackTau, releaseTau) {
    return ema(current, target, dt, target > current ? attackTau : releaseTau);
}

export const dbToLin = (db) => Math.pow(10, db / 20);

export const linToDb = (lin) => 20 * Math.log10(Math.max(lin, 1e-10));

/**
 * Soft-knee limiter. Linear below `knee`, then bends asymptotically toward
 * `ceiling`. Auto-gain deliberately lets loud moments overshoot 1.0 so hits
 * still read as hits; this keeps that overshoot from turning into the sphere
 * tearing itself apart.
 */
export function smoothLimit(x, knee = 0.85, ceiling = 1.40) {
    if (x <= knee) return x;
    const span = ceiling - knee;
    return knee + span * Math.tanh((x - knee) / span);
}

export function smoothstep(edge0, edge1, x) {
    const t = clamp((x - edge0) / (edge1 - edge0));
    return t * t * (3 - 2 * t);
}

/**
 * A-weighting curve in dB. Used as an equal-loudness tilt so that a band's
 * energy roughly tracks how loud it actually sounds, rather than how much raw
 * power it carries — without it, sub bass dominates every descriptor.
 */
export function aWeightDb(f) {
    const f2 = f * f;
    const num = 12194 * 12194 * f2 * f2;
    const den = (f2 + 20.6 * 20.6)
        * Math.sqrt((f2 + 107.7 * 107.7) * (f2 + 737.9 * 737.9))
        * (f2 + 12194 * 12194);
    return 20 * Math.log10(num / den) + 2.0;
}
