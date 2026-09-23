// The single seam between input (keyboard or camera) and gameplay. Both
// input sources dispatch the same abstract actions, so keyboard-only mode
// needs zero special-casing anywhere else in the game.
export const ACTIONS = Object.freeze({
  MOVE_LEFT: 'MOVE_LEFT',
  MOVE_RIGHT: 'MOVE_RIGHT',
  JUMP: 'JUMP',
  SLIDE: 'SLIDE',
  PAUSE_TOGGLE: 'PAUSE_TOGGLE',
  CONFIRM: 'CONFIRM',
});

class ActionBus extends EventTarget {
  dispatch(action, detail = {}) {
    this.dispatchEvent(new CustomEvent(action, { detail }));
    this.dispatchEvent(new CustomEvent('any-action', { detail: { action, ...detail } }));
  }

  on(action, handler) {
    this.addEventListener(action, handler);
    return () => this.removeEventListener(action, handler);
  }
}

export const actionBus = new ActionBus();
