/**
 * The interface every visualiser implements.
 *
 * A mode owns whatever it adds to the scene and nothing else. It is built when
 * the user picks it and disposed when they pick another, so it must give back
 * every GPU resource it took — geometries, materials, textures and render
 * targets all hold memory that garbage collection cannot reach on its own.
 *
 * The base class is deliberately close to empty. Modes differ far more than
 * they overlap: one is a point cloud, one is a heightfield, one is a simulation
 * running on a pair of render targets. Trying to factor a common
 * implementation out of that would only produce something every subclass had to
 * work around. What they genuinely share is this contract.
 */
export class VisualMode {
    /**
     * @param {import('./Stage.js').Stage} stage  Shared scene, camera and renderer.
     */
    constructor(stage) {
        this.stage = stage;
        this.scene = stage.scene;
        /** Everything added to the shared scene, so `dispose` can be generic. */
        this.owned = [];
    }

    /** Track an object so it is removed and freed automatically on dispose. */
    add(object) {
        this.scene.add(object);
        this.owned.push(object);
        return object;
    }

    /**
     * One frame of audio. Called only while a stream is connected, so a mode
     * never has to handle undefined metrics — it simply stops being called and
     * holds its last state.
     *
     * @param {object} metrics  The analyser's live output.
     * @param {number} dt       Frame delta in seconds, already clamped upstream.
     */
    setAudio(metrics, dt) {}

    /**
     * Advance anything that moves on its own. Called every frame, including
     * before audio arrives, so a mode is never frozen on the start screen.
     *
     * @param {number} time  Seconds since startup.
     * @param {number} dt    Frame delta in seconds.
     */
    setTime(time, dt) {}

    /** 0.1..5. Each mode maps this into whatever "brighter" means for it. */
    setBrightness(value) {}

    /** Sphere mode's point budget. Ignored by modes that do not draw points. */
    setCount(count) {}

    /** Flight or scroll rate, as a multiple of the mode's natural pace. */
    setSpeed(value) {}

    /** How long the membrane rings. Ignored elsewhere. */
    setDamping(value) {}

    /** Free every GPU resource this mode allocated. */
    dispose() {
        for (const object of this.owned) {
            this.scene.remove(object);
            VisualMode.release(object);
        }
        this.owned.length = 0;
    }

    /**
     * Recursively free the geometry, material and textures under an object.
     *
     * Three.js does not do this on `remove` — that only unlinks the object from
     * the graph. Without an explicit release, switching modes back and forth
     * leaks a full point cloud or heightfield to the GPU every time.
     */
    static release(object) {
        object.traverse?.((node) => {
            node.geometry?.dispose();
            const materials = Array.isArray(node.material) ? node.material : [node.material];
            for (const material of materials) {
                if (!material) continue;
                for (const value of Object.values(material)) {
                    if (value && value.isTexture) value.dispose();
                }
                for (const uniform of Object.values(material.uniforms ?? {})) {
                    if (uniform?.value?.isTexture) uniform.value.dispose();
                }
                material.dispose();
            }
        });
    }
}
