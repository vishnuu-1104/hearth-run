import { ACTIONS, actionBus } from '../actionSystem.js';
import { CONFIG } from '../config.js';

// Translates key presses into the same abstract actions the gesture
// detector produces, plus a held "accelerate" key that feeds the same
// movement-energy pipeline camera mode uses (see main.js) — holding it is
// the keyboard-mode equivalent of marching/swinging: sustained rhythmic
// effort raises speed, releasing it lets speed decay, exactly like the
// camera-driven signal. This keeps ONE speed model for every input source
// instead of a separate keyboard-only speed rule.
export class KeyboardInput {
  constructor() {
    this._handleKeyDown = this._handleKeyDown.bind(this);
    this._handleKeyUp = this._handleKeyUp.bind(this);
    this._enabled = true;
    this._accelerating = false;
  }

  attach() {
    window.addEventListener('keydown', this._handleKeyDown);
    window.addEventListener('keyup', this._handleKeyUp);
  }

  detach() {
    window.removeEventListener('keydown', this._handleKeyDown);
    window.removeEventListener('keyup', this._handleKeyUp);
  }

  setEnabled(enabled) {
    this._enabled = enabled;
    if (!enabled) this._accelerating = false;
  }

  isAccelerating() {
    return this._enabled && this._accelerating;
  }

  _handleKeyDown(event) {
    if (!this._enabled) return;
    const code = event.code;

    if (CONFIG.KEYS.accelerate.includes(code)) {
      this._accelerating = true;
      event.preventDefault();
      return;
    }

    if (event.repeat) return;
    const action = this._codeToAction(code);
    if (!action) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(code)) {
      event.preventDefault();
    }
    actionBus.dispatch(action, { source: 'keyboard' });
  }

  _handleKeyUp(event) {
    if (CONFIG.KEYS.accelerate.includes(event.code)) {
      this._accelerating = false;
    }
  }

  _codeToAction(code) {
    const keys = CONFIG.KEYS;
    if (keys.moveLeft.includes(code)) return ACTIONS.MOVE_LEFT;
    if (keys.moveRight.includes(code)) return ACTIONS.MOVE_RIGHT;
    if (keys.jump.includes(code)) return ACTIONS.JUMP;
    if (keys.slide.includes(code)) return ACTIONS.SLIDE;
    if (keys.pause.includes(code)) return ACTIONS.PAUSE_TOGGLE;
    if (keys.confirm.includes(code)) return ACTIONS.CONFIRM;
    return null;
  }
}
