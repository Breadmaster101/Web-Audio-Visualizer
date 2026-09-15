# Web-Audio-Visualizer

A GPU audio visualizer that reacts to system audio or microphone input, built on
Three.js with custom shaders and bloom post-processing.

Three visualisers share one analysis engine. They are not variations on a theme
&mdash; each is built on a different part of what the engine produces, which is
why they behave differently rather than merely looking different:

| | | |
|---|---|---|
| **Sphere** | the spectrum, now | A quarter-million points displaced by four audio-driven fields. No memory: every frame is drawn from that frame's audio. |
| **Terrain** | the spectrum, over time | A scrolling heightfield with frequency on one axis and *time* on the other. The horizon is about six seconds ago. |
| **Membrane** | the hits | A wave equation on a circular drumhead, struck by every detected onset. Ripples genuinely interfere and the rim genuinely reflects. |

## Running

The app uses ES modules and an import map, so it must be served over HTTP —
opening `index.html` from the filesystem will not work.

```bash
python -m http.server 8123
```

Then open <http://localhost:8123>.

## Project structure

```
index.html              Markup only — links stylesheets and boots js/main.js
css/
  base.css              Variables, body, canvas, shared button + idle-fade rules
  overlay.css           Start screen
  hud.css               Edge HUD: control column and telemetry panel
js/
  main.js               Entry point: builds the app and wires UI to it
  config.js             CONFIG tunables, BANDS in Hz, ANALYSIS constants
  Visualizer.js         Orchestrator, mode switching + frame loop
  audio/
    AudioSource.js      AudioContext, stream capture (system / mic)
    AudioAnalyser.js    Analysis engine: runs the chain below, owns the output
    Spectrum.js         FFT frame -> perceptual bands, detail bands, descriptors
    BandNormalizer.js   Per-band floor/ceiling tracking + exponent shaping
    OnsetDetector.js    Spectral flux with an adaptive threshold
    TempoTracker.js     Autocorrelation tempo estimate + phase-locked beat grid
    Chroma.js           Pitch classes from spectral salience + key estimation
    dsp.js              Shared helpers (time-constant smoothing, limiter, curves)
  visuals/
    Stage.js            Scene, camera, renderer, orbit controls, bloom
    VisualMode.js       The interface every visualiser implements
    modes.js            The registry: one row per visualiser
    ParticleSystem.js   Sphere mode: point cloud + shader material
    SpectralTerrain.js  Terrain mode: ring-buffer history as a heightfield
    Membrane.js         Membrane mode: wave equation on ping-pong render targets
    CameraShake.js      Beat-driven camera jitter (shared)
  shaders/
    particles.vert.js   Sphere vertex shader (audio-driven displacement)
    particles.frag.js   Sphere fragment shader (round point sprites)
    terrain.vert.js     Terrain vertex shader (samples the history texture)
    terrain.frag.js     Terrain fragment shader (slope-lit, frequency-coloured)
    membrane.sim.js     One timestep of the 2D wave equation
    membrane.vert.js    Membrane surface displacement + normals
    membrane.frag.js    Membrane shading (wavefronts from slope)
    noise.glsl.js       Reusable 3D simplex noise chunk
  ui/
    StartOverlay.js     Source-picker screen
    ControlPanel.js     Visualiser picker, sliders, toggles, source, persistence
    EngineReadout.js    Live telemetry panel
    Settings.js         localStorage persistence for control values
    Shortcuts.js        Keyboard bindings
    IdleWatcher.js      Fades chrome when the pointer rests
```

## The interface

An edge HUD rather than a floating panel: controls and their documentation in a
scrolling column flush against the left edge, live engine telemetry bottom
right. Both sit on a flat scrim with a single hairline rule marking the inner
edge, which keeps them legible over a bright particle field without becoming
boxes floating on top of it.

Every control carries a plain-language description of what it does, and the
**How it works** section at the foot of the column holds the technical detail:
the signal chain, the auto-sensitivity loop, and which audio value drives which
visual axis in each mode.

The visualiser picker sits at the top of the column as a list rather than a
segmented control. Names alone would fit across 300px at this count, but each
one needs a line of explanation to be worth anything &mdash; these modes react to
genuinely different parts of the analysis, and "Terrain" tells you nothing on its
own. Rows give that line somewhere to live, and leave room for the next one.

Controls a mode does not use are **hidden rather than disabled**. A slider that
cannot affect anything is furniture, not information. The three reactivity
controls are never hidden, because they act on the shared analysis engine and so
apply everywhere.

| Key | |
|-----|---|
| `1`&ndash;`3` | Pick a visualiser directly |
| `V` | Step through the visualisers (`Shift+V` goes back) |
| `H` | Hide or show all interface |
| `F` | Fullscreen |
| `A` | Toggle auto sensitivity |
| `R` | Reset every control to its default |
| `?` | Open or close *How it works* |

Control values are saved to `localStorage` and restored on reload; `R` clears
them. The chrome fades after six seconds of no input, but never while the
pointer is over a panel, a control is being dragged, or focus is inside the
HUD.

## The analysis engine

The visualiser calibrates itself to whatever is playing, so no genre needs its
own sensitivity setting. Each frame runs this chain:

1. **Spectrum** — the FFT frame is folded onto seven perceptual bands and ~28
   log-spaced bands, resolved from the live `sampleRate` rather than fixed bin
   indices. An A-weighting tilt makes band energy track perceived loudness.
2. **Per-band calibration** — every band tracks its own noise floor and recent
   ceiling in dB and normalises against that live window, then bends its output
   through an exponent until the band's *average* lands on a target level. This
   is what stops a brick-walled master from sitting pinned at 1.0 and a sparse
   acoustic track from never leaving the floor.
3. **Detail bands** — a second, much finer log-spaced set of 72 bands from 30Hz
   to 16kHz, calibrated the same way, for the modes that draw the spectrum
   itself rather than a three-value fold of it. It is kept separate from the
   onset band set because the two want opposite things: onset detection wants
   few wide bands so that one transient lifts most of them at once, and a
   picture of the spectrum wants as many as the transform will support.
4. **Chroma and key** — the spectrum folded onto the twelve pitch classes, then
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
5. **Onset detection** — spectral flux summed across all log bands, against a
   threshold built from the running mean and deviation. Because it watches the
   whole spectrum rather than the low end, it fires on snares, piano attacks and
   plucked strings, not just kick drums.
6. **Tempo** — the onset signal is resampled to a fixed rate and autocorrelated.
   A log-normal prior around 120 BPM resolves half/double-time ambiguity,
   parabolic interpolation gives sub-BPM accuracy, and agreement across
   successive estimates rejects the chance correlations that noise produces. The
   result drives a phase-locked beat grid, so the visuals keep moving in time
   through breakdowns and held chords where there is nothing to react to.
7. **Auto sensitivity** — a slow integrator holds the average level *the shader
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

   **Trim** scales the finished output and sits *outside* that loop. A control
   folded in before the measurement would be regulated straight back out again
   within seconds — the loop holds what it can see. It scales limiter headroom
   too, so turning it up genuinely gets wilder rather than just hitting the
   ceiling sooner.

8. **Dynamics** — how much of the music's own loudness variation survives all of
   the above. Levelling is what lets any genre work, but applied to a single
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
9. **Smoothing** — attack and release are time constants in seconds, not
   per-frame constants, so the response is identical at 30fps and 144fps. The
   release scales with the detected beat period.

Alongside the three bands the engine exposes `beat` (onset envelope), `pulse`
(tempo grid), `tilt` (spectral centroid), `crest` (dynamic range), `level`,
`flatness` (tonal against noisy) and a short `profile` string. For the modes
that need more than a three-value fold it also exposes `detail` (72 calibrated
bands), `chroma` (the pitch-class vector, key and tonality) and the beat grid's
`beatIndex` / `beatFired` / `beatPeriod`.

`Key` reads *Atonal* when no key stands clear of the alternatives, which is the
honest answer for percussion, noise and a good deal of electronic music. The
decision is deliberately slow: the correlations are averaged over several
seconds before a winner is taken, because taking the argmax per frame and
smoothing *that* flickers between a key and its relative major or minor on every
passing chord.

## Adding features

- **A new visualiser** — implement the `VisualMode` interface in
  `visuals/`, then add one row to `MODES` in `visuals/modes.js`. Nothing else
  needs touching: the picker, the number-key shortcuts, the control-column
  filtering and the saved preference all read from that list. The row declares
  the mode's camera framing, whether it permits auto-rotate, its own bloom
  exposure, and which sliders apply to it.

  A mode owns whatever it adds to the scene and must give it all back on
  `dispose()` — geometries, materials, textures and render targets all hold GPU
  memory that garbage collection cannot reach. `VisualMode.dispose()` handles
  anything added through `this.add()`; anything else is the mode's own problem
  (see `Membrane`, which owns a private scene and a pair of render targets).

- **Bloom per mode** — the Bloom slider is the user's taste and applies
  everywhere; `view.bloomScale` is the mode's own exposure and multiplies into
  it. These are genuinely different quantities. The sphere is mostly empty
  space, so bloom has little to catch and a strong setting reads as a glow
  around the points; the terrain and the membrane are filled surfaces covering
  half the screen, and the same setting turns them into one flat white sheet.

- **The three level controls** — Sensitivity is the auto-gain (or its manual
  override). Trim is a taste multiplier on top that auto-gain never fights, and
  so is only shown while Auto is on: with Auto off, Sensitivity does the same
  job directly and a second gain would just be redundant. Dynamics decides how
  much of the music's own loud/quiet variation gets through, rather than being
  levelled away.
- **New slider** — add a `.ctl` block to `#hud-controls` in `index.html` following
  the `inp-*` / `val-*` / `ctl-*` id convention, including a `.ctl-desc`
  explaining what it does, then one entry in the `SLIDERS` table in
  `ui/ControlPanel.js`. The `value` attribute in the markup is the single source
  of truth for the default, so reset and persistence pick it up with no further
  work.

  A slider stays hidden until some mode names it in `controls`, or it is listed
  in `ENGINE_CONTROLS` as acting on the shared analysis engine. `apply` reaches
  the live mode through `ctx.visualizer.mode`, resolved at call time rather than
  captured — the mode object is replaced on every switch, and a captured
  reference would keep pushing values into a disposed one.
- **New telemetry row** — add a `.tel-row` to `#hud-telemetry`, then read it in
  `EngineReadout.update()`. Numeric text refreshes a few times a second rather
  than every frame; anything graphical can update per-frame in `paintBands()`.
- **New shortcut** — one `case` in `ui/Shortcuts.js`, and a row in the keyboard
  table in the *How it works* section so it stays discoverable.
- **New shader effect** — edit the relevant `shaders/*.vert.js`; import
  `simplexNoise3D` from `noise.glsl.js` if you need noise. Add any new uniform
  in the owning mode's material.

  One trap worth knowing: `PlaneGeometry` negates its vertical position while
  leaving the `v` coordinate alone, so on a plane laid flat with
  `rotation.x = -PI/2`, `uv.y = 1` is the **far** edge. Terrain's time axis was
  briefly inverted by exactly this, which put the newest spectrum on the horizon
  and left the near edge showing six-second-old audio.
- **New reactive band** — add a Hz range to `BANDS` in `config.js` and give it a
  weight in `BAND_GROUPS`, or read `bands.out[...]` directly in
  `AudioAnalyser.update()`.
- **Tuning the engine** — every constant lives in `ANALYSIS` in `config.js`;
  nothing is hard-coded in the DSP modules.
