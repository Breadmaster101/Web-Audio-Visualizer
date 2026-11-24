# Web-Audio-Visualizer

A GPU audio visualizer that reacts to system audio or microphone input, built on
Three.js with custom shaders and bloom post-processing.

Three visualisers, each with its own analysis engine, tuning and renderer:

| | | |
|---|---|---|
| **Sphere** | the spectrum, now | A million points displaced by four audio-driven fields. No memory: every frame is drawn from that frame's audio. |
| **Flare** | a point of light, stared at | A blown-out core, corona, Airy rings, a squint bar and chromatic diffraction needles. Bass swells the core, treble crackles the rays, every onset flashes it. Instant attack, slow after-image release. |
| **Chladni** | the harmony, settling | A million grains of sand with momentum on a vibrating plate, gathered on its nodal lines. Chords shape the plate, the kick lights it and throws the sand. See below. |

### Chladni

Gives each part of the music one job, so you can tell what the plate is reacting
to:

| You hear | You see |
| --- | --- |
| Kick | A flash of light, and a ripple that throws the sand outward |
| Sustained bass | The glow the flash rises from |
| Chords | The shape; the sand lifts briefly as it changes |
| Lead note | A slight breath in the size of the figure |
| Key | The colour |

The shape is a sum of twelve standing waves, one per pitch class, weighted by
what is sounding, so the same chord always draws the same figure and there is no
list of figures to snap between. The sand is simulated on the GPU with momentum,
so when the chord changes the grains travel to the new lines. The kick is heard
by its own low-frequency detector. Where the kick and the chords sit in the spectrum is
learned for each song over its first several seconds, and forgotten after a gap.

## Running

The app uses ES modules and an import map, so it must be served over HTTP —
opening `index.html` from the filesystem will not work.

```bash
python -m http.server 8123
```

Then open <http://localhost:8123>.

## Project structure

```
index.html              Markup only: links stylesheets and boots js/main.js
css/                    base, start overlay, control bar
js/
  main.js               Entry point: builds the app and wires UI to it
  App.js                Shell: the captured stream, the live visualiser, the frame loop
  capture/
    AudioCapture.js     AudioContext and stream capture (system / mic), no analysis
  ui/                   Start screen, control bar, settings, shortcuts, idle fade
  visualizers/
    index.js            The registry, and the interface every visualiser implements
    sphere/             index.js, config.js, engine/, render/, shaders/
    flare/              index.js, config.js, engine/, render/, shaders/
    chladni/            index.js, config.js, engine/, render/, shaders/
```

Each visualiser folder is self-contained: no folder imports from another, and
each keeps its own copy of any DSP or shader code it uses. Changing one cannot
affect the others, and a fix to code they all carry must be made in each.

Inside a folder, `engine/` turns the stream into numbers, `render/` owns the
canvas, WebGL context, scene and bloom, `config.js` holds the tuning, and
`index.js` joins them. Only the visualiser on screen exists. Switching disposes
the old one, context included, and the new one calibrates from scratch, so it
takes a few seconds to settle.

## The interface

One bar floating above the bottom edge, on a blurred translucent background.
It holds everything you can change or read:

- **Sphere / Flare / Chladni** picks the visualiser.
- **System / Mic** picks the audio source.
- **Sens** shows the sensitivity this visualiser's engine has settled on. **Auto** switches
  to **Manual**, which shows a slider starting from that same value.
- The last button toggles fullscreen.

Everything else is fixed: the sphere draws 1,000,000 points at brightness
0.10, bloom is 1.8, and the camera rotates slowly and shakes on the beat.
Each visualiser's tuning is in its own `config.js`.

| Key | |
|-----|---|
| `1`&ndash;`3` | Pick a visualiser directly |
| `V` | Step through the visualisers (`Shift+V` goes back) |
| `H` | Hide or show the bar |
| `F` | Fullscreen |
| `A` | Toggle auto sensitivity |

The chosen visualiser is saved to `localStorage`. So is each visualiser's own
sensitivity setting, with the gain its Auto last settled on, so it starts from
there instead of climbing up from scratch.
The bar fades after six seconds of no input, but never while the pointer is
over it, a control is being dragged, or focus is inside it.

## The analysis engines

- **Sphere** and **Flare** each run the band chain below: spectrum, per-band
  calibration, onsets, tempo, auto sensitivity, dynamics, smoothing. Sphere also
  reads timbre, dynamic range and the beat pulse.
- **Chladni** runs none of that. It has a silence gate, chroma and key, and its
  own chord, lead and kick readers. They calibrate themselves, so its Auto is
  always a gain of 1.

### The band chain (Sphere, Flare)

Each engine calibrates itself to whatever is playing, so no genre needs its own
sensitivity setting. Each frame runs this chain:

1. **Spectrum** — the FFT frame is folded onto seven perceptual bands and ~28
   log-spaced bands, resolved from the live `sampleRate` rather than fixed bin
   indices. An A-weighting tilt makes band energy track perceived loudness.
2. **Per-band calibration** — every band tracks its own noise floor and recent
   ceiling in dB and normalises against that live window, then bends its output
   through an exponent until the band's *average* lands on a target level. This
   is what stops a brick-walled master from sitting pinned at 1.0 and a sparse
   acoustic track from never leaving the floor.
3. **Onset detection** — spectral flux summed across all log bands, against a
   threshold built from the running mean and deviation. Because it watches the
   whole spectrum rather than the low end, it fires on snares, piano attacks and
   plucked strings, not just kick drums.
4. **Tempo** — the onset signal is resampled to a fixed rate and autocorrelated.
   A log-normal prior around 120 BPM resolves half/double-time ambiguity,
   parabolic interpolation gives sub-BPM accuracy, and agreement across
   successive estimates rejects the chance correlations that noise produces. The
   result drives a phase-locked beat grid, so the visuals keep moving in time
   through breakdowns and held chords where there is nothing to react to.
5. **Auto sensitivity** — a slow integrator holds the average level *the shader
   actually receives* at a target, so a quiet stream and a loud one look the
   same. The Auto button hands this to the slider when you want manual control;
   switching to manual adopts the current automatic value, so it never jumps.

   The loop is deliberately lopsided. Gain falls quickly but rises slowly, and
   only rises at all once the band calibration has settled, the signal is
   actually present, and the loudness envelope is near its own ceiling. Every
   way an integrator like this fails ends with it too loud, and the bands read
   low for plenty of reasons gain cannot fix — silence before the music starts,
   a track change the calibration has not caught up with. Integrating through
   those is what used to make the visualiser go wild at the start of a quiet
   song: the correct level would arrive multiplied by whatever the loop had
   wound itself up to in the meantime.

   **Trim** (fixed at 1.0) scales the finished output and sits *outside* that loop. A control
   folded in before the measurement would be regulated straight back out again
   within seconds — the loop holds what it can see. It scales limiter headroom
   too, so turning it up genuinely gets wilder rather than just hitting the
   ceiling sooner.

6. **Dynamics** (fixed at 0.6) — how much of the music's own loudness variation
   survives all of the above. Levelling is what lets any genre work, but applied to a single
   song it also flattens the arrangement: every calibration window is a few
   seconds long, so a quiet verse refills the whole range shortly after it
   starts and ends up looking like the chorus.

   The control stretches those windows — ceiling decay, floor recovery, the
   per-band average, and the auto-gain measurement — from seconds to most of a
   minute, and fades the per-band exponent toward neutral, since re-centring a
   band is precisely what erases a quiet passage. A section is then measured
   against the rest of the song rather than against itself. Ceiling *attack*
   stays fast throughout, so transients are never clipped off the top.

   At 0 every passage is levelled, as before. At 1 a loud section reads about
   2.2x a quiet one. Different songs still level out either way — it just takes
   about 20s at 0.3 and 60-90s at 1.0, so the visualiser visibly notices a
   quieter track before settling into it. What you trade away as it rises is the
   correction that keeps a heavily compressed master from sitting high.
7. **Smoothing** — attack and release are time constants in seconds, not
   per-frame constants, so the response is identical at 30fps and 144fps. The
   release scales with the detected beat period.

### Chroma and key (Chladni)

The spectrum folded onto the twelve pitch classes, then
correlated against the Krumhansl-Kessler profiles for all 24 keys.

What a bin contributes is not its energy but its *salience*: how far it
stands above its own spectral neighbourhood. That distinction is the
difference between this working and not working — summing raw energy gives an
almost perfectly flat vector for any real mix, because a snare or a cymbal
spreads energy across every pitch class at once and there are two orders of
magnitude more noise bins than tonal ones to spread it over.

Salience *gates* each bin; it does not replace it. Letting the excess itself
be the contribution sounds reasonable and is badly wrong: against a quiet
background every partial stands out by a hundred decibels regardless of how
loud it is, so a sixth harmonic forty decibels down counts as much as the
fundamental, and a C major triad reads as B.

Two corrections follow, both aimed at harmonic leakage — a note's third
harmonic lands on its fifth and its fifth harmonic on its major third, so a
sustained C deposits real energy on G and E. Partials are weighted toward the
register the notes are actually played in, and a share of each class is
subtracted from the two it leaks into before the key is estimated. Measured
against a set of triads with known answers, that takes identification from
4/9 to 9/9. The subtraction applies to the key estimate only.

The key decision is deliberately slow: the correlations are averaged over
several seconds before a winner is taken, because taking the argmax per frame
and smoothing *that* flickers between a key and its relative major or minor on
every passing chord.

## Adding features

- **A new visualiser**: add a folder under `visualizers/` with a class that
  implements the interface documented in `visualizers/index.js`, then add one row
  to `VISUALIZERS` there. The picker, the number keys and the saved settings all
  read that list. It does not have to use Three.js.

  `dispose()` must give everything back: geometries, materials, textures, render
  targets and the WebGL context all hold memory that garbage collection cannot
  reach, and browsers allow only a handful of contexts at once.
- **Tuning**: every engine constant lives in that visualiser's `config.js`.
- **New reactive band**: add a Hz range to `BANDS` in the visualiser's
  `config.js` and give it a weight in `BAND_GROUPS`.
- **New shader effect**: edit the visualiser's `shaders/`, and add any new uniform
  to the material in its `render/`.
- **New shortcut**: one `case` in `ui/Shortcuts.js`, and a row in the key table above.
