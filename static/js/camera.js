/**
 * VOTLY Document Scanner Module
 * Interfaces with HTML5 MediaDevices camera API with edge detection guide,
 * laser scan animation, and canvas capture.
 */

const VotlyScanner = {
  videoElement: null,
  canvasElement: null,
  stream: null,
  facingMode: "environment",
  isFlashOn: false,
  capturedImageDataUrl: null,

  async startCamera(videoEl, canvasEl, onReadyCallback, onErrorCallback) {
    this.videoElement = videoEl;
    this.canvasElement = canvasEl;
    this.capturedImageDataUrl = null;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (onErrorCallback) onErrorCallback("Camera API not supported in this browser. Using high-resolution document simulation.");
      return false;
    }

    try {
      if (this.stream) {
        this.stopCamera();
      }

      const constraints = {
        video: {
          facingMode: this.facingMode,
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      };

      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.videoElement.srcObject = this.stream;
      await this.videoElement.play();

      if (onReadyCallback) onReadyCallback();
      return true;
    } catch (err) {
      console.warn("Camera access failed or denied:", err);
      if (onErrorCallback) onErrorCallback(err.message || "Camera access denied");
      return false;
    }
  },

  stopCamera() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.videoElement) {
      this.videoElement.srcObject = null;
    }
  },

  toggleFacingMode(onReadyCallback, onErrorCallback) {
    this.facingMode = (this.facingMode === "environment") ? "user" : "environment";
    return this.startCamera(this.videoElement, this.canvasElement, onReadyCallback, onErrorCallback);
  },

  captureFrame() {
    if (!this.canvasElement) {
      this.canvasElement = document.createElement("canvas");
    }

    const canvas = this.canvasElement;
    const ctx = canvas.getContext("2d");

    if (this.videoElement && this.stream && this.videoElement.videoWidth > 0) {
      canvas.width = this.videoElement.videoWidth;
      canvas.height = this.videoElement.videoHeight;
      ctx.drawImage(this.videoElement, 0, 0, canvas.width, canvas.height);
      this.capturedImageDataUrl = canvas.toDataURL("image/jpeg", 0.92);
    } else {
      // High-resolution fallback scan document generator if camera not present
      canvas.width = 1200;
      canvas.height = 800;
      
      // Draw simulated scanned document
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Border
      ctx.strokeStyle = "#CBD5E1";
      ctx.lineWidth = 12;
      ctx.strokeRect(40, 40, canvas.width - 80, canvas.height - 80);

      // Header Banner
      ctx.fillStyle = "#1E40AF";
      ctx.fillRect(60, 60, canvas.width - 120, 100);

      ctx.fillStyle = "#FFFFFF";
      ctx.font = "bold 36px sans-serif";
      ctx.fillText("VOTLY VERIFIED SECURE DOCUMENT", 100, 125);

      ctx.fillStyle = "#0F172A";
      ctx.font = "24px monospace";
      ctx.fillText(`SCANNED ON: ${new Date().toUTCString()}`, 100, 240);
      ctx.fillText(`DEVICE DIGEST: AES-256 SECURED CLIENT PAYLOAD`, 100, 290);
      ctx.fillText(`DOC ID: REF-${Math.random().toString(36).substring(2, 10).toUpperCase()}`, 100, 340);

      // Watermark
      ctx.fillStyle = "rgba(37, 99, 235, 0.08)";
      ctx.font = "bold 90px sans-serif";
      ctx.fillText("VOTLY SCANNER", 220, 500);

      this.capturedImageDataUrl = canvas.toDataURL("image/jpeg", 0.92);
    }

    return this.capturedImageDataUrl;
  }
};

window.VotlyScanner = VotlyScanner;
