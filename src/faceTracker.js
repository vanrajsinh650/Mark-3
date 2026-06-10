/**
 * faceTracker.js
 *
 * Wraps Google MediaPipe Face Landmarker.
 * Initialises the WASM runtime, starts the camera stream,
 * and provides per-frame face transformation matrices + landmarks.
 */

import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

export class FaceTracker {
  constructor() {
    this.faceLandmarker = null;
    this.videoElement = null;
    this.stream = null;
    this.running = false;
    this.onResult = null; // callback(results, videoWidth, videoHeight)
    this._rafId = null;
  }

  /**
   * Load the MediaPipe WASM and face landmarker model.
   */
  async init() {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
    );

    this.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: true,
    });
  }

  /**
   * Start the webcam and begin detection loop.
   * @param {HTMLVideoElement} videoEl
   */
  async start(videoEl) {
    this.videoElement = videoEl;

    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: "user",
      },
      audio: false,
    });

    this.videoElement.srcObject = this.stream;
    await this.videoElement.play();
    this.running = true;
    this._detect();
  }

  _detect() {
    if (!this.running) return;

    try {
      if (this.videoElement.readyState >= 2) {
        const results = this.faceLandmarker.detectForVideo(
          this.videoElement,
          performance.now()
        );

        if (this.onResult) {
          this.onResult(
            results,
            this.videoElement.videoWidth,
            this.videoElement.videoHeight
          );
        }
      }
    } catch (err) {
      console.error("Error in FaceTracker detection loop:", err);
    }

    this._rafId = requestAnimationFrame(() => this._detect());
  }

  stop() {
    this.running = false;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
    }
  }
}
