import { STATES } from '../game/gameState.js';
import { CONFIG, CALIBRATION_STEPS } from '../config.js';
import { formatMeters, formatScore } from '../utils.js';
import { TRACKING_STATUS } from '../input/poseTracking.js';

// Every menu, button, and status readout is real semantic HTML in
// index.html; this module is the only place that touches that DOM. It
// translates game-state transitions into screen visibility and wires
// buttons to callbacks supplied by main.js.
export class UIController {
  constructor(callbacks) {
    this.callbacks = callbacks;
    this._cacheElements();
    this._wireButtons();
    this._wireSettings();
    this.reducedMotion = window.matchMedia(CONFIG.REDUCED_MOTION_QUERY).matches;
    this._toastTimer = null;
  }

  _cacheElements() {
    const byId = (id) => document.getElementById(id);
    this.screens = {
      [STATES.WELCOME]: byId('screen-welcome'),
      [STATES.MODE_SELECT]: byId('screen-mode-select'),
      [STATES.PERMISSION_INFO]: byId('screen-permission-info'),
      [STATES.CALIBRATION]: byId('screen-calibration'),
      [STATES.PRACTICE]: byId('screen-practice'),
      [STATES.COUNTDOWN]: byId('screen-countdown'),
      [STATES.PAUSED]: byId('screen-pause'),
      [STATES.TRACKING_LOST]: byId('screen-tracking-lost'),
      [STATES.GAME_OVER]: byId('screen-game-over'),
    };
    this.hud = byId('hud');
    this.helpModal = byId('help-modal');
    this.toast = byId('gesture-toast');
    this.statusLine = byId('status-line');

    this.el = {
      scoreValue: byId('score-value'),
      distanceValue: byId('distance-value'),
      speedValue: byId('speed-value'),
      energyFill: byId('energy-fill'),
      energyHint: byId('energy-hint'),
      trackingIndicator: byId('tracking-indicator'),
      trackingLabel: byId('tracking-label'),
      calibrationStepLabel: byId('calibration-step-label'),
      calibrationProgress: byId('calibration-progress'),
      liveVideo: byId('live-video'),
      cameraFrame: byId('camera-preview-frame'),
      countdownNumber: byId('countdown-number'),
      trackingLostCountdown: byId('tracking-lost-countdown'),
      finalScore: byId('final-score'),
      finalDistance: byId('final-distance'),
      sensitivitySlider: byId('sensitivity-slider'),
      sensitivityValue: byId('sensitivity-value'),
      swapLeftRight: byId('swap-left-right'),
      reducedMotionToggle: byId('reduced-motion-toggle'),
      cameraErrorMessage: byId('camera-error-message'),
      permissionErrorMessage: byId('permission-error-message'),
      landmarkList: byId('landmark-visibility-list'),
      legsWarning: byId('legs-not-visible-warning'),
      practiceItems: {
        speed: document.querySelector('#screen-practice [data-practice-check="speed"]'),
        left: document.querySelector('#screen-practice [data-practice-check="MOVE_LEFT"]'),
        right: document.querySelector('#screen-practice [data-practice-check="MOVE_RIGHT"]'),
        jump: document.querySelector('#screen-practice [data-practice-check="JUMP"]'),
        slide: document.querySelector('#screen-practice [data-practice-check="SLIDE"]'),
      },
    };
  }

  _wireButtons() {
    const on = (id, handler) => {
      const node = document.getElementById(id);
      if (node) node.addEventListener('click', handler);
    };

    on('btn-start', () => this.callbacks.onStartPressed());
    on('btn-mode-fullbody', () => this.callbacks.onChooseMode('fullbody'));
    on('btn-mode-seated', () => this.callbacks.onChooseMode('seated'));
    on('btn-mode-keyboard', () => this.callbacks.onChooseMode('keyboard'));
    on('btn-permission-allow', () => this.callbacks.onPermissionAllow());
    on('btn-permission-keyboard-fallback', () => this.callbacks.onChooseMode('keyboard'));
    on('btn-switch-seated', () => this.callbacks.onSwitchToSeated());
    on('btn-calibration-capture', () => this.callbacks.onCalibrationCapture());
    on('btn-calibration-skip', () => this.callbacks.onCalibrationSkip());
    on('btn-practice-continue', () => this.callbacks.onPracticeContinue());
    on('btn-pause-resume', () => this.callbacks.onResume());
    on('btn-pause-restart', () => this.callbacks.onRestart());
    on('btn-pause-recalibrate', () => this.callbacks.onRecalibrate());
    on('btn-pause-quit', () => this.callbacks.onQuitToWelcome());
    on('btn-gameover-restart', () => this.callbacks.onRestart());
    on('btn-gameover-menu', () => this.callbacks.onQuitToWelcome());
    on('btn-help-open', () => this.toggleHelp(true));
    on('btn-help-close', () => this.toggleHelp(false));
    on('btn-hud-pause', () => this.callbacks.onPauseRequested());
    on('btn-tracking-lost-cancel', () => this.callbacks.onQuitToWelcome());
    on('btn-camera-disable', () => this.callbacks.onDisableCamera());

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.helpModal && !this.helpModal.hidden) this.toggleHelp(false);
    });
  }

  _wireSettings() {
    const slider = this.el.sensitivitySlider;
    if (slider) {
      slider.min = CONFIG.GESTURE.SENSITIVITY_MIN;
      slider.max = CONFIG.GESTURE.SENSITIVITY_MAX;
      slider.step = 0.05;
      slider.value = CONFIG.GESTURE.SENSITIVITY_DEFAULT;
      slider.addEventListener('input', () => {
        const v = parseFloat(slider.value);
        this.el.sensitivityValue.textContent = v.toFixed(2);
        this.callbacks.onSensitivityChange(v);
      });
    }
    if (this.el.swapLeftRight) {
      this.el.swapLeftRight.addEventListener('change', (e) => this.callbacks.onSwapLeftRightChange(e.target.checked));
    }
    if (this.el.reducedMotionToggle) {
      this.el.reducedMotionToggle.checked = this.reducedMotion;
      this.el.reducedMotionToggle.addEventListener('change', (e) => {
        this.reducedMotion = e.target.checked;
      });
    }
  }

  toggleHelp(show) {
    if (!this.helpModal) return;
    this.helpModal.hidden = !show;
    if (show) this.helpModal.querySelector('button, [tabindex]')?.focus();
  }

  showState(state) {
    Object.entries(this.screens).forEach(([key, node]) => {
      if (!node) return;
      node.hidden = key !== state;
    });
    const active = this.screens[state];
    if (active) {
      const heading = active.querySelector('h1, h2');
      if (heading) {
        heading.setAttribute('tabindex', '-1');
        heading.focus();
      }
    }
    this.hud.hidden = !(state === STATES.PLAYING || state === STATES.PAUSED);
    // The energy hint lives outside #hud (it's shown during practice too,
    // before the HUD itself appears), so its visibility is managed
    // separately, matching exactly the two states main.js actually calls
    // setEnergyHint() from.
    if (this.el.energyHint) {
      this.el.energyHint.hidden = !(state === STATES.PLAYING || state === STATES.PRACTICE);
    }
  }

  setModeButtonsAvailability({ cameraAvailable }) {
    for (const id of ['btn-mode-fullbody', 'btn-mode-seated']) {
      const node = document.getElementById(id);
      if (!node) continue;
      node.disabled = !cameraAvailable;
      node.title = cameraAvailable ? '' : 'Camera not available in this browser/context';
    }
  }

  showCameraError(message) {
    if (this.el.cameraErrorMessage) {
      this.el.cameraErrorMessage.textContent = message;
      this.el.cameraErrorMessage.hidden = !message;
    }
  }

  showPermissionError(message) {
    if (this.el.permissionErrorMessage) {
      this.el.permissionErrorMessage.textContent = message;
      this.el.permissionErrorMessage.hidden = !message;
    }
  }

  setCalibrationStep(index) {
    const step = CALIBRATION_STEPS[index];
    if (!step) return;
    this.el.calibrationStepLabel.textContent = step.label;
    this.el.calibrationProgress.textContent = `Step ${index + 1} of ${CALIBRATION_STEPS.length}`;
  }

  /** @param {Record<string, boolean>} visibility keyed by 'shoulders'|'wrists'|'hips'|'knees'|'ankles' */
  updateLandmarkVisibility(visibility, mode) {
    if (!this.el.landmarkList) return;
    for (const [key, ok] of Object.entries(visibility)) {
      const row = this.el.landmarkList.querySelector(`[data-landmark="${key}"]`);
      if (!row) continue;
      row.dataset.visible = ok ? 'true' : 'false';
      const status = row.querySelector('.landmark-status-text');
      if (status) status.textContent = ok ? 'Visible' : 'Not visible';
    }
    const legsOk = visibility.knees && visibility.ankles;
    if (this.el.legsWarning) {
      this.el.legsWarning.hidden = !(mode === 'fullbody' && !legsOk);
    }
  }

  setCountdownNumber(n) {
    this.el.countdownNumber.textContent = n > 0 ? String(n) : 'GO!';
  }

  setTrackingLostCountdown(n) {
    if (this.el.trackingLostCountdown) this.el.trackingLostCountdown.textContent = String(n);
  }

  updateHUD({ score, distanceMeters, speed, energy, trackingStatus, trackingConfidence }) {
    this.el.scoreValue.textContent = formatScore(score);
    this.el.distanceValue.textContent = formatMeters(distanceMeters);
    if (this.el.speedValue) this.el.speedValue.textContent = `${Math.round(speed)}`;
    if (this.el.energyFill) this.el.energyFill.style.width = `${Math.round(energy * 100)}%`;
    this._updateTrackingIndicator(trackingStatus, trackingConfidence);
  }

  setEnergyHint(text) {
    if (this.el.energyHint) this.el.energyHint.textContent = text;
  }

  _updateTrackingIndicator(status) {
    if (!this.el.trackingIndicator) return;
    const labels = {
      [TRACKING_STATUS.TRACKING]: 'Tracking',
      [TRACKING_STATUS.LOST]: 'Tracking lost',
      [TRACKING_STATUS.LOADING]: 'Loading…',
      [TRACKING_STATUS.ERROR]: 'Camera error',
      [TRACKING_STATUS.STOPPED]: 'Camera off',
    };
    this.el.trackingLabel.textContent = labels[status] || 'Keyboard mode';
    this.el.trackingIndicator.dataset.status = status || 'keyboard';
  }

  showFinalStats({ score, distanceMeters }) {
    this.el.finalScore.textContent = formatScore(score);
    this.el.finalDistance.textContent = formatMeters(distanceMeters);
  }

  markPracticeDone(key) {
    const el = this.el.practiceItems[key];
    if (el) el.classList.add('practice-check-done');
  }

  resetPracticeUI() {
    Object.values(this.el.practiceItems).forEach((el) => el && el.classList.remove('practice-check-done'));
  }

  flashGestureToast(actionLabel) {
    if (!this.toast) return;
    this.toast.textContent = actionLabel;
    this.toast.classList.remove('toast-visible');
    void this.toast.offsetWidth;
    this.toast.classList.add('toast-visible');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.toast.classList.remove('toast-visible'), 700);
  }

  announceStatus(message) {
    if (this.statusLine) this.statusLine.textContent = message;
  }
}
