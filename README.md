# Hearth Run

A webcam-controlled, three-lane endless runner built with **p5.js** and **MediaPipe Tasks Vision (PoseLandmarker)**, made as an interaction design project. You dash through an endlessly continuing pastel house — corridor, living room, bedroom, corridor again — dodging furniture. The core twist: **your own marching and arm-swinging sets your running speed**, not a fixed auto-scroll.

This README explains what was built, why, and how to run it, and is explicit about what is a *design intention* versus something actually *verified by testing* — see [TESTING.md](TESTING.md) for the full, honest verification report (no live webcam or human-subject testing was performed in the environment this was built in).

---

## 1. Project overview

**Concept.** Hearth Run keeps Subway Surfers' core loop — three lanes, obstacles, collectibles, rising difficulty — but replaces both the setting and the *nature* of the controls. Instead of a fixed auto-run speed with discrete swipe controls, the player's own **rhythmic body movement continuously drives how fast the character runs**, while lightweight discrete gestures (lean, two-hand raise) handle steering and jumping.

**Intended users.** Someone in front of a laptop webcam, standing with room to march, or seated at a desk. The three control modes (full-body / seated / keyboard) are a direct response to "not everyone can or wants to stand up and march" — see section 5.

**Interaction design objective.** Demonstrate a *continuous, effort-proportional* body-driven control (movement energy → speed) alongside a small set of *reliable, discrete* body gestures (lean → lane, raise → jump), and show how to keep the continuous and discrete signals from interfering with each other — a distinct interaction problem from a purely discrete gesture-to-action mapping.

---

## 2. Gameplay

- Three lanes; the character runs automatically, but **how fast** depends entirely on your movement energy (see section 11).
- **Furniture** (see `js/game/furniture.js` / `renderer.js`):
  - **Ottoman / cushion** (low, pastel lilac, rounded, up-arrow badge) — jump over it, or change lanes.
  - **Tall cabinet/bookshelf** (blue-gray, shelf lines + books, no-entry badge) — too tall to jump; you must change lanes.
  - **Table** (chest-height top on slim legs, with a clear gap beneath, down-arrow badge) — slide under it, or change lanes. Jumping does *not* clear it: you rise into the table top rather than over it.
- **Collectibles**: warm glowing "firefly" lights, +10 points each.
- **Decorative furniture** — sofas, chairs, beds, plants, wall art, windows, hanging vines, rugs — appears along the *sides* of the room and is rendered smaller/flatter and pushed outside the lane area, so it never competes visually with something you need to react to (see section 3's "visual hierarchy" discussion).
- **Scoring**: 1 point per meter travelled + 10 per firefly collected. Distance and current speed are both shown in the HUD.
- **Game over**: colliding with furniture you didn't clear correctly. Shows final score + distance, with restart / main-menu buttons.
- **Difficulty**: ramps with **distance travelled**, not with your current speed — see section 13 for why those are deliberately decoupled. Furniture variety unlocks progressively (tall cabinets after 50m, tables after 110m); spawn cadence tightens toward a floor value over the first ~900m, then holds.

---

## 3. Why the house setting and this palette

**Why a house.** A domestic, room-to-room setting gives a natural reason for the visual "chapters" (corridor → living room → bedroom) that a generic subway or rooftop setting doesn't — it also invites the *low ottoman / tall cabinet* obstacle vocabulary the brief asked for (furniture with obvious "jump over" vs. "go around" affordances, unlike a train's generic barriers). It's also simply a different, cozier register from the genre's usual gritty/urban visual language, which fits an interaction-design project's goal of demonstrating a coherent original visual system.

**Why this specific palette.** The supplied palette was used as-is (see `js/config.js`'s `PALETTE` object — every value is copied verbatim, including the corrected `#FBEFE7`). Roles were assigned by contrast and connotation, not arbitrarily:
- **Creams** → walls, floors, doorframes: creams read as "architecture" (neutral, receding) rather than "thing to react to," which matters for keeping obstacles legible against the background.
- **Lilac/blue** → furniture: these sit a clear step darker/cooler than the cream backgrounds, so silhouettes read immediately without needing saturated color.
- **Pink/peach** → accents (cushion tops, collectibles, sashes): the warmest, most attention-grabbing tones in the set, reserved for things the player should *notice* — collectibles and the jump-badge icon.
- **Sage** → foliage. The brief supplies only one sage value (`#EDF1E2`), which is very pale — rather than inventing new green hues (which would break "use this palette as source of truth"), plant leaves use sage as a highlight and the palette's cooler blue-grays (`#B1BDC5`, `#93A1AE`) as shadow tones. This is a **design compromise**: it keeps foliage strictly on-palette at the cost of the deeper, more saturated greens a real houseplant palette might use.
- **Dark accents** → text and the icon-badge outlines/glyphs, for the contrast ratio a pastel palette alone can't provide (see section accessibility notes).

---

## 4. Why body movement controls speed, and how gestures were chosen

**Why a continuous, effort-based speed control at all** (rather than just another discrete "go faster" gesture): the brief specifically asks for *rhythmic, repeated* activity to set the pace, which is a fundamentally different design goal from "detect X, do Y once." A discrete gesture answers "did an event happen"; movement energy answers "how much has been happening lately," which is the right shape of question for something as continuous as running speed. This also creates a much more literal, sustained mapping between physical effort and in-game exertion than any single gesture could.

**Gesture selection, with alternatives considered:**

| Control | Chosen gesture | Why | Alternative considered | Trade-off |
|---|---|---|---|---|
| Speed | Sustained arm-swing / marching activity, averaged over ~1.1s | Matches "repeated movement over a short window," works standing or seated (arms alone), and is hard to trigger by accident since it requires *sustained*, not momentary, activity | A single "speed burst" gesture (e.g., a fist pump) | A one-shot gesture doesn't fit a *continuous* speed value at all — you'd need to spam it, which is tiring and not what "effort-proportional pace" means |
| Lane change | Lean left/right | Small, fast, an obvious lateral analogue to "move left/right," and — critically — largely orthogonal to the up/down arm-swing motion that drives speed | Head turn | Too easily confused with simply looking away from the screen |
| Jump | Both wrists raised well above the shoulder line, held briefly | Large, deliberate, and clearly distinguishable from the *much smaller, faster, oscillating* motion of an arm swing (see section 12 for the concrete thresholds that separate them) | A single-arm raise | Two hands is a much rarer accidental pose than one arm going up mid-swing, so it's a more reliable "this is deliberate" signal |
| Slide | Squat / lower the upper body, and hold | The only body motion that maps naturally to "get lower," and it works seated as well as standing | A forward lean | A forward lean changes depth (z), which 2D pose landmarks estimate far less reliably than in-plane height |

### The duck/slide gesture, and why it needed three filters

This is the hardest gesture in the project, because **marching in place — the game's own speed input — lowers the body on every single step.** A naive "are the shoulders lower than normal?" test fires continuously while running. Three independent gates separate the two:

1. **Depth.** The drop must reach a large fraction of the player's *own* calibrated squat depth (captured during calibration, so it scales to the individual rather than assuming a body size). A step's bob is a small fraction of a real squat.
2. **Stillness.** Vertical speed must be at or below `DUCK_MAX_SETTLE_SPEED`. A squat *parks* at the bottom; a march is still travelling through it.
3. **Hold.** Both conditions must persist for `DUCK_MIN_HOLD_MS`.

Depth and hold alone were **empirically insufficient** — that's not a guess, it's what testing showed. A simulated slow, deep march (1 step/sec) dwells below the depth threshold for ~278ms per step, comfortably clearing a 150ms hold, and fired a false slide on *every step*. The stillness gate was added specifically in response, and the thresholds were then tuned against a sweep of marching cadences. See [TESTING.md](TESTING.md) for the full matrix and results.

**The honest limit:** as a march gets arbitrarily slow and deep, it eventually becomes physically indistinguishable from repeated squatting, and no detector could separate them. Testing shows the gates hold down to roughly one step every two seconds with a 40%-of-torso drop — far slower and deeper than any real marching cadence (a normal march is 1.5–3 steps/sec). Beyond that point the motion genuinely *is* a squat. Note also that all of this was validated against *synthetic* pose data, not a real person on a live camera — see the limitations in section 18.

---

## 5. Full-body, seated, and keyboard mode differences

| | Full-body | Seated | Keyboard |
|---|---|---|---|
| Speed input | Arms + legs (marching), synergy bonus for using both | Arms only | Hold a key |
| Lane change | Lean | Lean | Arrow/A/D |
| Jump | Two-hand raise | Two-hand raise | Arrow-Up/W/Space |
| Slide | Squat and hold | Lower the upper body and hold | Arrow-Down/S |
| Camera required | Yes | Yes | No |
| Calibration | Neutral + lean range | Neutral + lean range | None |

Full-body and seated modes share **all the same underlying code** — the only differences are (a) which framing instructions are shown, (b) whether the framing screen warns you that your legs aren't visible and offers to switch to seated, and (c) that seated mode's energy score simply never receives a leg contribution (the movement-energy calculation already treats "legs not visible" as "leg activity = 0" gracefully — see section 11 — so seated mode isn't a special code path, just an honest expectation-setting one).

---

## 6. Technology choices

### p5.js
Chosen for the same reasons as any small, no-build-step interaction-design project: a minimal drawing/animation API with an instance-mode game loop, and `deltaTime` available for frame-rate-independent movement everywhere it matters (lane easing, jump arc, speed response, energy rise/decay — all implemented with the same `damp()` helper in `utils.js`).

### MediaPipe Tasks Vision — `PoseLandmarker` (full model)
Chosen over **ml5.js's `bodyPose`** for the same core reasons as similar projects: it runs entirely as WASM on-device (frames never leave the browser), and it exposes per-landmark `visibility` scores directly, which this project leans on *twice* — once to gate the lean/jump gestures, and once to gate the movement-energy calculation (an occluded wrist must not contribute a bogus velocity spike). This project uses the **"full"** model variant rather than "lite": because movement energy depends on elbow/knee/ankle tracking quality (not just the coarser shoulder/hip landmarks a simple lean detector would need), the extra accuracy was judged worth the larger download and slightly higher inference cost, especially since detection already runs decoupled from rendering (see section 12). ml5.js remains a reasonable alternative — a friendlier one-line API — but gives less direct control over model variant and per-landmark confidence, both of which this project uses directly.

**Compatibility.** `@mediapipe/tasks-vision@0.10.14`, requiring WebAssembly + `getUserMedia` — current Chrome, Edge, and Firefox on desktop. Not tested on Safari.

**External downloads (browser-fetched, cached, never see your camera feed):**
| What | From | Why |
|---|---|---|
| `@mediapipe/tasks-vision@0.10.14` JS bundle + WASM | `cdn.jsdelivr.net` | The PoseLandmarker engine itself |
| `pose_landmarker_full.task` model (~9-30MB) | `storage.googleapis.com/mediapipe-models/...` | Trained model weights |
| `p5.js@1.9.4` | `cdnjs.cloudflare.com` | Rendering/game-loop library |

---

## 7. Prerequisites and installation

No build step, no `package.json`. You need a static file server, because ES modules and camera access both require `http://`/`https://`, not `file://`.

```bash
# Any one of these, run from the project's root folder:
python -m http.server 8000        # Python 3
npx serve -l 8000                 # Node.js, no install needed
# or VS Code's "Live Server" extension: right-click index.html
```

Pinned versions live directly in source: `p5.js` **1.9.4** (`index.html`), `@mediapipe/tasks-vision` **0.10.14** (`js/input/poseTracking.js`).

---

## 8. Running locally, camera permissions, setup

1. Start a static server (section 7) from the project root.
2. Open **`http://localhost:8000`** in Chrome/Edge/Firefox.
3. Click **Start**, choose a mode. For Full-body/Seated, you'll see a permission-explanation screen (why the camera is needed, what happens to the video) **before** any browser permission prompt appears — the prompt only fires after you click "Allow Camera" on that screen.
4. Accept the browser's camera prompt. If you deny it, have no camera, or the model fails to load, the game explains why and offers keyboard mode from the same screen.

---

## 9. Camera positioning, calibration, sensitivity, troubleshooting

**Positioning.** Face the camera. For full-body mode, stand back far enough that your hands (out to the sides, mid-swing) and your legs are both inside frame, with room to march in place. For seated mode, being framed from the waist/chest up is enough.

**The framing screen** shows a live checklist (shoulders / wrists / hips / knees / ankles) that turns from "Not visible" to "Visible" in real time as MediaPipe finds each landmark group with sufficient confidence — this is a direct implementation of "visibility of system status" and "show the player whether a gesture was recognized before introducing obstacles" for the setup phase specifically. If you picked full-body mode and your legs aren't visible, a message offers to switch you to seated mode rather than silently pretending full-body tracking is working.

**Calibration** captures your neutral position, then comfortable left/right lean, in three ~1.2-1.6s holds. "Skip calibration" is always available and falls back to a reasonable default lean range.

**Sensitivity** (Settings, in the pause menu) scales how far you need to lean to trigger a lane change; it does not affect the movement-energy/speed calculation, which is separately normalized to body size (see section 11) rather than needing a manual sensitivity knob.

**Troubleshooting** — see the dedicated table in section 16 below? (kept in one place; scroll to **Troubleshooting**.)

---

## 10. Architecture

```
index.html              Semantic HTML for every screen, HUD, and settings control.
css/style.css           Pastel theme (palette-driven), focus states, contrast, reduced-motion.

js/config.js            PALETTE (verbatim from the brief) + every tunable constant.
js/utils.js             lerp/clamp/damp, OneEuroFilter, TimeWindow (sliding-window activity buffer).
js/actionSystem.js      ACTIONS bus — the one seam between input and gameplay (no SLIDE action).

js/input/poseLandmarks.js     Shared MediaPipe landmark index constants + visibility helper.
js/input/poseTracking.js      Camera + PoseLandmarker lifecycle, non-overlapping ~30Hz inference loop.
js/input/movementEnergy.js    Landmarks -> continuous 0..1 "movement energy" (see section 11).
js/input/gestureDetector.js   Landmarks -> discrete MOVE_LEFT/MOVE_RIGHT/JUMP, with calibration,
                               hysteresis, and cooldowns; suppresses energy input during its own
                               cooldown window so a gesture can't double as a speed spike.
js/input/keyboard.js          Keydown/keyup -> the same actions, plus a held "accelerate" key that
                               feeds the SAME energy-smoothing pipeline as camera mode.

js/game/gameState.js    Finite state machine for the 9-step flow.
js/game/player.js       Lane position + jump physics (no slide state).
js/game/world.js        2.5D projection + room-theme cycling (corridor/living/bedroom) + scrolling.
js/game/furniture.js    Gameplay furniture/collectible data + per-type vertical hitbox bands.
js/game/spawner.js      Difficulty ramp (distance-based) + the fairness-guaranteeing row generator.
js/game/collision.js    Interval-overlap collision between the player's hitbox and nearby furniture.
js/game/renderer.js     All canvas drawing: background/doorways/vines, floor/rugs, decorative side
                         furniture, gameplay furniture, collectible, and the player character.

js/ui/uiController.js   Owns every DOM element: screen visibility, HUD, energy meter, landmark
                         checklist, settings, help modal.
js/main.js              Composition root: builds every module above and wires the action bus and
                         state machine together; owns the p5 instance and draw loop.
```

### How camera landmarks become movement energy, speed, and game actions
1. `poseTracking.js` runs `detectForVideo()` on its own ~30Hz loop (never overlapping — see section 12), handing each result (or `null`) to two independent consumers in `main.js`: `gestureDetector.js` and `movementEnergy.js`.
2. `movementEnergy.js` computes the frame-to-frame velocity of wrists/elbows ("arm activity") and knees/ankles ("leg activity"), normalized by shoulder width, deadzoned against jitter, and averaged over a ~1.1s sliding window — see section 11 for the full explanation.
3. `gestureDetector.js` separately watches the same landmarks for a lean (lane change) or a sustained two-hand raise (jump), and — critically — tells `movementEnergy.js` to briefly ignore new samples right after either gesture fires, so a deliberate lean/jump can't also register as a burst of marching (see section 12).
4. `main.js` maps the resulting energy value onto a target speed (`lerp(MIN_SPEED, MAX_SPEED, energy)`) and smoothly damps the *displayed* speed toward it every frame, and separately turns gesture events into `player.moveLeft()/moveRight()/jump()` calls via the shared action bus — exactly the same call keyboard input makes.

---

## 11. Movement energy: how it works, and its limitations

**What it computes.** A continuous score in `[0,1]` representing "how much rhythmic arm/leg activity happened in roughly the last second," normalized to the player's own body size (shoulder width). Concretely, each detection tick:
1. Compute each tracked landmark's displacement since the last tick, divide by shoulder width (body-size normalization) and by elapsed time (frame-rate independence) → a velocity.
2. Subtract a small deadzone (`CONFIG.ENERGY.JITTER_DEADZONE`) so landmark-tracking noise on an otherwise-still limb doesn't register as movement; clamp each velocity at a cap so one very fast flailing frame can't dominate the score.
3. Push accepted values into a ~1.1s sliding window (`TimeWindow` in `utils.js`) for arms and legs separately, and use each window's **average** — this is what "repeated movement over a short window, not a single displacement" means in code.
4. Combine: `raw = ARM_WEIGHT*armAvg + LEG_WEIGHT*legAvg + SYNERGY_WEIGHT*min(armAvg,legAvg)`. The synergy term is what makes *coordinated* arm-and-leg movement produce more energy than either alone maxed out — it directly implements "coordinated arm and leg movement produces the strongest speed increase."
5. Normalize (`raw / ENERGY_NORMALIZER`) and clamp to `[0,1]`.
6. Smooth with an **asymmetric** rise/decay: energy rises quickly (`RISE_LAMBDA=3.0`, effort feels rewarded almost immediately) but decays more slowly (`DECAY_LAMBDA=1.1`), so a brief pause doesn't feel punishing, while sustained inactivity does eventually settle all the way to 0 — "no movement returns to a gentle minimum pace."

**What this is NOT.** This is a **game control signal**, not a fitness or biomechanics measurement. It is not calibrated against real cadence, stride length, calories, or heart rate, and this project makes no claim about actual running speed or exercise intensity. It rewards *tempo* of movement, not "correct form" — someone flailing quickly but arrhythmically may score similarly to someone marching in good rhythm more slowly. This simplification is intentional for a game control and is stated here rather than left implicit.

**Confidence gating.** If shoulders aren't visible with sufficient confidence, the frame contributes zero energy input (not a guess) and increments a low-confidence streak used for tracking-loss detection (section 12). If only arms are visible (seated mode, or full-body with legs out of frame), leg activity is simply 0 — energy still works, just from arms alone, which is exactly seated mode's design.

**Keyboard mode uses the identical smoothing pipeline**: holding the accelerate key feeds a target of `1`, releasing feeds `0`, through the exact same rise/decay function real movement energy uses (`MovementEnergyTracker.processDirectTarget`) — one speed model for every input source, not a separate keyboard rule.

---

## 12. Why smoothing, thresholds, cooldowns, and confidence checks are needed

- **OneEuroFilter smoothing** (lean detection): a fixed exponential average forces a trade-off between killing jitter and reacting quickly. One Euro Filter adapts its cutoff to signal speed — smooth while nearly still, responsive the instant real movement starts — see `utils.js`.
- **Hysteresis (separate enter/exit thresholds)** on lane changes: without a gap between "trigger" and "reset" thresholds, noise sitting near a single threshold would fire repeatedly. The signal must clearly return toward neutral before it can trigger again.
- **Cooldowns** (`LANE_COOLDOWN_MS`, `JUMP_COOLDOWN_MS`): an independent, time-based backstop against rapid repeats, and a pace the lane-change/jump animations can actually keep up with.
- **A minimum hold duration for jump** (`JUMP_MIN_HOLD_MS`): a real arm-swing (used for movement energy) passes through the "wrists above shoulders" zone very briefly on its way up and back down; requiring the raise to be *sustained* for even ~90ms is what separates "swinging" from "reaching up and holding."
- **Gesture-triggered energy suppression** (`GESTURE_SUPPRESSION_MS`): the flip side of the above — the arm motion involved in throwing a lean or a jump gesture would itself look like a burst of "activity" to the energy calculation. Suppressing new energy samples for a short window after any gesture fires stops a single deliberate action from also spiking your speed. This is the direct implementation of "define gesture priorities so a jump or lane-change gesture does not accidentally create a speed spike."
- **Confidence checks** everywhere: both the gesture detector and the energy tracker treat "landmark not visible" as "no signal this frame," never as "assume the last known value" — an occluded wrist should not silently keep contributing stale, possibly-wrong activity.
- **Tracking-loss detection**: a streak of low-confidence frames (no reliable shoulders) auto-pauses gameplay into `TRACKING_LOST`, with an explicit resume (once tracking is stable again) followed by the same 3-2-1 countdown as a fresh start, so the player is never ambushed by an obstacle the instant tracking resumes.

---

## 13. Collision detection and fair obstacle generation

**Collision.** The player's hitbox (`player.getHitbox()`) already reflects jump state (its vertical extent rises during a jump). Each furniture type declares a fixed vertical band (`FURNITURE_DEFS`). A collision is a 1D interval-overlap test between the two, only evaluated while the furniture's depth is within a small forgiving window of the player — so "did the player clear this" and "did the player hit this" fall out of the *same* test, with no separate per-type branching, and a jump timed a frame or two early/late still reads as fair.

**Fairness guarantee**, and the specific brief requirement to account for **current speed, possible acceleration, lane-change duration, and jump timing**:
1. A row of furniture never blocks every lane (`MAX_BLOCKED_LANES < LANE_COUNT`) — there's always at least one lane needing zero action.
2. Rows spawn only at exactly the horizon depth (`Z_FAR`) — never further back. An earlier iteration of this pattern (used in a sibling project) discovered that pushing a row further back to satisfy spacing requirements leaves it visually pinned at the horizon by the perspective projection until real distance "catches up," which reads as popping in and then suddenly lurching into motion. Instead, if the previous row hasn't yet moved far enough away, the spawner simply declines and retries a few frames later.
3. The **required spacing** between rows is computed from `CONFIG.MAX_SPEED` — the worst case — not the player's current speed. This is the direct answer to "account for current speed, possible acceleration": rather than trying to predict whether the player will accelerate between a row spawning and it arriving, the spacing is always computed as if they're already at maximum speed, which is provably sufficient regardless of what actually happens to their speed in between. The trade-off is somewhat lower furniture density at low speed than a current-speed-based formula could allow — a deliberate choice favoring guaranteed fairness over squeezing in more obstacles.
4. That spacing accounts for a reaction-time budget (`REACTION_TIME`) plus the **slowest** available action (`max(jump duration, 2x a single lane-change duration)` — covering a worst-case two-lane shift) plus a safety buffer.
5. **Difficulty (spawn density/variety) is driven by distance, not speed** — see section 2 and the class comment in `spawner.js` — directly answering "do not simply increase obstacle density whenever the player moves faster."

This was verified with a headless simulation (no rendering) across a 4-minute run at both minimum and maximum speed, and a scripted bot that survives a sudden mid-run acceleration burst — see [TESTING.md](TESTING.md) for exact numbers.

---

## 14. Customization

| Want to change... | Edit... |
|---|---|
| Palette / theme colors | `js/config.js`'s `PALETTE` object |
| How much arm vs. leg activity matters, or the coordination bonus | `CONFIG.ENERGY.ARM_WEIGHT` / `LEG_WEIGHT` / `SYNERGY_WEIGHT` |
| How twitchy or forgiving the speed meter feels | `CONFIG.ENERGY.RISE_LAMBDA` / `DECAY_LAMBDA` / `JITTER_DEADZONE` |
| Min/max speed | `CONFIG.MIN_SPEED` / `MAX_SPEED` |
| Lean/jump sensitivity defaults | `CONFIG.GESTURE.*` (also user-adjustable via the sensitivity slider) |
| Cooldowns | `CONFIG.GESTURE.LANE_COOLDOWN_MS` / `JUMP_COOLDOWN_MS` |
| Difficulty ramp / furniture unlock distances | `CONFIG.DIFFICULTY_RAMP_METERS`, `CONFIG.UNLOCK_TALL_METERS` |
| How many lanes can be blocked at once (fairness) | `CONFIG.MAX_BLOCKED_LANES` — never raise to `LANE_COUNT` or higher |
| Room order/length, wall/floor colors per room | `ROOM_THEMES` and `CONFIG.ROOM_LENGTH_METERS` in `js/game/world.js` |
| Keyboard bindings | `CONFIG.KEYS` |
| Furniture/collectible visuals | `js/game/renderer.js` (independent of gameplay logic above) |

---

## 15. Privacy, network requests, storage, cleanup

- Camera access is requested only after the player picks Full-body or Seated mode **and** clicks "Allow Camera" on the permission-explanation screen — never on page load.
- **Video is processed entirely on-device** via MediaPipe's WebAssembly runtime; no frame is ever uploaded, recorded, or stored. There is no backend server in this project.
- The only network requests camera mode makes are the one-time library/model downloads in section 6, which carry no user data and happen regardless of whether a camera is even connected.
- No cookies or `localStorage` are used; sensitivity/reduced-motion settings are in-memory only and reset on reload.
- Camera tracks are explicitly stopped (`MediaStreamTrack.stop()`) when the player clicks "Turn Off Camera," "Quit to Menu," or closes/navigates away from the tab.
- Camera access requires `localhost` or HTTPS — a browser policy, not a choice this project makes.

---

## 16. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| No permission prompt appears | Served over `file://` or non-localhost HTTP | Use `http://localhost:PORT` or HTTPS |
| Prompt appears, then an error shows | Permission denied | Re-allow via the browser's address-bar camera icon, or use Keyboard mode |
| "No camera found" | No webcam, or in use by another app | Close other apps using the camera |
| Landmarks stay "Not visible" on the framing screen | Poor lighting, out of frame, or too far/close | Improve lighting, recenter, adjust distance |
| Chose Full-body but legs won't show as visible | Camera framing only shows your upper body | Step back, or accept the offered switch to Seated mode |
| Energy meter barely moves even though you're moving a lot | Movements too slow/smooth to register as "activity," or sensitivity assumptions don't match your setup | Try faster, more rhythmic swings; this is a tempo-based signal (see section 11) |
| Speed feels like it's climbing even when you stop | Leftover motion still inside the ~1.1s averaging window | Expected briefly — it decays within roughly a second; if it persists, check for camera jitter |
| Lane changes feel reversed | Unverified mirroring assumption (see `gestureDetector.js`'s doc comment) | Enable **Swap left/right** in Settings |
| Jump fires by itself during a big arm swing | Raise threshold or hold duration too low for your movement style | Increase `JUMP_RAISE_FRACTION` / `JUMP_MIN_HOLD_MS`, or lower sensitivity |
| Model fails to load | No internet on first load, or CDN unreachable | Check connectivity; see section 6 for self-hosting |
| "Tracking lost" appears too eagerly/rarely | Lighting or framing borderline | Recalibrate with better lighting; adjust distance from camera |
| Camera light stays on after leaving the game | Should not happen — tracks are stopped on quit/disable/unload | Manually revoke camera permission for the tab; report as a bug if reproducible |

---

## 17. What was actually tested vs. what requires manual testing

See **[TESTING.md](TESTING.md)** for the full breakdown: headless simulations that were actually run (with results), and an explicit manual test checklist covering everything that requires a live webcam and a human, none of which could be performed in this build environment.

---

## 18. Known limitations and future improvements

**Limitations:**
- The duck/slide gesture is the least certain part of the system. Its separation from marching is validated only against *synthetic* pose data (see section 4 and TESTING.md); a real player with an unusual marching style could still provoke a false slide. `DUCK_ENTER_FRACTION`, `DUCK_MIN_HOLD_MS` and `DUCK_MAX_SETTLE_SPEED` are the levers if so.
- The lean-direction mirroring math is a documented, unverified assumption (a "Swap left/right" setting exists specifically to correct it in the field).
- No live human-subject usability testing has been performed; all comfort/fatigue/false-trigger claims are design intentions (see section 4's table and section 17).
- The movement-energy score rewards tempo, not correct running form, and does not distinguish a strong, slow marcher from a fast, sloppy one (explicitly disclaimed in section 11).
- Only one person is tracked (`numPoses: 1`); a second person in frame is not designed for.
- No sound design, no persistent high scores (both out of scope for this interaction-focused build).

**Future improvements:**
- An optional live skeleton overlay during calibration for advanced users/debugging.
- A short "energy history" graph so players can see their own rhythm, not just the instantaneous meter.
- Adaptive furniture density based on observed miss-rate rather than distance alone.
- A duck/slide alternative gesture for seated mode specifically (e.g., a deliberate forward lean, which doesn't compete with the seated energy signal the way a hip-drop would) — flagged here as a promising direction not pursued in this build for scope reasons.

---

## Credits and licenses

- **p5.js** v1.9.4 — LGPL-2.1/GPL-3.0, © the Processing Foundation. https://p5js.org
- **MediaPipe Tasks Vision** (`@mediapipe/tasks-vision`) v0.10.14 and the **Pose Landmarker (full)** model — Apache License 2.0, © Google LLC.
- Palette values supplied by the project brief; all other code, visuals ("Hearth Run," the house theme, furniture, and character), and this documentation were written for this project — no third-party game assets, textures, or audio were used.
- **AI assistance disclosure**: this project (design, all source code, and documentation) was produced with Claude (Anthropic) as a coding assistant, from a detailed brief provided by the student/author, who reviewed and is responsible for the submitted work. Per sections 4 and 17, the assistant explicitly could not perform live-webcam or human-subject testing in this environment, and that limitation is disclosed rather than hidden throughout this README and in TESTING.md.
