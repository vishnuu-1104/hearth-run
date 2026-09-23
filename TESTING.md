# Testing & Verification Report

An honest account of what was actually verified before delivery versus what still requires a human with a live webcam. The build environment used to produce this project has **no camera and no browser automation available**, so nothing below involved a real webcam, a real human gesture, or a browser session — that limitation is stated plainly rather than glossed over.

## What was actually done

### 1. Static checks
- Every JavaScript file (17 files) was syntax-checked with `node --check`. All pass.
- Every DOM element ID and `querySelector` pattern referenced from `js/ui/uiController.js` and `js/main.js` was cross-checked against `index.html` by an automated script; zero missing references.
- The project was served from a local static file server and every referenced file (HTML/CSS/JS) returned HTTP 200.

### 2. Headless logic simulation (pure game logic, no rendering, no camera, no DOM)
Using Node.js, the pure-logic modules (`spawner.js`, `player.js`, `collision.js`, `movementEnergy.js`, `config.js` — none of which touch the DOM/canvas/camera) were imported directly and exercised:

**Fairness at both speed extremes.** Simulated 4 minutes of `Spawner.update()` at a constant `MAX_SPEED`, and 2 minutes at a constant `MIN_SPEED`, checking after every frame that no furniture row ever blocks all 3 lanes and that no furniture ever spawns beyond the visible horizon depth (`Z_FAR`).
- **Result: 0 overflow, 0 fairness violations** across 18,023 row-snapshots at max speed and 10,817 at min speed. Max furniture alive at once: 4 (never a totally empty screen, never overcrowded).

**Sudden-acceleration safety.** The brief specifically calls out accounting for "possible acceleration." A scripted bot (reacting only to what a player could see — furniture lane/type/depth within a reaction-time-scaled look-ahead, not omniscient) played 20 independent 180-second runs where speed **jumps instantly from minimum to maximum at t=2s**, simulating a player who suddenly goes from standing still to full marching effort right as furniture is approaching.
- **Result: 20/20 runs completed with zero collisions.** This is the concrete evidence that computing row-spacing from `MAX_SPEED` (worst case) rather than current speed actually holds up under a deliberately adversarial acceleration pattern, not just under steady-state speed.

**Movement-energy model sanity.** `MovementEnergyTracker.processDirectTarget()` (the same rise/decay smoothing real camera-driven energy uses) was driven with a sustained target of 1 for 3 seconds, then 0 for 10 seconds.
- **Result:** energy reached 1.000 (full) after 3s of sustained "effort," and decayed to 0.000 after 10s idle — confirming the asymmetric rise/decay behaves as designed (rises to the cap, decays fully to the true minimum) without runaway or stuck-nonzero behavior.

### 2b. Duck/slide gesture: simulated pose-data test suite

The duck gesture is the one most at risk of false-firing, because marching in place (the speed input) lowers the body on every step. It was tested by driving the real `GestureDetector` with **synthetic landmark frames on a virtual clock** (so hold/cooldown timing behaves exactly as it would at the real 30Hz detection cadence), across a sweep of marching cadences and deliberate squats.

**This testing found a real defect.** With only a depth threshold and a 150ms hold, a simulated slow, deep march (1 step/sec, 28%-of-torso bob) dwelt below the depth threshold for ~278ms per step and **fired a false slide on every single step — 10 in 10 seconds.** A third gate (stillness: vertical speed must be at or below `DUCK_MAX_SETTLE_SPEED`, on the principle that a squat parks at the bottom while a march travels through it) was added in response, and the thresholds tuned against the full sweep.

Final results — all 14 cases pass:

| Case | SLIDE fired | Wanted |
|---|---|---|
| march 4% bob @ 2Hz | 0 | 0 |
| march 15% bob @ 2Hz | 0 | 0 |
| march 28% bob @ 2Hz | 0 | 0 |
| march 28% bob @ 1.5Hz | 0 | 0 |
| march 28% bob @ 1Hz | 0 | 0 |
| march 35% bob @ 0.8Hz | 0 | 0 |
| march 35% bob @ 0.7Hz | 0 | 0 |
| march 40% bob @ 0.6Hz | 0 | 0 |
| march 40% bob @ 0.5Hz | 0 | 0 |
| deliberate squat held 1s | 1 | 1 |
| squat held 1s, with tracking noise | 1 | 1 |
| three deliberate squats | 3 | 3 |
| shallow squat (60% of calibrated depth) | 1 | 1 |
| deep squat (130% of calibrated depth) | 1 | 1 |

**Known limit, stated honestly:** as a march becomes arbitrarily slow and deep it eventually *is* a squat, and no detector can separate them. The gates hold down to ~1 step per 2 seconds with a 40%-of-torso drop, far beyond any real marching cadence (1.5–3 steps/sec). **All of this used synthetic data — no real person on a live camera was tested**, so real-world marching styles, tracking noise characteristics, and body proportions remain unverified.

### 2c. Furniture/pose collision matrix

Each player pose was simulated against each furniture type at the collision plane, confirming every obstacle is clearable by exactly the intended action (`X` = collides):

| | standing | jumping | sliding | intended |
|---|---|---|---|---|
| OTTOMAN `[0,120]` | X | . | X | jump or lane |
| TALL `[0,420]` | X | X | X | lane only |
| TABLE `[85,430]` | X | X | . | slide or lane |

Fairness was re-verified after adding the third type: over 4 simulated minutes at `MAX_SPEED`, across 18,138 row-snapshots, **0 rows blocked all three lanes and 0 furniture spawned past the horizon**.

### 3. Code-review-level verification (traced by hand, not simulated — requires a real landmark stream)
- `gestureDetector.js`'s hysteresis state machine for lean detection: traced that a lane-change action cannot re-fire without the signal first returning under the exit threshold, and independently cannot re-fire within the cooldown window even if hysteresis alone would allow it.
- The jump detector's hold-duration requirement (`JUMP_MIN_HOLD_MS`): traced that a raise which drops back down before the hold duration elapses resets `_jumpRaiseStartedAt` to `null` and never fires — this is the mechanism that should separate a deliberate raise from an arm swing's brief pass through the same height, though its real-world reliability against an actual arm swing has not been measured (see below).
- The energy-suppression window (`GESTURE_SUPPRESSION_MS`): traced that `main.js` calls `energyTracker.suppressFor()` for every gesture-sourced action before the corresponding gameplay effect runs, and that `movementEnergy.js` skips pushing new window samples (while still updating its internal position baseline, to avoid a false velocity spike when suppression ends) while suppressed.
- The velocity-timing fix in `_onPoseResult`: confirmed by reading the code that `movementEnergy.process()` is called exactly once per real landmark update (inside the pose-tracking callback), not once per render frame — an earlier draft of this same architecture (used while developing this pattern) called it from the render loop and was found, by the same kind of code review, to double-count velocity because position updates and time updates would have decoupled at different effective rates. Fixed before delivery, not left as a known bug.

## What still requires manual/human testing (not performed)

### Full-body movement increasing and decreasing speed
- [ ] Stand in frame, march in place steadily; confirm the energy meter climbs and speed increases smoothly (not in discrete jumps).
- [ ] Stop marching; confirm energy decays back toward minimum within a few seconds, not instantly and not "stuck."
- [ ] Stand completely still for 10+ seconds; confirm speed settles at `MIN_SPEED`, never drifting to zero or negative.
- [ ] March vigorously with both arms AND legs; confirm this produces a visibly higher energy reading than arms-only marching at a similar arm tempo (tests the synergy bonus).

### Squat/duck distinguished from marching (highest-risk gesture — see 2b)
- [ ] March in place vigorously for 60+ seconds without squatting; confirm **zero** unintended slides. This is the single most important manual check in this list.
- [ ] Try a deliberately slow, heavy, exaggerated march; confirm it still doesn't trigger slides.
- [ ] Squat deliberately and hold briefly; confirm exactly one slide fires.
- [ ] Squat only halfway; confirm it still registers (thresholds are relative to *your* calibrated depth).
- [ ] In seated mode, lower your upper body; confirm it registers as a slide.
- [ ] If marching does cause false slides, raise `DUCK_ENTER_FRACTION` / `DUCK_MIN_HOLD_MS`, or lower `DUCK_MAX_SETTLE_SPEED`, and re-test.

### Arm swings distinguished from jump gestures
- [ ] Swing arms energetically (as if marching hard) for 10+ seconds; confirm no unintended JUMP actions fire.
- [ ] Deliberately raise both hands above shoulder height and hold briefly; confirm exactly one JUMP fires.
- [ ] Try a fast single-arm "swing past shoulder height" motion; confirm it does NOT trigger jump (single arm + too brief).

### Stationary players and camera jitter
- [ ] Sit/stand still in frame for 30+ seconds; confirm energy stays at/near 0 and no lane-change or jump actions fire from sensor noise.
- [ ] Test in slightly low light (more landmark jitter expected); confirm the deadzone still prevents false energy/gesture triggers.

### Different body sizes and comfortable ranges
- [ ] Test with a visibly smaller and larger person (or the same person at different distances from the camera); confirm lean thresholds still feel similarly reachable after calibration (tests shoulder-width normalization).

### Missing leg landmarks and seated-mode fallback
- [ ] In full-body mode, frame yourself so only the upper body is visible; confirm the framing screen marks knees/ankles "Not visible" and offers the seated-mode switch.
- [ ] Accept the switch; confirm gameplay continues normally using arms-only energy.
- [ ] In seated mode from the start, confirm no warning appears and legs are simply not required.

### Keyboard-only play and denied permission
- [ ] Complete a full run using only the keyboard, camera never granted.
- [ ] Confirm holding the accelerate key smoothly raises speed and releasing it smoothly lowers it, mirroring the camera-driven feel.
- [ ] Deny the camera permission prompt; confirm a clear error appears and keyboard mode remains reachable from the same screen.

### Tracking loss, pause, resume, recalibration
- [ ] Step out of frame during play; confirm auto-pause into "Tracking lost" within roughly a second, with a clear message.
- [ ] Step back in; confirm a countdown plays before gameplay resumes (not an instant jarring resume).
- [ ] Recalibrate mid-session from the pause menu; confirm it re-enters the framing/calibration flow and resumes correctly afterward.

### Fair obstacle timing at min and max speed
- [ ] At the start of a run (near `MIN_SPEED`), confirm furniture never feels impossible to react to.
- [ ] After several minutes near `MAX_SPEED`, confirm the same — furniture should feel challenging but not unfair, and at least one lane should always be visibly reachable in time.

### Collision accuracy, restart, resizing, camera cleanup
- [ ] Confirm clearing an ottoman by jumping and a cabinet by changing lanes both work; confirm jumping does NOT clear a cabinet.
- [ ] Deliberately collide; confirm the game-over screen shows correct final score/distance.
- [ ] Restart from game-over and from the pause menu; confirm score/distance/speed/energy/furniture all reset.
- [ ] Resize the browser window mid-game; confirm lanes/collision stay aligned.
- [ ] Turn off the camera from the pause menu and confirm the webcam hardware light turns off; confirm the same when quitting to the main menu or closing the tab.

## Usability-testing plan (not yet executed)

**Participants.** 3-5 people unfamiliar with the project, a mix of comfortable-standing and prefers-seated testers.

**Tasks.** (1) Start the game and reach gameplay using only on-screen instructions. (2) Complete calibration unassisted. (3) Play two runs, one full-body, one seated or keyboard. (4) Try recalibrating and adjusting sensitivity without being told how.

**Measures.**
- Calibration success on first attempt, and time-to-complete.
- Missed gestures (a clear lean/raise that didn't register) per minute of play.
- Accidental actions (unintended lane change, or a jump triggered by ordinary arm-swinging) per minute.
- Time from practice-screen start to first successful lane-change/jump (proxy for how quickly the mapping is understood).
- Post-session ratings (1-5): physical comfort/fatigue, confidence in what the camera was "seeing," and how readable/fair furniture felt to react to.
- Any reported confusion about which lean corresponds to which lane (directly tests the unverified mirroring assumption).

**What would change based on results.** `CONFIG.ENERGY` weights/lambdas and `CONFIG.GESTURE` thresholds/cooldowns would be the first things retuned; consistent "jump fires during marching" feedback would raise `JUMP_RAISE_FRACTION`/`JUMP_MIN_HOLD_MS`; consistent "reversed lanes" complaints would justify defaulting `swapLeftRight` to `true`.
