// Finite state machine for the required 9-step flow: welcome, mode choice,
// camera-permission explanation, framing+calibration, interactive practice,
// countdown, gameplay, pause/settings, game over.
export const STATES = Object.freeze({
  WELCOME: 'WELCOME',
  MODE_SELECT: 'MODE_SELECT',
  PERMISSION_INFO: 'PERMISSION_INFO',
  CALIBRATION: 'CALIBRATION',
  PRACTICE: 'PRACTICE',
  COUNTDOWN: 'COUNTDOWN',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  TRACKING_LOST: 'TRACKING_LOST',
  GAME_OVER: 'GAME_OVER',
});

export class GameStateMachine {
  constructor(initial = STATES.WELCOME) {
    this.state = initial;
    this.previousState = null;
    this._listeners = [];
  }

  transition(next, payload = {}) {
    if (next === this.state) return;
    this.previousState = this.state;
    this.state = next;
    this._listeners.forEach((cb) => cb(this.state, this.previousState, payload));
  }

  is(...states) {
    return states.includes(this.state);
  }

  subscribe(cb) {
    this._listeners.push(cb);
    return () => {
      this._listeners = this._listeners.filter((l) => l !== cb);
    };
  }
}
