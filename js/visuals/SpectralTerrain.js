import * as THREE from 'three';
import { ANALYSIS, CONFIG } from '../config.js';
import { VisualMode } from './VisualMode.js';
import { terrainVertexShader } from '../shaders/terrain.vert.js';
import { terrainFragmentShader } from '../shaders/terrain.frag.js';

/** Rows of spectral history the strip holds. */
const ROWS = 320;
/** Vertices across the frequency axis. Finer than the band count, so it reads smooth. */
const COLUMNS = 128;
const WIDTH = 26;
const DEPTH = 34;
/** World units a full-scale band rises. */
const HEIGHT = 3.6;

/**
 * Rows written per beat once a tempo is known.
 *
 * Tying the scroll to the beat rather than to the clock is what makes the strip
 * legible as music: a bar is always the same length of terrain, so repeated
 * material lines up into columns you can see down. At 120 BPM this works out to
 * the same 48 rows/second the untimed fallback uses, so locking on does not
 * visibly change the speed.
 */
const ROWS_PER_BEAT = 24;
const ROWS_PER_SECOND = 48;

/**
 * Terrain mode: the spectrum over time, as landscape.
 *
 * Every other mode in the app draws the present. This one is the only thing
 * here with a memory — the far edge of the strip is where the music was six
 * seconds ago, and the whole arrangement is visible at once as shape.
 *
 * History lives in a ring-buffer texture rather than in geometry. One row is
 * written per tick and the mesh reads backwards from the write cursor, so
 * nothing is ever copied or rebuilt: the cost of a frame is one row upload of
 * `COLUMNS` bytes regardless of how much history is on screen.
 */
export class SpectralTerrain extends VisualMode {
    constructor(stage) {
        super(stage);

        this.rowCursor = 0;
        this.sinceRow = 0;
        this.speed = CONFIG.speed;

        // Single channel, 8 bits. Height only needs to resolve to about a pixel
        // of relief, and an unsigned byte texture filters linearly everywhere —
        // float textures need an extension for that which is not universal.
        this.data = new Uint8Array(COLUMNS * ROWS);
        this.texture = new THREE.DataTexture(this.data, COLUMNS, ROWS, THREE.RedFormat);
        this.texture.minFilter = THREE.LinearFilter;
        this.texture.magFilter = THREE.LinearFilter;
        this.texture.wrapS = THREE.ClampToEdgeWrapping;
        // The time axis is a ring: filtering across row 0 has to reach row N-1.
        this.texture.wrapT = THREE.RepeatWrapping;
        this.texture.needsUpdate = true;

        this.row = new Uint8Array(COLUMNS);

        this.material = new THREE.ShaderMaterial({
            uniforms: {
                uHistory: { value: this.texture },
                uCursor: { value: 0 },
                uAgeSpan: { value: (ROWS - 1) / ROWS },
                uTexel: { value: new THREE.Vector2(1 / COLUMNS, 1 / ROWS) },
                uHeight: { value: HEIGHT },
                uBeat: { value: 0 },
                uTilt: { value: 0.5 },
                uBrightness: { value: CONFIG.brightness }
            },
            vertexShader: terrainVertexShader,
            fragmentShader: terrainFragmentShader,
            side: THREE.DoubleSide
        });

        const geometry = new THREE.PlaneGeometry(WIDTH, DEPTH, COLUMNS, ROWS);
        this.mesh = new THREE.Mesh(geometry, this.material);
        // The plane is built in XY with its height along Z; lay it flat so that
        // Z becomes up and the strip runs away from the camera.
        this.mesh.rotation.x = -Math.PI / 2;
        // The near edge sits ahead of the camera rather than under it. Level
        // with it, the newest rows are a few units away and fill the bottom
        // half of the frame at an angle too steep to read anything from.
        this.mesh.position.z = -(DEPTH / 2) + 2;
        this.mesh.frustumCulled = false;
        this.add(this.mesh);
    }

    setBrightness(value) {
        this.material.uniforms.uBrightness.value = value;
    }

    setSpeed(value) {
        this.speed = value;
    }

    setAudio(metrics, dt) {
        this.material.uniforms.uBeat.value = metrics.beat;
        this.material.uniforms.uTilt.value = metrics.tilt;

        // A tempo the tracker does not actually believe in would make the strip
        // lurch every time the estimate moved, so the beat-locked rate only
        // takes over once the tracker has agreed with itself.
        const locked = metrics.confidence > ANALYSIS.minConfidence + 0.1;
        const rate = (locked ? ROWS_PER_BEAT / metrics.beatPeriod : ROWS_PER_SECOND) * this.speed;
        const interval = 1 / Math.max(rate, 1);

        this.sinceRow += dt;

        // Bounded, because a stalled frame would otherwise write hundreds of
        // identical rows and flatten the entire strip into one smear.
        let written = 0;
        while (this.sinceRow >= interval && written < 4) {
            this.writeRow(metrics.detail);
            this.sinceRow -= interval;
            written++;
        }
        if (written === 4) this.sinceRow = 0;
    }

    /**
     * Push one spectrum into the ring.
     *
     * The band set is resampled up to the texture width with linear
     * interpolation. Letting the GPU stretch `detailBands` columns instead would
     * work, but the interpolation would then happen after the 8-bit quantisation
     * rather than before it, and the banding shows up as visible terracing on
     * the shallow slopes.
     */
    writeRow(detail) {
        const bands = detail.length;
        for (let i = 0; i < COLUMNS; i++) {
            const x = (i / (COLUMNS - 1)) * (bands - 1);
            const lo = Math.floor(x);
            const hi = Math.min(lo + 1, bands - 1);
            const value = detail[lo] + (detail[hi] - detail[lo]) * (x - lo);
            this.row[i] = Math.max(0, Math.min(255, Math.round(value * 255)));
        }

        this.data.set(this.row, this.rowCursor * COLUMNS);
        this.texture.needsUpdate = true;

        // Half a texel, so age 0 lands on the centre of the row just written
        // rather than on the boundary between it and the one a full lap old.
        this.material.uniforms.uCursor.value = (this.rowCursor + 0.5) / ROWS;
        this.rowCursor = (this.rowCursor + 1) % ROWS;
    }
}
