# Home Run — Interaction Design Document

A companion to [README.md](README.md) (how it works) and [TESTING.md](TESTING.md) (what was verified). This document covers the *design reasoning*: who it's for, what problem the interaction solves, how decisions were made, and — importantly — which claims are validated versus merely intended.

---

## 1. The design problem

Endless runners are built around a small vocabulary of discrete, high-confidence inputs: swipe left, swipe right, swipe up. Mapping those to a webcam is a solved-ish problem — you detect a gesture, you fire an event.

The harder and more interesting question, and the one this project is built around:

> **Can a continuous, effort-proportional body signal drive a continuous game variable, alongside discrete gestures, without the two interfering?**

In Home Run, *how fast you run* is not a constant and not a difficulty curve — it is a direct, continuous function of how much rhythmic arm and leg activity you're producing right now. Steering, jumping and sliding remain discrete gestures layered on top.

That combination is the actual design challenge, because the continuous signal and the discrete gestures are *read from the same body*. Raising both hands to jump is also arm movement. Squatting to slide is also vertical body motion — and so is marching. Most of the difficult decisions in this project come from disentangling those.

**Design objective:** make body-driven control feel as immediate, forgiving and legible as a keyboard — and make the system's understanding of your body continuously visible, so that when it does misread you, you can see why.

---

## 2. Personas

Three personas, each corresponding to a control mode that actually exists in the build. They are design tools, not research findings — no user research was conducted (see §8).

### Persona A — Maya, "the full-body player"
**23, design student, lives in a shared flat**

- **Context:** Laptop on a desk, about 2m of clear floor behind her chair. Plays in short bursts between study sessions. Wants something that feels physically different from the games she already plays.
- **Goals:** Wants the novelty to actually work. Wants to feel that her effort is what's driving the game, not a scripted difficulty ramp.
- **Frustrations:** Motion controls that need exaggerated, embarrassing movements. Systems that silently stop tracking and leave you flailing. Having to re-learn controls after every session.
- **What the design does for her:** Full-body mode gives the synergy bonus — arms *and* legs together produce more energy than either alone (`SYNERGY_WEIGHT`), so coordinated marching is genuinely the optimal strategy rather than a gimmick. The energy meter and hint text ("March and swing your arms to speed up!") make the causal link visible within the first second of play.
- **Decisions traceable to her:** the synergy term; the on-screen energy meter; the speed readout in the HUD; the character's glow and animation rate scaling with energy so the *avatar* also reflects effort.

### Persona B — Sam, "the seated player"
**31, works at a desk, limited floor space**

- **Context:** Plays at a desk in a small office. Can't march in place — no room, and colleagues nearby. May also have mobility considerations that make standing play impractical.
- **Goals:** Wants the full game, not a degraded "accessibility mode" with less content.
- **Frustrations:** Games that advertise body control then require a two-metre play space. Being told to stand up. Systems that pretend to track legs that are clearly not in frame.
- **What the design does for him:** Seated mode is not a separate code path — the movement-energy calculation already treats "legs not visible" as zero leg activity and works from arms alone. Every gesture (lean, two-hand raise, squat-as-lower-your-torso) is reachable seated. Crucially, if he picks full-body mode and his legs aren't visible, the framing screen **says so and offers to switch him to seated**, rather than silently pretending full-body tracking works.
- **Decisions traceable to him:** the live landmark-visibility checklist; the explicit "we can't see your legs — switch to seated?" prompt; arm-only energy working by construction rather than as a fallback; thresholds normalized to torso height so a seated, closer-to-camera body works identically.

### Persona C — Priya, "the keyboard-only player / evaluator"
**Course assessor, or any player who won't grant camera access**

- **Context:** Needs to evaluate or play the whole game without a webcam — on a machine with no camera, in a room where camera use is inappropriate, or simply declining on privacy grounds.
- **Goals:** Reach and assess every part of the game. Understand what the camera *would* do without having to enable it.
- **Frustrations:** Projects where the camera is load-bearing and the fallback is a broken stub. Being asked for camera permission before being told why.
- **What the design does for her:** Keyboard mode reaches every state and every action. Critically, the held accelerate key feeds **the same movement-energy smoothing pipeline** the camera drives (`processDirectTarget`), so keyboard speed has the same rise/decay feel rather than being a separate rule. Camera permission is only requested after a dedicated screen explains what the camera does and that video never leaves the device.
- **Decisions traceable to her:** the shared action bus (one vocabulary for both input sources); the separate permission-explanation state before any `getUserMedia` call; keyboard fallback offered at every camera failure point; the "Turn Off Camera" control in the pause menu.

---

## 3. Scenario walkthrough

**Maya's first run (full-body):**
1. **Welcome** — reads the concept and the three body controls.
2. **Mode select** — picks Full-body.
3. **Permission explanation** — learns *why* the camera is needed and that processing is local. Only then does the browser prompt appear.
4. **Framing & calibration** — the landmark checklist turns from "Not visible" to "Visible" as she steps back. She captures neutral, left lean, right lean, and a squat. The system now knows *her* range, not a generic one.
5. **Practice** — four items check off as she performs each control. No obstacles yet: she confirms the system reads her *before* anything can kill her.
6. **Countdown** — 3-2-1.
7. **Play** — marches to build speed, leans to change lanes, raises both hands to hop a cushion, squats to slide under a table.
8. **Her cat walks in front of the camera** — tracking is lost, the game auto-pauses with a recovery message, and resumes with a countdown once she's tracked again.
9. **Game over** — score and distance, restart or menu.

The ordering is deliberate: **nothing can hurt the player until the system has demonstrated it understands them.** Permission is explained before it's requested; framing before calibration; calibration before practice; practice before obstacles.

---

## 4. The interaction model

```
   camera frame
        │
        ▼
  PoseLandmarker ──► 33 landmarks + per-landmark visibility
        │
        ├──────────────► movementEnergy.js ──► continuous 0..1 "energy"
        │                 (wrists/elbows = arms, knees/ankles = legs,
        │                  normalized to shoulder width, jitter deadzone,
        │                  ~1.1s sliding-window average, synergy bonus,
        │                  asymmetric rise/decay)
        │                                              │
        │                                              ▼
        │                                    target speed = lerp(MIN, MAX, energy)
        │                                    displayed speed damped toward it
        │
        └──────────────► gestureDetector.js ──► discrete ACTIONS
                          lean          → MOVE_LEFT / MOVE_RIGHT
                          two-hand raise→ JUMP
                          squat (held)  → SLIDE
                                    │
                    keyboard.js ────┤ (same actions, same bus)
                                    ▼
                              actionBus  ── the one seam ──►  player / game state
```

The **action bus** is the central architectural idea: gameplay code cannot tell whether a command came from a body or a key. That single decision is what makes keyboard mode a genuine equal rather than a stub, and it's why adding the slide gesture late in development required no changes to gameplay logic at all.

---

## 5. Key design decisions

Each as *what / why / alternative considered / trade-off*.

### 5.1 Speed as a continuous signal, not a discrete gesture
- **What:** Running speed is a continuous function of rhythmic activity over the last ~1.1 seconds.
- **Why:** A discrete gesture answers "did an event happen"; speed needs "how much is happening lately." Using a sliding window rather than frame-to-frame displacement means the score reflects *sustained tempo*, which is both harder to trigger accidentally and a more honest mapping to "running."
- **Alternative:** A "speed boost" gesture fired repeatedly.
- **Trade-off:** Continuous control is harder to make legible — hence the meter, the hint text, and tying the avatar's animation rate and glow to it. A discrete boost would have been trivially readable but wouldn't be effort-proportional at all.

### 5.2 Asymmetric rise and decay
- **What:** Energy rises about 3x faster than it decays.
- **Why:** Effort should feel rewarded immediately; a half-second pause to reposition shouldn't feel punishing.
- **Alternative:** Symmetric smoothing.
- **Trade-off:** Slightly "floaty" — you keep speed a moment after stopping. Judged worth it for comfort; a player who stops entirely still returns to the gentle minimum.

### 5.3 Gesture-triggered energy suppression
- **What:** For ~380ms after any discrete gesture fires, the energy tracker stops accepting new samples.
- **Why:** Throwing a lean or a two-hand raise *is* body movement. Without this, every deliberate gesture would also spike your speed — the discrete and continuous channels would contaminate each other.
- **Alternative:** Subtracting gesture motion from the energy signal analytically.
- **Trade-off:** You lose a fraction of a second of genuine energy accumulation during gestures. Far simpler and more predictable than trying to decompose the motion.

### 5.4 Jump = two hands raised **and held**
- **What:** Both wrists above the shoulder line, sustained past a minimum hold.
- **Why:** An arm swing (the speed input) passes *through* the raised zone briefly; a deliberate raise stays there. Requiring two hands makes it a rarer accidental pose than one arm going up mid-swing.
- **Alternative:** Single-arm raise.
- **Trade-off:** Marginally slower to trigger. Worth it — jump would otherwise fire constantly while running.

### 5.5 Squat = depth **and** stillness **and** hold — three gates
- **What:** A squat must (1) reach a large fraction of the player's own calibrated squat depth, (2) have essentially stopped descending, and (3) hold both for ~180ms.
- **Why:** This is the highest-risk gesture in the project, because marching lowers the body on every step. **Testing proved depth and hold alone were insufficient**: a simulated slow, deep march dwelt below the depth threshold for ~278ms per step and fired a false slide on *every step* — 10 in 10 seconds. The stillness gate exists because a squat *parks* at the bottom while a march is still travelling through it.
- **Alternative:** Only depth + hold (tried, measurably failed); or dropping the gesture entirely (the original design decision, later reversed on request).
- **Trade-off:** Adds latency — the hold timer only starts once you've settled. And there's an honest limit: a sufficiently slow, deep "march" genuinely *is* a squat, and no detector can separate them. Verified to hold down to one step every two seconds, far beyond real marching cadence.

### 5.6 Difficulty decoupled from speed
- **What:** Obstacle density ramps with *distance travelled*; spacing is computed from `MAX_SPEED` (worst case), never current speed.
- **Why:** If moving faster spawned more obstacles, the player's own effort would be punished — the core mechanic would fight the difficulty curve. And computing spacing from worst-case speed means the fairness guarantee holds even if a player slams from idle to full effort while a row is already approaching.
- **Alternative:** Scale density with current speed.
- **Trade-off:** Slightly sparser furniture at low speed than strictly necessary. Verified: a scripted bot survived 20/20 three-minute runs with a mid-run instant jump from minimum to maximum speed, with zero collisions.

### 5.7 One projection function for the entire scene
- **What:** Walls, ceiling, floor tiles, doorframes, wall decor, furniture and the player all project through the same `screenXForLane` / `screenYForZ` functions.
- **Why:** An earlier build drew wall decor as a flat, independently-scrolling layer while the floor used true depth perspective. Two motion systems on screen at once read as objects drifting the wrong way and broke the illusion of a room entirely.
- **Trade-off:** Less freedom to art-direct individual layers. Worth it — visual coherence of a 3D space is not something you can fake per-element.

### 5.8 Decorative furniture must be unmistakably *not* an obstacle
- **What:** Decor sits in a widened margin beside the lanes (~208px clear at the near plane), is distance-hazed, and is drawn with outlines so it's still identifiable.
- **Why:** In a pastel palette everything is low-contrast; scenery crowding the lanes reads as something to dodge. But over-suppressing it (an earlier attempt shrank it to 72% and faded it to 55%) made it unrecognizable as furniture at all — losing the whole point of the house setting.
- **Trade-off:** A wider room means the near walls fall off-screen. That's acceptable, arguably better: you're *inside* the room rather than looking at a diorama.

---

## 6. Usability heuristics → concrete features

| Heuristic | How it's implemented |
|---|---|
| **Visibility of system status** | Live landmark checklist during framing; tracking dot + label; energy meter; speed/score/distance readout; gesture toast on every recognized action; countdown before every resume |
| **Match with the real world** | Lean left → go left; rise → jump; squat → duck. Furniture affordances match their actions: a cushion is hoppable, a table has a visible gap beneath, a full-height cabinet clearly isn't passable |
| **User control and freedom** | Pause, restart, recalibrate, sensitivity slider, swap left/right, reduced motion, turn off camera, quit — all reachable mid-session |
| **Consistency** | One action vocabulary across camera and keyboard; one icon-badge style across all obstacle types; one projection system for the whole scene |
| **Error prevention** | Hysteresis (separate enter/exit thresholds), cooldowns, hold requirements, stillness gate, vertical state-lock, low-confidence frames contribute no input |
| **Error recovery** | Auto-pause on tracking loss with a stated cause and a countdown resume; every camera failure path (denied, missing, model load failure, unsupported) names the cause and offers keyboard mode |
| **Recognition over recall** | Persistent `?` help overlay listing every control for both input methods; practice screen before any obstacle appears |
| **Aesthetic and minimalist design** | Bare wall between decor slots by design; rugs removed from the floor entirely once they competed with collectibles |

---

## 7. Accessibility

- **Three modes** so the game doesn't assume a standing, fully-mobile player with a clear two-metre space.
- **Thresholds normalized to the player's own body** (shoulder width, torso height) and to their own calibrated range, so range of motion isn't assumed.
- **Sensitivity slider** and **recalibration** for anyone the defaults don't fit.
- **Full keyboard path** through every screen and action; visible focus rings on all controls.
- **Non-color-only cues:** every obstacle carries a shape badge (up chevron / down chevron / X) in addition to its color and silhouette; the landmark checklist shows "Visible"/"Not visible" text, not just a colored dot.
- **Reduced-motion toggle**, honoring `prefers-reduced-motion` by default, which stops parallax and decorative scrolling.
- **Semantic HTML** throughout for menus and settings, with an `aria-live` region for status announcements.

---

## 8. What is validated vs. what is intended

This distinction runs through the whole project and is stated plainly because an interaction design claim without evidence is a hypothesis.

**Validated by simulation or code-level testing:**
- Duck-vs-march separation across nine marching cadences, zero false slides; real squats detected at shallow/normal/deep depths including with tracking noise (14/14 cases).
- Each obstacle is clearable by exactly its intended action (pose × furniture collision matrix).
- Fairness: 0 rows blocking all three lanes across 18,138 row-snapshots at max speed; 0 furniture spawned past the horizon; bot survives 20/20 runs through a sudden full-speed acceleration burst.
- Energy model rises to its cap under sustained effort and decays fully to zero when idle.
- Scene geometry: floor covers the full frame with sub-pixel gaps; checker pattern stays locked to the floor rather than strobing.

**Intended but NOT validated — no live camera or human subject was ever tested:**
- That the gestures feel comfortable, natural, or unfatiguing.
- That real marching (with real body proportions, lighting, and tracking noise) doesn't false-trigger the squat.
- That the lean-direction mirroring maps correctly — this was derived analytically from camera geometry, which is exactly why a **"Swap left/right" setting** ships as a field fix.
- That the energy thresholds suit a range of body types and movement styles.
- Every persona above — they are design tools, not research output.

---

## 9. Usability testing plan (not yet executed)

**Participants:** 3–5 people unfamiliar with the project, mixed between comfortable-standing and prefers-seated.

**Tasks:** reach gameplay using only on-screen instructions; complete calibration unassisted; play two runs in different modes; adjust sensitivity and recalibrate without being told how.

**Measures:**
| Measure | Why it matters |
|---|---|
| Accidental actions per minute (esp. slides while marching) | Directly tests §5.5, the highest-risk design decision |
| Missed gestures per minute | Tests whether thresholds are too conservative |
| Calibration first-attempt success + duration | Tests the framing/calibration flow |
| Time to first successful lane change / jump / slide | Proxy for how quickly the mapping is understood |
| Reported comfort and fatigue (1–5) | Tests whether sustained marching is actually sustainable |
| Confidence in "what the camera sees" (1–5) | Tests the visibility-of-status work |
| Any confusion about lean direction | Directly tests the unverified mirroring assumption |

**Pre-registered responses to findings:** consistent false slides → raise `DUCK_ENTER_FRACTION` / `DUCK_MIN_HOLD_MS`, lower `DUCK_MAX_SETTLE_SPEED`. Consistent reversed-lane reports → default `swapLeftRight` to true. Reported fatigue → lower `ENERGY_NORMALIZER` so less activity reaches full speed.

---

## 10. Known risks

1. **The squat gesture is the weakest link.** Its separation from marching is proven only against synthetic data.
2. **Pastel palette vs. legibility** is a standing tension. Obstacle badges, outlines and shading factors exist to counteract it; any future art change must preserve them.
3. **Continuous control is less legible than discrete control.** If a player never understands *why* they're slow, the core mechanic fails. The meter and hint text are the mitigation; this is the thing most worth watching in testing.
4. **Single-person tracking only** — a second person entering frame is undefined behavior.
