/** Every tunable of the Sphere visualizer. */
export const CONFIG = {
    particles: 1000000,
    particleSize: 0.08,
    brightness: 0.10,
    cameraPosition: [0, 2, 8],
    bloomStrength: 1.8,
    bloomRadius: 0.5,
    bloomThreshold: 0.1,
    /** Scales the finished output, outside the auto-gain loop. */
    trim: 1.0,
    /**
     * How much of the music's own loudness variation reaches the visuals.
     * 0 = every passage is levelled to fill the range; 1 = a quiet verse stays
     * visibly quieter than the chorus around it.
     */
    loudnessFollow: 0.6,
    /** Scales the beat-driven camera jitter. 0 holds the camera perfectly still. */
    shake: 1.0,
    autoRotate: true,
    autoRotateSpeed: 0.5
};

/**
 * Perceptual bands, in Hz rather than bin indices — bin numbers are only
 * meaningful for one fftSize/sampleRate pair, and system capture and mic
 * capture frequently run at different rates.
 */
export const BANDS = {
    sub: [20, 60],
    bass: [60, 160],
    lowMid: [160, 400],
    mid: [400, 1200],
    highMid: [1200, 3500],
    presence: [3500, 8000],
    air: [8000, 16000]
};

/** How the perceptual bands fold down into the three values the shader takes. */
export const BAND_GROUPS = {
    bass: { sub: 0.55, bass: 0.45 },
    mid: { lowMid: 0.28, mid: 0.40, highMid: 0.32 },
    treble: { presence: 0.6, air: 0.4 }
};

/** Analysis engine constants. All time constants are in seconds. */
export const ANALYSIS = {
    fftSize: 4096,

    // --- Onset detection -----------------------------------------------
    /** Log-spaced bands the spectral-flux detector runs on. */
    fluxBands: 28,
    fluxRange: [40, 15000],
    /** Per-band dB rise is clipped here so one exploding band can't fake a hit. */
    fluxClipDb: 7,
    /**
     * Flux is a per-frame difference, so its magnitude scales with the frame
     * interval — consecutive FFT windows overlap more at a high refresh rate
     * and the measured rise shrinks. Rescaling to a 60fps reference keeps the
     * absolute constants below meaning the same thing on any display.
     */
    referenceFps: 60,
    fluxScaleRange: [0.25, 4],
    fluxHistory: 140,
    fluxThresholdK: 2.0,
    /** A hit must also be this many times the running mean, not just above it. */
    fluxRatio: 1.35,
    fluxFloor: 0.004,
    strengthScale: 2.5,
    minOnsetGap: 0.09,
    /**
     * A frame delta above this means the loop stalled — a background tab, a
     * garbage collection pause, a window drag. The spectrum jumped a long way
     * in one step, so the flux for that frame is meaningless and would both
     * fire a false onset and poison the adaptive threshold for seconds after.
     */
    stallSeconds: 0.1,

    // --- Per-band auto calibration (dB domain) --------------------------
    floorFallTau: 0.35,
    floorRiseTau: 9.0,
    ceilRiseTau: 0.07,
    ceilFallTau: 2.5,
    minRangeDb: 15,
    /** Each band's exponent is bent until its average output lands here. */
    targetLevel: 0.5,
    meanTau: 3.0,
    gammaTau: 2.5,
    gammaRange: [0.5, 3.4],

    // --- Silence gate ---------------------------------------------------
    /**
     * Anything this far below the loudest recent moment counts as silence.
     * Generous on purpose: 40dB between a hit and the gap after it is ordinary
     * musical dynamics, and gating that would starve onset detection of exactly
     * the quiet passages it needs to hear.
     */
    gateRangeDb: 45,
    /** Loudness envelope feeding the gate. Slow release, so gaps don't trip it. */
    loudnessAttackTau: 0.05,
    loudnessReleaseTau: 1.0,
    hardFloorDb: -120,
    gateFallDbPerSec: 0.5,
    /**
     * The gate opens quickly but closes slowly. It is meant to detect that the
     * music has *stopped*, not to follow its level — closing at the speed of
     * the signal would ride the gaps between hits and amplitude-modulate
     * everything downstream.
     */
    gateOpenTau: 0.15,
    gateCloseTau: 1.2,
    /**
     * A purely relative gate cannot recognise silence, because a steady noise
     * floor sits exactly at its own ceiling and so always reads as "playing".
     * That matters: the usual way to start the app is to grant capture and
     * *then* go start the music, and without an absolute backstop the engine
     * spends that gap calibrating itself to line noise. Set conservatively —
     * roughly 30dB below anything audible.
     */
    absoluteGateDb: -105,
    /** Seconds of audio before the band calibration is trusted. */
    settleSeconds: 6,
    /** Crest factor, in dB, that reads as fully dynamic material. */
    crestRangeDb: 24,

    // --- Master auto-sensitivity ----------------------------------------
    /** Average band level, as the shader sees it, that the loop holds. */
    agcTarget: 0.42,
    agcTau: 2.5,
    /**
     * Integrator rates, in gain fraction per second per unit of error. Raising
     * is much slower than lowering: the per-band calibration already handles
     * fast level changes, so the master loop only ever needs to make a small
     * slow correction, and every failure mode of an integrator like this ends
     * in it being too loud. The range is deliberately narrow for the same
     * reason — even a total misbehaviour cannot get far.
     */
    agcRiseRate: 0.25,
    agcFallRate: 0.9,
    agcRange: [0.6, 2.2],
    /** Below this delivered level, raising gain is assumed to be windup. */
    agcFloor: 0.12,
    /**
     * How far the loudness envelope may sit below its own recent ceiling before
     * gain rises are frozen. A large gap means the level just dropped — a new,
     * quieter track, or a quiet passage — and the per-band calibration has not
     * caught up. Turning the gain up into that is the exact failure the user
     * sees as the visualiser going wild at the start of a quiet song.
     */
    staleCeilingDb: 12,

    // --- Tempo ----------------------------------------------------------
    envelopeRate: 50,
    envelopeSeconds: 8,
    /** Half-width of the blur applied before autocorrelation, in envelope samples. */
    envelopeBlur: 2,
    bpmRange: [62, 190],
    /** Log-normal prior that resolves half/double-time autocorrelation peaks. */
    bpmPrior: 120,
    bpmPriorWidth: 0.85,
    analysisInterval: 0.4,
    phaseLock: 0.22,
    periodLock: 0.35,
    pulseSharpness: 3.0,
    minConfidence: 0.25,
    /** Successive estimates within this fraction count as agreeing. */
    tempoAgreement: 0.05,
    agreementNeeded: 4,
    /**
     * Calibration windows at loudnessFollow = 1.
     *
     * Every window in the engine is short by default, which is what makes a
     * quiet passage refill the whole range within a few seconds of arriving —
     * good for comparing two tracks, but it flattens the arrangement of any
     * single one. Stretching them past the length of a chorus lets a section be
     * measured against the rest of the song instead of against itself. Ceiling
     * *attack* stays fast either way: a new peak should still register
     * instantly, it just should not be forgotten two seconds later.
     */
    followCeilFallTau: 45,
    followFloorRiseTau: 60,
    followMeanTau: 45,
    followAgcTau: 25,

    // --- Output smoothing ------------------------------------------------
    attack: { bass: 0.028, mid: 0.040, treble: 0.018 },
    releaseFast: 0.11,
    releaseSlow: 0.38,
    /** Release time as a fraction of one beat, once the tempo is known. */
    releaseBeats: 0.28,
    /**
     * Output soft-knee limiter. The ceiling is set close to 1.0 on purpose:
     * the shader's displacement amounts were tuned against a signal that could
     * not exceed 1, and letting auto-gain push well past that would change how
     * the visualiser looks, not just how reliably it reacts.
     */
    limitKnee: 0.75,
    limitCeiling: 1.10,
    /** Onsets/sec that counts as fully percussive material. */
    motionRate: 3.5
};
