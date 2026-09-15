import { ANALYSIS } from '../config.js';
import { AudioAnalyser } from './AudioAnalyser.js';

/**
 * Owns the AudioContext and stream capture, and exposes the analysed metrics.
 * Stays silent (all values at 0) until a stream is connected.
 */
export class AudioSource {
    constructor({ onReady } = {}) {
        this.audioContext = null;
        this.analyser = null;
        this.dataArray = null;
        this.stream = null;
        this.isReady = false;
        /** 'system' | 'mic' | null — which capture is currently live. */
        this.sourceName = null;
        this.metrics = new AudioAnalyser();
        this.onReady = onReady;
    }

    /**
     * Switch capture. The new stream is acquired *before* the old one is torn
     * down, so a denied permission prompt or a share dialog the user cancels
     * leaves the visualiser running on whatever it already had.
     */
    async start(name) {
        let stream;
        try {
            stream = name === 'mic' ? await this.requestMic() : await this.requestSystem();
        } catch (err) {
            console.error(err);
            alert(name === 'mic'
                ? 'Microphone access failed. Please check permissions.'
                : 'System audio capture failed.');
            return false;
        }

        if (!stream) return false;

        this.disconnect();
        await this.connect(stream, name);
        return true;
    }

    /** Capture desktop/tab audio. Drops the video track we are forced to request. */
    async requestSystem() {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });

        if (stream.getAudioTracks().length === 0) {
            // Stop the video we asked for but cannot use, or the browser keeps
            // showing a sharing indicator for a capture nothing is reading.
            stream.getTracks().forEach((track) => track.stop());
            alert("No audio track found. Please retry and check 'Share System Audio'.");
            return null;
        }

        stream.getVideoTracks().forEach((track) => track.stop());
        return stream;
    }

    requestMic() {
        // The browser's own AGC, noise gate and echo canceller fight the
        // engine's calibration, so ask for the raw signal.
        return navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            }
        });
    }

    async connect(stream, name) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        if (this.audioContext.state === 'suspended') await this.audioContext.resume();

        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = ANALYSIS.fftSize;
        // The engine does its own time-aware smoothing; the built-in one would
        // blur the transients onset detection depends on.
        this.analyser.smoothingTimeConstant = 0;

        const source = this.audioContext.createMediaStreamSource(stream);
        source.connect(this.analyser);

        // Float data keeps the full dynamic range. The byte API clamps to
        // minDecibels/maxDecibels, which throws away exactly the quiet detail
        // the adaptive normalizer needs to calibrate against.
        this.dataArray = new Float32Array(this.analyser.frequencyBinCount);
        this.metrics.configure(this.analyser.fftSize, this.audioContext.sampleRate);

        this.stream = stream;
        this.sourceName = name;
        this.isReady = true;
        if (this.onReady) this.onReady();
    }

    /** Release the live capture. Safe to call before anything is connected. */
    disconnect() {
        this.isReady = false;

        if (this.stream) {
            this.stream.getTracks().forEach((track) => track.stop());
            this.stream = null;
        }

        if (this.audioContext) {
            this.audioContext.close().catch(() => {});
            this.audioContext = null;
        }

        this.analyser = null;
        this.sourceName = null;
    }

    /** Pull a fresh frame and re-analyse it. No-op before a stream is connected. */
    update(deltaTime) {
        if (!this.isReady) return false;
        this.analyser.getFloatFrequencyData(this.dataArray);
        this.metrics.update(this.dataArray, deltaTime);
        return true;
    }
}
