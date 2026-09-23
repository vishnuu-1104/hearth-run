// Single source of truth for every tunable value and every color. Nothing
// here touches the DOM, canvas, or camera — pure data, per the project's
// "centrally defined configuration" requirement.

// ---- Palette (verbatim from the supplied design brief) --------------------
// The brief's "FBFE7" was an incomplete hex; its stated RGB (251,239,231)
// resolves to FBEFE7, which is what's used everywhere below.
export const PALETTE = {
  lilac: { pale: '#D5C6D8', mid: '#D1B3D5', mauveDeep: '#956D75', mauve: '#9F8692', mauveLight: '#AF9EA4' },
  blue: { steel: '#7A96BF', pale: '#D2D7E2', sky: '#C0D6E0', graySteel: '#B1BDC5', deep: '#6980A0', gray: '#93A1AE' },
  pinkPeach: { pink: '#FADADD', tan: '#D4B09B', peach: '#EBD6C8' },
  cream: {
    gold: '#F6E4BA', warm: '#FBEFE7', lightest: '#FDF9EE', tan: '#DAC6A4',
    pale: '#FBF0D5', paleGold: '#ECE2C0', gold2: '#F6E2B4', pale2: '#F9E9CB', pale3: '#EFE5C5', tan2: '#DECFBC',
  },
  sage: '#EDF1E2',
  dark: { brown: '#3B2926', grayPurple: '#625A64', black: '#000000' },
};

export const CONFIG = {
  // ---- Lanes & world geometry -------------------------------------------
  LANE_COUNT: 3,
  LANE_WIDTH_RATIO: 0.16,
  Z_FAR: 3400, // must comfortably exceed the worst-case fairness gap at MAX_SPEED (see spawner.js)
  GROUND_Y_RATIO: 0.86,
  CEILING_Y_RATIO: 0.04,
  HORIZON_Y_RATIO: 0.32,
  PERSPECTIVE_EASE: 0.62,
  // How far out (in "lane units," where the 3 playable lanes span -1..1)
  // the room's side walls sit. Everything architectural — floor edges,
  // walls, doorframes, wall-mounted decor — is projected using this same
  // constant via world.screenXForLane, which is what keeps every part of
  // the scene converging toward the same vanishing point instead of using
  // independent (and potentially mismatched) motion systems.
  //
  // Set wide (1.9 rather than a snug 1.35) on purpose: the playable lanes
  // only span -1..1, so a narrow room leaves almost no margin beside them,
  // and decorative furniture ends up crowding the lanes and reading as
  // something the player must react to. A wider room puts real space
  // between the outermost lane and the wall. The near end of the wall
  // falls off-screen at this width, which is correct — you're inside the
  // room, not looking at a diorama of it.
  WALL_LANE_UNITS: 1.9,
  DECOR_LANE_UNITS: 1.5, // decorative floor furniture sits here: clear of the lanes, short of the wall
  // How far the floor keeps tiling BEHIND the player's plane (world-z), so
  // the checkerboard runs all the way to the bottom of the frame instead
  // of stopping at the player's feet and leaving a flat band below.
  FLOOR_Z_BEHIND: 900,
  // Controls how quickly the perspective extrapolates for z < 0 (see
  // world.js _depthT). Smaller = the near floor stretches more per unit.
  NEAR_EXTRAPOLATION_RATIO: 0.6,
  DOORWAY_SPACING_Z: 1100,   // world-z distance between periodic doorway-frame silhouettes
  WALL_DECOR_SPACING_Z: 1050, // world-z distance between window/art slots per wall (wide, so they don't cycle by too fast)
  SIDE_DECOR_SPACING_Z: 950, // world-z distance between decorative floor furniture (sofas, plants, ...) per side
  DECOR_SCROLL_FACTOR: 0.22, // decorative elements scroll slower than the floor/lanes (parallax); also keeps side/wall decor from visibly changing too quickly

  // ---- Speed: driven continuously by movement energy, not a fixed ramp ---
  MIN_SPEED: 340,   // gentle idle pace when energy is ~0 (never fully stopped)
  MAX_SPEED: 1400,  // hard cap regardless of how energetic the input is
  SPEED_RESPONSE_LAMBDA: 2.2, // damping rate: how quickly displayed speed follows target speed (frame-rate independent)

  // Independently of instantaneous speed, difficulty (obstacle density/
  // variety) ramps with *distance*, on its own schedule — see spawner.js
  // for why speed and density are deliberately decoupled.
  DISTANCE_TO_METERS: 0.05,
  DIFFICULTY_RAMP_METERS: 900,
  // How far the player travels before the house theme transitions to the
  // next room. Speed reaches ~70 m/s (MAX_SPEED * DISTANCE_TO_METERS), so
  // this needs to be in the high hundreds to give a room a sensible
  // lifetime — at the original 55m a room lasted only 0.8-3.2 seconds and
  // the entire wall/ceiling/floor palette strobed continuously.
  ROOM_LENGTH_METERS: 900,
  UNLOCK_TALL_METERS: 50,
  UNLOCK_TABLE_METERS: 110,
  UNLOCK_COLLECTIBLE_METERS: 0,
  MAX_BLOCKED_LANES: 2, // never block every lane in one row (fairness)

  SPAWN_INTERVAL_START: 1.5,
  SPAWN_INTERVAL_MIN: 0.85,
  MIN_SPAWN_GAP_Z: 420,
  REACTION_TIME: 0.5,        // budget for a player to notice + start reacting to a new row
  SPAWN_SAFETY_BUFFER: 0.3,  // extra margin, since speed can accelerate *during* the approach
  ACTION_DURATION: {
    lane: 0.32,
    jump: (2 * 900) / 2200, // matches JUMP_VELOCITY/GRAVITY below: 2*v/g
    slide: 0.55, // matches SLIDE_DURATION below
  },

  // ---- Player physics ------------------------------------------------------
  LANE_CHANGE_LAMBDA: 14,
  JUMP_VELOCITY: 900,
  GRAVITY: 2200,
  PLAYER_HEIGHT: 150,
  PLAYER_SLIDE_HEIGHT: 70, // must stay below TABLE's lower edge (see furniture.js) so a slide actually clears it
  PLAYER_WIDTH: 88,
  SLIDE_DURATION: 0.55,

  COLLISION_Z_WINDOW: 70,
  COLLECT_Z_WINDOW: 90,
  SPAWN_FADE_IN_SECONDS: 0.4,
  COLLECTIBLE_VALUE: 10,
  METER_SCORE_VALUE: 1,

  // ---- Movement energy (continuous speed control) --------------------------
  ENERGY: {
    // How much recent history feeds the energy score — "repeated movement
    // over a short window," per the brief, not a single displacement.
    WINDOW_SECONDS: 1.1,
    // Per-landmark velocities below this (normalized to shoulder width per
    // second) are treated as sensor jitter, not intentional movement.
    JITTER_DEADZONE: 0.35,
    // Velocities are clamped here before summing, so one very fast flail
    // can't single-handedly max out the meter.
    VELOCITY_CAP: 6.0,
    // Weights: legs alone are as valuable as arms alone, but the SYNERGY
    // term rewards doing both at once — "coordinated arm and leg movement
    // produces the strongest speed increase," per the brief.
    ARM_WEIGHT: 1.0,
    LEG_WEIGHT: 1.0,
    SYNERGY_WEIGHT: 0.8,
    // Raw accumulated activity that maps to a full (1.0) energy score.
    ENERGY_NORMALIZER: 5.5,
    // Smoothing: energy rises fairly quickly (feels responsive) but decays
    // more slowly (so it doesn't feel like it "punishes" a half-second
    // pause), and idles down to 0 with no movement at all.
    RISE_LAMBDA: 3.0,
    DECAY_LAMBDA: 1.1,
    MIN_LANDMARK_VISIBILITY: 0.5,
    LOW_CONFIDENCE_FRAME_LIMIT: 18,
    // While a discrete gesture (lane-change/jump) is active or cooling
    // down, new energy samples are held rather than accumulated, so one
    // deliberate two-hand raise or lean can't also register as a burst of
    // "marching" and cause an unwanted speed spike.
    GESTURE_SUPPRESSION_MS: 380,
  },

  // ---- Gesture detection: lane-change (lean) & jump (two-hand raise) -------
  GESTURE: {
    ONE_EURO_MIN_CUTOFF: 0.9,
    ONE_EURO_BETA: 0.35,
    ONE_EURO_D_CUTOFF: 1.0,

    LATERAL_ENTER_FRACTION: 0.55,
    LATERAL_EXIT_FRACTION: 0.30,
    LANE_COOLDOWN_MS: 420,

    // Two-hand raise: both wrists must rise above the shoulder line by at
    // least this fraction of torso height, distinguishing a deliberate,
    // sustained raise from the much smaller, faster oscillation of an arm
    // swing used for movement energy.
    JUMP_RAISE_FRACTION: 0.32,
    JUMP_RESET_FRACTION: 0.12,
    JUMP_COOLDOWN_MS: 700,
    // A raise must be held for at least this long before it counts as
    // deliberate — filters out a single fast swing that briefly crosses
    // the raise height.
    JUMP_MIN_HOLD_MS: 90,

    // ---- Duck / squat -> slide -------------------------------------------
    // This is the hardest gesture in the project to detect safely, because
    // marching in place (the primary SPEED input) also lowers the body on
    // every step. Two things separate a deliberate squat from a march:
    //
    //  1. AMPLITUDE. A march bobs the shoulders by only a few percent of
    //     torso height; a squat drops them by a large fraction of the
    //     player's own calibrated squat depth. DUCK_ENTER_FRACTION is
    //     measured against that calibrated depth, so it scales to the
    //     individual rather than assuming a fixed body size.
    //  2. DURATION. A march passes through its lowest point and comes
    //     straight back up; a squat stays down. Requiring the drop to be
    //     HELD for DUCK_MIN_HOLD_MS rejects the transient dip of a step.
    //
    // Amplitude does most of the work; the hold is the safety net for an
    // unusually bouncy marching style. Raising either value makes ducking
    // harder to trigger accidentally but slower to respond.
    DUCK_ENTER_FRACTION: 0.5,
    DUCK_EXIT_FRACTION: 0.22,
    DUCK_MIN_HOLD_MS: 180,
    DUCK_COOLDOWN_MS: 750,
    FALLBACK_DUCK_RANGE: 0.3,
    // 3. STILLNESS. Amplitude and duration alone were NOT sufficient:
    //    testing showed a slow, deep march (~1 step/sec) dwells below the
    //    depth threshold for ~278ms per step, long enough to clear the hold
    //    and fire a false slide on every single step. The thing that
    //    actually distinguishes the two is that a squat SETTLES at the
    //    bottom while a march is still travelling through it. The hold
    //    timer therefore only runs while vertical speed is below this
    //    value (in torso-heights per second); any faster and the player is
    //    still moving, i.e. mid-step rather than parked in a squat.
    DUCK_MAX_SETTLE_SPEED: 0.3,

    SENSITIVITY_MIN: 0.6,
    SENSITIVITY_MAX: 1.6,
    SENSITIVITY_DEFAULT: 1.0,
    FALLBACK_LATERAL_RANGE: 0.55,
    MIN_VALID_RANGE: 0.05,
  },

  KEYS: {
    moveLeft: ['ArrowLeft', 'KeyA'],
    moveRight: ['ArrowRight', 'KeyD'],
    jump: ['ArrowUp', 'KeyW', 'Space'],
    slide: ['ArrowDown', 'KeyS'],
    accelerate: ['ShiftLeft', 'ShiftRight', 'KeyE'],
    pause: ['Escape', 'KeyP'],
    confirm: ['Enter'],
  },

  REDUCED_MOTION_QUERY: '(prefers-reduced-motion: reduce)',
};

export const CALIBRATION_STEPS = [
  { id: 'neutral', label: 'Stand or sit naturally, facing the camera', duration: 1.6 },
  { id: 'left', label: 'Lean comfortably to your left and hold', duration: 1.2 },
  { id: 'right', label: 'Lean comfortably to your right and hold', duration: 1.2 },
  // Measures how deep THIS player's comfortable squat is, so the duck
  // threshold scales to them instead of assuming a fixed body size or
  // range of motion. Seated players lower their upper body instead.
  { id: 'duck', label: 'Squat down — or lower your upper body, if seated — and hold', duration: 1.4 },
];
