// Wraps MediaPipe Tasks Vision's PoseLandmarker.
//
// WHY MEDIAPIPE TASKS VISION (over ml5.js's bodyPose):
// - Runs entirely as WASM in the browser — frames never leave the machine,
//   matching "process camera frames locally, don't upload/record video."
// - Exposes per-landmark `visibility` scores directly, which this project
//   needs twice over: to gate the discrete lane/jump gestures AND to gate
//   the movement-energy calculation (an occluded wrist must not silently
//   contribute a bogus velocity sample).
// - Lets us pick the "full" model (rather than "lite") explicitly: this
//   project tracks elbows/knees/ankles in addition to shoulders/wrists,
//   and the extra accuracy on limb landmarks noticeably helps the
//   movement-energy signal's stability. The trade-off is a somewhat
//   larger model download and slightly more inference time — acceptable
//   since detection already runs decoupled from rendering (see below).
// ml5.js remains a reasonable alternative (a gentler one-line API) but
// gives less direct control over which model variant loads and over the
// per-landmark visibility scores this project leans on throughout.
//
// External downloads (browser-fetched, cached by the browser, never see
// the camera feed): the @mediapipe/tasks-vision JS bundle + its WASM
// binaries from jsDelivr, and the pose_landmarker_full.task model
// (~9-30MB) from Google's model bucket.

const TASKS_VISION_VERSION = '0.10.14';
const WASM_BASE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';

// Detection runs on its own ~30Hz cadence, decoupled from p5's render loop,
// with a busy-guard so a slow inference call is skipped rather than queued
// (never overlapping inference calls, per the brief).
const MIN_DETECT_INTERVAL_MS = 33;

export const TRACKING_STATUS = Object.freeze({
  IDLE: 'IDLE',
  LOADING: 'LOADING',
  READY: 'READY',
  TRACKING: 'TRACKING',
  LOST: 'LOST',
  ERROR: 'ERROR',
  STOPPED: 'STOPPED',
});

export class PoseTracker {
  constructor(onStatus, onResult) {
    this.onStatus = onStatus;
    this.onResult = onResult;
    this.landmarker = null;
    this.stream = null;
    this.video = null;
    this._loopHandle = null;
    this._busy = false;
    this._lastDetectTime = 0;
    this._running = false;
  }

  async init(videoElement) {
    this.video = videoElement;
    this.onStatus(TRACKING_STATUS.LOADING);
    try {
      const visionModule = await import(
        `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}`
      );
      const { PoseLandmarker, FilesetResolver } = visionModule;
      const filesetResolver = await FilesetResolver.forVisionTasks(WASM_BASE_URL);

      try {
        this.landmarker = await PoseLandmarker.createFromOptions(filesetResolver, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numPoses: 1,
        });
      } catch (gpuErr) {
        console.warn('GPU delegate unavailable, falling back to CPU', gpuErr);
        this.landmarker = await PoseLandmarker.createFromOptions(filesetResolver, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
          runningMode: 'VIDEO',
          numPoses: 1,
        });
      }
      this.onStatus(TRACKING_STATUS.READY);
      return true;
    } catch (err) {
      console.error('PoseTracker init failed', err);
      this.onStatus(TRACKING_STATUS.ERROR, { reason: 'model-load-failed', error: err });
      return false;
    }
  }

  async startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.onStatus(TRACKING_STATUS.ERROR, { reason: 'unsupported' });
      return false;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false,
      });
    } catch (err) {
      const reason = err && err.name === 'NotFoundError' ? 'no-camera' : 'permission-denied';
      this.onStatus(TRACKING_STATUS.ERROR, { reason, error: err });
      return false;
    }

    this.video.srcObject = this.stream;
    await this.video.play();
    this._running = true;
    this._loop();
    this.onStatus(TRACKING_STATUS.TRACKING);
    return true;
  }

  _loop() {
    if (!this._running) return;
    this._loopHandle = requestAnimationFrame(() => this._loop());

    const now = performance.now();
    if (this._busy || now - this._lastDetectTime < MIN_DETECT_INTERVAL_MS) return;
    if (!this.video || this.video.readyState < 2) return;

    this._busy = true;
    this._lastDetectTime = now;
    try {
      const result = this.landmarker.detectForVideo(this.video, now);
      if (result && result.landmarks && result.landmarks.length > 0) {
        this.onResult(result.landmarks[0]);
      } else {
        this.onResult(null);
      }
    } catch (err) {
      console.error('Pose detection error', err);
    } finally {
      this._busy = false;
    }
  }

  stop() {
    this._running = false;
    if (this._loopHandle) cancelAnimationFrame(this._loopHandle);
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
    }
    this.onStatus(TRACKING_STATUS.STOPPED);
  }

  dispose() {
    this.stop();
    if (this.landmarker) {
      this.landmarker.close();
      this.landmarker = null;
    }
  }
}
