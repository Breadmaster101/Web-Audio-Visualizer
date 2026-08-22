/** Tunables shared across modules. Slider-backed values are mutated at runtime. */
export const CONFIG = {
    maxParticles: 1000000,
    initialParticles: 250000,
    particleSize: 0.08,
    bloomStrength: 1.8,
    bloomRadius: 0.5,
    bloomThreshold: 0.1,
    sensitivity: 0.5,
    brightness: 0.8
};

/** Analyser bin ranges (fftSize 2048) carved into the three reactive bands. */
export const BANDS = {
    bass: [1, 7],
    mid: [7, 93],
    treble: [93, 400]
};
