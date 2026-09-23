import { CONFIG, PALETTE } from '../config.js';
import { lerp, clamp } from '../utils.js';

// Three recurring "rooms" the endless corridor cycles through, purely for
// wall/floor coloring + which decorative furniture set renderer.js favors.
// The house is meant to feel continuous (corridor -> living room ->
// bedroom -> corridor...), not like discrete loading screens.
export const ROOM_THEMES = [
  { id: 'corridor', wall: PALETTE.cream.lightest, wallAlt: PALETTE.cream.warm, floor: PALETTE.cream.pale, trim: PALETTE.dark.brown },
  { id: 'living', wall: PALETTE.cream.warm, wallAlt: PALETTE.pinkPeach.peach, floor: PALETTE.cream.tan2, trim: PALETTE.dark.grayPurple },
  { id: 'bedroom', wall: PALETTE.lilac.pale, wallAlt: PALETTE.blue.pale, floor: PALETTE.cream.paleGold, trim: PALETTE.dark.brown },
];

export class World {
  constructor() {
    this.width = 800;
    this.height = 600;
    this.scrollOffset = 0;
    this.decorOffset = 0;
    this.roomIndex = 0;
    this.roomProgress = 0; // 0..1 through the current room
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
  }

  update(dt, speed, distanceMeters) {
    // Deliberately NOT wrapped at a fixed value here. Every consumer of
    // these offsets (checker floor, lane dividers, doorway frames, wall
    // decor, side furniture — see renderer.js) applies its own modulo with
    // its OWN period (e.g. `% (Z_FAR + spacing)`), which is what actually
    // produces the looping/scrolling effect. Wrapping the raw counter here
    // too, at some arbitrary period that doesn't evenly divide every one
    // of those different periods, caused every one of them to jump
    // discontinuously in sync whenever THIS wrap happened to land — a
    // periodic "reset" glitch across the whole scene roughly every 10-15
    // seconds. A plain, ever-increasing counter has no such seam; a JS
    // number only loses integer precision above 2^53, i.e. many thousands
    // of hours of continuous play at top speed, so leaving it unbounded is
    // safe in practice.
    this.scrollOffset += speed * dt;
    this.decorOffset += speed * dt * CONFIG.DECOR_SCROLL_FACTOR;

    const roomLen = CONFIG.ROOM_LENGTH_METERS;
    this.roomIndex = Math.floor(distanceMeters / roomLen) % ROOM_THEMES.length;
    this.roomProgress = (distanceMeters % roomLen) / roomLen;
  }

  currentRoomTheme() {
    return ROOM_THEMES[this.roomIndex];
  }

  nextRoomTheme() {
    return ROOM_THEMES[(this.roomIndex + 1) % ROOM_THEMES.length];
  }

  /** How close (0..1, 1=at the boundary) we are to the next room transition — used to crossfade wall colors and to know when to draw a doorway. */
  transitionBlend() {
    return clamp((this.roomProgress - 0.85) / 0.15, 0, 1);
  }

  _depthT(z) {
    // Depths NEARER than the player's plane (z < 0) extrapolate linearly
    // to a negative t instead of clamping to 0. Clamping meant nothing
    // could ever be projected closer than the player, so the floor had to
    // stop dead at the player's feet, leaving a flat, checkerless band
    // across the bottom ~14% of the screen. Every lerp that consumes this
    // (screenYForZ, screenXForLane, scaleForZ) extrapolates correctly for
    // negative t: lower on screen, spread wider, drawn larger — which is
    // also what an object sweeping past the player should do.
    //
    // The curve `t^EASE` can't be evaluated below 0, so the near side uses
    // a straight line; the two meet at t=0 and the near region is small
    // enough that the difference in curvature isn't perceptible.
    if (z < 0) return z / (CONFIG.Z_FAR * CONFIG.NEAR_EXTRAPOLATION_RATIO);
    const t = clamp(z / CONFIG.Z_FAR, 0, 1);
    return Math.pow(t, CONFIG.PERSPECTIVE_EASE);
  }

  screenYForZ(z) {
    const t = this._depthT(z);
    return lerp(this.height * CONFIG.GROUND_Y_RATIO, this.height * CONFIG.HORIZON_Y_RATIO, t);
  }

  /**
   * The ceiling's screen Y at depth z. Uses the SAME depth easing as
   * screenYForZ, converging to the identical horizon point — this is what
   * makes the floor and ceiling meet at a single vanishing band rather
   * than at two independent (and possibly inconsistent-looking) points.
   */
  screenCeilingYForZ(z) {
    const t = this._depthT(z);
    return lerp(this.height * CONFIG.CEILING_Y_RATIO, this.height * CONFIG.HORIZON_Y_RATIO, t);
  }

  scaleForZ(z) {
    const t = this._depthT(z);
    return lerp(1, 0.16, t);
  }

  screenXForLane(laneUnits, z) {
    const t = this._depthT(z);
    const centerX = this.width / 2;
    const laneSpread = this.width * CONFIG.LANE_WIDTH_RATIO * 2.6;
    const spreadAtDepth = lerp(laneSpread, laneSpread * 0.08, t);
    return centerX + laneUnits * spreadAtDepth;
  }

  laneToUnits(laneIndex) {
    return laneIndex - 1;
  }
}
