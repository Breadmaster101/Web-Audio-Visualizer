# Web-Audio-Visualizer

A GPU particle visualizer that reacts to system audio or microphone input, built
on Three.js with a custom point shader and bloom post-processing.

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
  controls.css          Control panel, sliders, fullscreen button
js/
  main.js               Entry point: builds the app and wires UI to it
  config.js             CONFIG tunables and analyser BANDS
  Visualizer.js         Orchestrator + frame loop
  audio/
    AudioSource.js      AudioContext, stream capture (system / mic)
    AudioAnalyser.js    Energy -> auto-gain -> beat detect -> smoothing
  visuals/
    Stage.js            Scene, camera, renderer, orbit controls, bloom
    ParticleSystem.js   Point cloud geometry + shader material
    CameraShake.js      Beat-driven camera jitter
  shaders/
    particles.vert.js   Vertex shader (audio-driven displacement)
    particles.frag.js   Fragment shader (round point sprites)
    noise.glsl.js       Reusable 3D simplex noise chunk
  ui/
    StartOverlay.js     Source-picker screen
    ControlPanel.js     Slider bindings + fullscreen
    IdleWatcher.js      Fades chrome when the pointer rests
```

## Adding features

- **New slider** — add the markup to `#controls-box` in `index.html` following the
  `inp-*` / `val-*` id convention, then one `this.bind(...)` line in
  `ui/ControlPanel.js`.
- **New shader effect** — edit `shaders/particles.vert.js`; import
  `simplexNoise3D` from `noise.glsl.js` if you need noise. Add any new uniform in
  `ParticleSystem.createMaterial()`.
- **New reactive band** — add bin ranges to `BANDS` in `config.js` and read them
  in `AudioAnalyser.update()`.
