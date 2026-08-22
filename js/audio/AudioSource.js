import { AudioAnalyser } from './AudioAnalyser.js';

/**
 * Owns the AudioContext and stream capture, and exposes the analysed bands.
 * Stays silent (all bands at 0) until a stream is connected.
 */
export class AudioSource {
    constructor({ onReady } = {}) {
        this.audioContext = null;
        this.analyser = null;
        this.dataArray = null;
        this.isReady = false;
        this.metrics = new AudioAnalyser();
        this.onReady = onReady;
    }

    connect(stream) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 2048;

        const source = this.audioContext.createMediaStreamSource(stream);
        source.connect(this.analyser);
        this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

        this.isReady = true;
        if (this.onReady) this.onReady();
    }

    /** Capture desktop/tab audio. Drops the video track we are forced to request. */
    async startSystemAudio() {
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            if (stream.getAudioTracks().length === 0) {
                alert("No audio track found. Please retry and check 'Share System Audio'.");
                return;
            }
            this.connect(stream);
            stream.getVideoTracks()[0].stop();
        } catch (err) {
            console.error(err);
            alert('System audio capture failed.');
        }
    }

    async startMicAudio() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.connect(stream);
        } catch (err) {
            console.error(err);
            alert('Microphone access failed. Please check permissions.');
        }
    }

    /** Pull a fresh frame and re-analyse it. No-op before a stream is connected. */
    update(deltaTime) {
        if (!this.isReady) return false;
        this.analyser.getByteFrequencyData(this.dataArray);
        this.metrics.update(this.dataArray, deltaTime);
        return true;
    }
}
