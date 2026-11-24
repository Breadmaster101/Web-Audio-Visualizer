/**
 * Owns the AudioContext and the captured stream, and nothing else. What the
 * sound means is up to whichever visualizer's engine taps `sourceNode`.
 */
export class AudioCapture {
    constructor({ onConnect, onDisconnect } = {}) {
        this.audioContext = null;
        this.sourceNode = null;
        this.stream = null;
        this.isReady = false;
        /** 'system' | 'mic' | null — which capture is currently live. */
        this.sourceName = null;
        this.onConnect = onConnect;
        this.onDisconnect = onDisconnect;
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

        this.sourceNode = this.audioContext.createMediaStreamSource(stream);
        this.stream = stream;
        this.sourceName = name;
        this.isReady = true;
        this.onConnect?.(this.audioContext, this.sourceNode);
    }

    /** Release the live capture. Safe to call before anything is connected. */
    disconnect() {
        this.isReady = false;
        // Before the context closes, so the engine can unhook from it.
        this.onDisconnect?.();
        this.sourceNode = null;

        if (this.stream) {
            this.stream.getTracks().forEach((track) => track.stop());
            this.stream = null;
        }

        if (this.audioContext) {
            this.audioContext.close().catch(() => {});
            this.audioContext = null;
        }

        this.sourceName = null;
    }
}
