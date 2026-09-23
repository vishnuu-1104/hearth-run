import { CONFIG, CALIBRATION_STEPS } from './config.js';
import { ACTIONS, actionBus } from './actionSystem.js';
import { GameStateMachine, STATES } from './game/gameState.js';
import { Player } from './game/player.js';
import { World } from './game/world.js';
import { Spawner } from './game/spawner.js';
import { checkCollisions } from './game/collision.js';
import { drawBackground, drawGround, drawSideDecor, drawScene } from './game/renderer.js';
import { KeyboardInput } from './input/keyboard.js';
import { PoseTracker, TRACKING_STATUS } from './input/poseTracking.js';
import { GestureDetector } from './input/gestureDetector.js';
import { MovementEnergyTracker } from './input/movementEnergy.js';
import { LM, isVisible } from './input/poseLandmarks.js';
import { UIController } from './ui/uiController.js';
import { lerp, damp } from './utils.js';

const ACTION_LABELS = {
  [ACTIONS.MOVE_LEFT]: '← Lane',
  [ACTIONS.MOVE_RIGHT]: 'Lane →',
  [ACTIONS.JUMP]: '↑ Jump',
  [ACTIONS.SLIDE]: '↓ Slide',
};

class Game {
  constructor() {
    this.state = new GameStateMachine(STATES.WELCOME);
    this.player = new Player();
    this.world = new World();
    this.spawner = new Spawner();
    this.keyboard = new KeyboardInput();
    this.gestures = new GestureDetector();
    this.energyTracker = new MovementEnergyTracker();
    this.poseTracker = new PoseTracker(
      (status, detail) => this._onTrackingStatus(status, detail),
      (landmarks) => this._onPoseResult(landmarks)
    );

    this.mode = null; // 'fullbody' | 'seated' | 'keyboard'
    this.score = 0;
    this.time = 0;
    this.speed = CONFIG.MIN_SPEED;
    this.energy = 0;
    this.lastTrackingStatus = null;

    this._calibrationIndex = 0;
    this._calibrationResults = {};
    this._calibrationCapturing = false;

    this._countdownValue = 0;
    this._countdownResetsGame = true;
    this._countdownAccum = 0;

    this._trackingLostCountdownActive = false;
    this._recoveryStableFrames = 0;

    this._practiceDone = new Set();
    this._practiceSpeedReached = false;

    this.ui = new UIController(this._uiCallbacks());
    this.keyboard.attach();

    actionBus.on('any-action', (e) => this._onAnyAction(e.detail));

    this.state.subscribe((next) => this._onStateChange(next));
    this._onStateChange(this.state.state);
  }

  // ---- UI callback wiring ---------------------------------------------

  _uiCallbacks() {
    return {
      onStartPressed: () => this.state.transition(STATES.MODE_SELECT),
      onChooseMode: (mode) => this._chooseMode(mode),
      onPermissionAllow: () => this._requestCamera(),
      onSwitchToSeated: () => {
        this.mode = 'seated';
        this.ui.announceStatus('Switched to seated mode — arm movement now controls your speed.');
      },
      onCalibrationCapture: () => this._captureCalibrationStep(),
      onCalibrationSkip: () => this._skipCalibration(),
      onPracticeContinue: () => this._startCountdown(true),
      onResume: () => this._startCountdown(false),
      onRestart: () => this._startCountdown(true),
      onRecalibrate: () => {
        this._calibrationIndex = 0;
        this._calibrationResults = {};
        this.state.transition(STATES.CALIBRATION);
      },
      onQuitToWelcome: () => this._quitToWelcome(),
      onPauseRequested: () => this.state.transition(STATES.PAUSED),
      onSensitivityChange: (v) => this.gestures.setSensitivity(v),
      onSwapLeftRightChange: (v) => this.gestures.setSwapLeftRight(v),
      onDisableCamera: () => this._disableCamera(),
    };
  }

  _chooseMode(mode) {
    if (mode === 'keyboard') {
      this.mode = 'keyboard';
      this.ui.showCameraError('');
      this.state.transition(STATES.PRACTICE);
      return;
    }
    this.mode = mode; // 'fullbody' | 'seated' — camera not requested yet
    this.state.transition(STATES.PERMISSION_INFO);
  }

  async _requestCamera() {
    this.ui.showPermissionError('');
    this.ui.announceStatus('Loading pose-tracking model…');
    const initOk = await this.poseTracker.init(this.ui.el.liveVideo);
    if (!initOk) {
      this.ui.showPermissionError('Could not load the pose-tracking model (check your network connection). You can still play with keyboard controls.');
      return;
    }
    const camOk = await this.poseTracker.startCamera();
    if (!camOk) return; // error message shown via _onTrackingStatus(ERROR, ...)

    this.ui.el.cameraFrame.hidden = false;
    this._calibrationIndex = 0;
    this._calibrationResults = {};
    this.state.transition(STATES.CALIBRATION);
  }

  _disableCamera() {
    this.poseTracker.stop();
    this.mode = 'keyboard';
    this.ui.el.cameraFrame.hidden = true;
    this.ui.announceStatus('Camera turned off. Playing with keyboard controls.');
  }

  _quitToWelcome() {
    if (this.mode === 'fullbody' || this.mode === 'seated') this.poseTracker.stop();
    this.mode = null;
    this.ui.el.cameraFrame.hidden = true;
    this.state.transition(STATES.WELCOME);
  }

  // ---- Calibration -------------------------------------------------------

  _captureCalibrationStep() {
    if (this._calibrationCapturing) return;
    const step = CALIBRATION_STEPS[this._calibrationIndex];
    this._calibrationCapturing = true;
    this.gestures.beginCalibrationStep();
    this._calibrationAccum = 0;
    this._calibrationStepDuration = step.duration;
  }

  _skipCalibration() {
    this.gestures.applyDefaultCalibration();
    this.state.transition(STATES.PRACTICE);
  }

  _finishCalibrationFlow() {
    this.gestures.applyCalibration(this._calibrationResults);
    this.state.transition(STATES.PRACTICE);
  }

  // ---- Countdown / tracking loss ------------------------------------------

  _startCountdown(resetsGame) {
    this._countdownResetsGame = resetsGame;
    this._countdownValue = 3;
    this._countdownAccum = 0;
    this.state.transition(STATES.COUNTDOWN);
  }

  _onTrackingStatus(status, detail) {
    this.lastTrackingStatus = status;
    if (status === TRACKING_STATUS.ERROR) {
      const messages = {
        'permission-denied': 'Camera access was denied. You can allow it from your browser’s address-bar controls, or continue with keyboard controls.',
        'no-camera': 'No camera was found on this device. Continuing with keyboard controls.',
        'model-load-failed': 'The pose-tracking model failed to load (check your network connection).',
        unsupported: 'This browser does not support camera access. Continuing with keyboard controls.',
      };
      this.ui.showPermissionError(messages[detail?.reason] || 'Camera could not be started.');
    }
  }

  _onPoseResult(landmarks) {
    if (this._calibrationCapturing) {
      this.gestures.sampleCalibration(landmarks);
    }

    if (this.state.is(STATES.CALIBRATION)) {
      this._updateLandmarkVisibilityUI(landmarks);
    }

    if (this.gestures.isCalibrated()) {
      this.gestures.setVerticalLocked(this.player.isLocked());
      const result = this.gestures.process(landmarks);
      this._handleTrackingContinuity(result);
    }

    // Energy is updated here — at the pose-detection cadence (~30Hz) — and
    // NOT from the render loop (~60Hz). Calling process() from render would
    // measure a position delta that only actually changes every other
    // frame against a dt that ticks every frame, roughly doubling apparent
    // velocity. Processing it exactly once per real landmark update keeps
    // the numerator (position delta) and denominator (elapsed time) in sync.
    this.energyTracker.process(landmarks, performance.now() / 1000);
  }

  _updateLandmarkVisibilityUI(landmarks) {
    const minVis = CONFIG.ENERGY.MIN_LANDMARK_VISIBILITY;
    const has = (a, b) => !!landmarks && isVisible(landmarks[a], minVis) && isVisible(landmarks[b], minVis);
    this.ui.updateLandmarkVisibility(
      {
        shoulders: has(LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER),
        wrists: has(LM.LEFT_WRIST, LM.RIGHT_WRIST),
        hips: has(LM.LEFT_HIP, LM.RIGHT_HIP),
        knees: has(LM.LEFT_KNEE, LM.RIGHT_KNEE),
        ankles: has(LM.LEFT_ANKLE, LM.RIGHT_ANKLE),
      },
      this.mode
    );
  }

  _handleTrackingContinuity(result) {
    if (this.mode !== 'fullbody' && this.mode !== 'seated') return;
    const streak = this.gestures.lowConfidenceStreak;
    const limit = CONFIG.ENERGY.LOW_CONFIDENCE_FRAME_LIMIT;

    if (this.state.is(STATES.PLAYING) && streak > limit) {
      this.state.transition(STATES.TRACKING_LOST);
      return;
    }

    if (this.state.is(STATES.TRACKING_LOST)) {
      if (streak === 0) {
        this._recoveryStableFrames++;
        if (this._recoveryStableFrames > 10 && !this._trackingLostCountdownActive) {
          this._trackingLostCountdownActive = true;
          this._startCountdown(false);
        }
      } else {
        this._recoveryStableFrames = 0;
      }
    }
  }

  _onAnyAction({ action, source }) {
    if (action === ACTIONS.PAUSE_TOGGLE) {
      if (this.state.is(STATES.PLAYING)) this.state.transition(STATES.PAUSED);
      else if (this.state.is(STATES.PAUSED)) this._startCountdown(false);
      return;
    }

    if (this.state.is(STATES.PRACTICE)) {
      this._practiceDone.add(action);
      this._refreshPracticeUI();
    }

    // A discrete gesture must never also read as a burst of marching/
    // swinging — see movementEnergy.js's suppressFor doc comment.
    if (source === 'gesture') this.energyTracker.suppressFor(CONFIG.ENERGY.GESTURE_SUPPRESSION_MS);

    if (!this.state.is(STATES.PLAYING)) return;

    switch (action) {
      case ACTIONS.MOVE_LEFT:
        this.player.moveLeft();
        break;
      case ACTIONS.MOVE_RIGHT:
        this.player.moveRight();
        break;
      case ACTIONS.JUMP:
        this.player.jump();
        break;
      case ACTIONS.SLIDE:
        this.player.slide();
        break;
      default:
        return;
    }
    if (source === 'gesture') this.ui.flashGestureToast(ACTION_LABELS[action] || action);
  }

  _refreshPracticeUI() {
    const keyForAction = {
      [ACTIONS.MOVE_LEFT]: 'left',
      [ACTIONS.MOVE_RIGHT]: 'right',
      [ACTIONS.JUMP]: 'jump',
      [ACTIONS.SLIDE]: 'slide',
    };
    for (const [action, key] of Object.entries(keyForAction)) {
      if (this._practiceDone.has(action)) this.ui.markPracticeDone(key);
    }
    if (this._practiceSpeedReached) this.ui.markPracticeDone('speed');
  }

  // ---- State transitions ---------------------------------------------------

  _onStateChange(next) {
    this.ui.showState(next);

    if (next === STATES.MODE_SELECT) {
      this.ui.setModeButtonsAvailability({
        cameraAvailable: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
      });
      this.ui.showCameraError('');
    }

    if (next === STATES.PERMISSION_INFO) {
      this.ui.showPermissionError('');
    }

    if (next === STATES.CALIBRATION) {
      this.ui.el.cameraFrame.hidden = false;
      this.ui.setCalibrationStep(this._calibrationIndex);
    }

    if (next === STATES.PRACTICE) {
      this._practiceDone.clear();
      this._practiceSpeedReached = false;
      this.energyTracker.reset();
      this.ui.resetPracticeUI();
      document.querySelectorAll('[data-mode-only]').forEach((el) => {
        const target = el.dataset.modeOnly;
        const isCameraMode = this.mode === 'fullbody' || this.mode === 'seated';
        el.hidden = !(target === this.mode || (target === 'camera' && isCameraMode));
      });
    }

    if (next === STATES.COUNTDOWN) {
      this.ui.setCountdownNumber(this._countdownValue);
    }

    if (next === STATES.PLAYING) {
      this.ui.el.cameraFrame.hidden = this.mode === 'keyboard';
    }

    if (next === STATES.PAUSED) {
      const recalBtn = document.getElementById('btn-pause-recalibrate');
      const disableCamBtn = document.getElementById('btn-camera-disable');
      const isCamera = this.mode === 'fullbody' || this.mode === 'seated';
      if (recalBtn) recalBtn.hidden = !isCamera;
      if (disableCamBtn) disableCamBtn.hidden = !isCamera;
    }

    if (next === STATES.TRACKING_LOST) {
      this._trackingLostCountdownActive = false;
      this._recoveryStableFrames = 0;
    }

    if (next === STATES.GAME_OVER) {
      this.ui.showFinalStats({ score: this.score, distanceMeters: this.spawner.distanceMeters });
    }
  }

  _resetGameplay() {
    this.player.reset();
    this.spawner.reset();
    this.energyTracker.reset();
    this.score = 0;
    this.time = 0;
    this.speed = CONFIG.MIN_SPEED;
    this.energy = 0;
  }

  // ---- Per-frame update ----------------------------------------------------

  update(dt) {
    if (this.state.is(STATES.PRACTICE)) {
      this._updateEnergy(dt);
      if (this.energy > 0.5) this._practiceSpeedReached = true;
      this._refreshPracticeUI();
      this._updateEnergyHint();
      return;
    }

    if (this.state.is(STATES.COUNTDOWN)) {
      this._countdownAccum += dt;
      if (this._countdownAccum >= 1) {
        this._countdownAccum = 0;
        this._countdownValue -= 1;
        this.ui.setCountdownNumber(Math.max(this._countdownValue, 0));
        if (this._countdownValue < 0) {
          if (this._countdownResetsGame) this._resetGameplay();
          this.state.transition(STATES.PLAYING);
        }
      }
      return;
    }

    if (!this.state.is(STATES.PLAYING)) return;

    this.time += dt;
    this._updateEnergy(dt);

    const targetSpeed = lerp(CONFIG.MIN_SPEED, CONFIG.MAX_SPEED, this.energy);
    this.speed = damp(this.speed, targetSpeed, CONFIG.SPEED_RESPONSE_LAMBDA, dt);

    this.player.update(dt, this.speed / CONFIG.MAX_SPEED);
    this.spawner.update(dt, this.speed);
    this.world.update(dt, this.speed, this.spawner.distanceMeters);

    const { hit, collectedIds } = checkCollisions(this.player, this.spawner);
    if (collectedIds.length > 0) this.score += collectedIds.length * CONFIG.COLLECTIBLE_VALUE;
    this.score += this.speed * dt * CONFIG.DISTANCE_TO_METERS * CONFIG.METER_SCORE_VALUE;

    if (hit) {
      this.state.transition(STATES.GAME_OVER);
      return;
    }

    this._updateEnergyHint();
    this.ui.updateHUD({
      score: this.score,
      distanceMeters: this.spawner.distanceMeters,
      speed: this.speed,
      energy: this.energy,
      trackingStatus: this.mode === 'keyboard' ? 'keyboard' : this.lastTrackingStatus,
    });
  }

  _updateEnergy(dt) {
    if (this.mode === 'keyboard') {
      this.energy = this.energyTracker.processDirectTarget(this.keyboard.isAccelerating() ? 1 : 0, dt);
    } else {
      // Camera modes update energy inside _onPoseResult's cadence (~30Hz);
      // here we just read the latest smoothed value each render frame.
      this.energy = this.energyTracker.energy;
    }
  }

  _updateEnergyHint() {
    if (this.energy < 0.15) this.ui.setEnergyHint('March and swing your arms to speed up!');
    else if (this.energy < 0.55) this.ui.setEnergyHint('Building speed — keep it rhythmic.');
    else if (this.energy < 0.85) this.ui.setEnergyHint('Nice pace!');
    else this.ui.setEnergyHint('Full speed!');
  }

  updateCalibrationCapture(dt) {
    if (!this._calibrationCapturing) return;
    this._calibrationAccum += dt;
    if (this._calibrationAccum >= this._calibrationStepDuration) {
      const stepId = CALIBRATION_STEPS[this._calibrationIndex].id;
      const avg = this.gestures.finishCalibrationStep();
      this._calibrationCapturing = false;
      if (avg) {
        this._calibrationResults[stepId] = avg;
        this._calibrationIndex++;
        if (this._calibrationIndex >= CALIBRATION_STEPS.length) {
          this._finishCalibrationFlow();
        } else {
          this.ui.setCalibrationStep(this._calibrationIndex);
        }
      } else {
        this.ui.announceStatus('No pose detected — make sure you’re visible in the camera frame and try again.');
      }
    }
  }

  render(p) {
    const reducedMotion = this.ui.reducedMotion;
    p.background(20, 14, 36);
    drawBackground(p, this.world, reducedMotion);
    drawGround(p, this.world, reducedMotion);
    if (this.state.is(STATES.PLAYING, STATES.PAUSED, STATES.COUNTDOWN, STATES.TRACKING_LOST)) {
      drawSideDecor(p, this.world, reducedMotion);
      drawScene(p, this.world, this.player, this.spawner, this.time, this.energy);
    }
  }
}

// ---- p5 bootstrap -----------------------------------------------------------

const game = new Game();

const sketch = (p) => {
  p.setup = () => {
    const host = document.getElementById('game-canvas-host');
    const canvas = p.createCanvas(host.clientWidth, host.clientHeight);
    canvas.parent(host);
    p.smooth();
    game.world.resize(p.width, p.height);
  };

  p.draw = () => {
    const dt = Math.min(p.deltaTime / 1000, 0.05);
    game.updateCalibrationCapture(dt);
    game.update(dt);
    game.render(p);
  };

  p.windowResized = () => {
    const host = document.getElementById('game-canvas-host');
    p.resizeCanvas(host.clientWidth, host.clientHeight);
    game.world.resize(p.width, p.height);
  };
};

new p5(sketch);

window.addEventListener('beforeunload', () => {
  game.poseTracker.dispose();
});
