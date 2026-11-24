/** Every tunable of the Chladni engine. Drawing constants are in render/. */
export const CONFIG = {
    brightness: 1,
    bloomRadius: 0.5,
    bloomThreshold: 0.1,
    /** Scales the kick and the sustained bass. */
    trim: 1.0
};

/** Analysis engine constants. All time constants are in seconds. */
export const ANALYSIS = {
    fftSize: 4096,

    /** Frame deltas above this are a stalled loop, and are clamped to it. */
    stallSeconds: 0.1,

    // --- Chroma (pitch classes) -----------------------------------------
    /**
     * MIDI note range folded onto the twelve pitch classes. The bottom is set
     * by FFT resolution rather than by taste: a 4096-point transform at 48kHz
     * resolves ~11.7Hz, and a semitone is narrower than that below roughly
     * C3. Low notes still register through their harmonics, which land in the
     * part of the spectrum that *is* resolved.
     */
    chromaRange: [48, 96],
    /** Bins this far in cents from a semitone centre stop contributing to it. */
    chromaSpreadCents: 100,
    /**
     * Half-width, in bins, of the window a bin is compared against to decide
     * whether it is a peak or part of the background.
     *
     * This is what makes the whole thing work. Summing raw energy per pitch
     * class gives an almost flat vector for any real mix, because a snare or a
     * cymbal puts broadband energy into every class at once and there are far
     * more noise bins than tonal ones. Measuring each bin against its own
     * neighbourhood instead means flat regions contribute nothing however loud
     * they are, and only actual partials count.
     */
    chromaBackgroundBins: 22,
    /** dB a bin must stand above its neighbourhood before it counts at all. */
    chromaSalienceDb: 2.5,
    /**
     * dB of excess at which a bin counts as fully tonal.
     *
     * Salience gates a bin's contribution; it does not replace it. The bin still
     * contributes its actual magnitude. Letting the excess itself be the
     * contribution sounds reasonable and is badly wrong: against a quiet
     * background every partial stands out by a hundred decibels or more
     * regardless of how loud it is, so a sixth harmonic forty decibels down
     * counts for as much as the fundamental. Pitch classes that merely appear
     * in more harmonic positions than others then win, and a C major triad
     * reads as B.
     */
    chromaSalienceKneeDb: 9,
    /**
     * Octave weighting: partials are scaled by a Gaussian on log frequency,
     * centred here and this many octaves wide.
     *
     * Harmonics are the standing problem with chroma taken from audio. A note's
     * third harmonic lands on its fifth and its fifth harmonic on its major
     * third, so a single sustained C deposits real energy on G and E, and a C
     * major triad can end up with G scoring above C. Weighting toward the
     * register where the notes themselves are played, and away from the one
     * where only their upper harmonics reach, is the cheapest correction that
     * does not involve guessing at which partials belong to which note.
     */
    chromaCentreHz: 330,
    chromaOctaveWidth: 1.15,
    /**
     * How much of a pitch class is subtracted from the classes its harmonics
     * fall on, before the key is estimated.
     *
     * Octave weighting reduces harmonic leakage; it cannot remove it, because a
     * note's third harmonic is only an octave and a fifth above the note itself
     * and no register weighting separates those. Subtracting the leakage
     * directly does. Measured against a set of triads with known answers, this
     * takes key identification from 4/9 to 9/9, and the result is stable
     * anywhere between about 0.3 and 0.5.
     *
     * It is applied to the key estimate only. The chords are read from measured
     * energy, because an open fifth really does have a fifth sounding in it and
     * a figure that subtracted one would be showing an inference rather than
     * the music.
     */
    chromaHarmonicSuppression: 0.4,
    /**
     * Everything this far below the loudest pitch class is treated as leakage.
     * Lower than it would need to be without the salience step, which has
     * already removed most of what this used to be there to suppress.
     */
    chromaFloor: 0.18,
    chromaTau: 0.10,
    /** Key estimates are averaged over musical time, not frames. */
    chromaKeyTau: 3.0,

    // --- Loudness -------------------------------------------------------
    /** Log-spaced, A-weighted bands that loudness is averaged over. */
    loudnessBands: 28,
    loudnessRange: [40, 15000],

    // --- Silence gate ---------------------------------------------------
    /**
     * Anything this far below the loudest recent moment counts as silence.
     * Generous on purpose: 40dB between a hit and the gap after it is ordinary
     * musical dynamics, and gating that would lose the quiet passages.
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
};
