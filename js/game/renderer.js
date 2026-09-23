import { CONFIG, PALETTE } from '../config.js';
import { FURNITURE_TYPES } from './furniture.js';
import { clamp, lerp } from '../utils.js';

// All canvas drawing lives here. Every function takes the p5 instance `p`
// plus plain data — no drawing function owns or mutates game state.

// ---- Shared helpers ---------------------------------------------------------

function fillVerticalGradient(p, yTop, yBottom, colorTop, colorBottom) {
  const ctx = p.drawingContext;
  const grad = ctx.createLinearGradient(0, yTop, 0, yBottom);
  grad.addColorStop(0, colorTop);
  grad.addColorStop(1, colorBottom);
  ctx.fillStyle = grad;
}

function fillHorizontalGradient(p, xA, xB, colorA, colorB) {
  const ctx = p.drawingContext;
  const grad = ctx.createLinearGradient(xA, 0, xB, 0);
  grad.addColorStop(0, colorA);
  grad.addColorStop(1, colorB);
  ctx.fillStyle = grad;
}

// Multiplies a color's brightness. The supplied palette is entirely pale
// pastels — several of its creams differ by only a percent or two — so
// painting the ceiling and both side walls with raw palette entries made
// the whole corridor read as one flat, undifferentiated blob with no
// perceptible room shape. Shading each surface by a different factor
// (as if lit from one side) is what makes the box read as 3D at all.
function shade(p, color, factor) {
  const c = p.color(color);
  return p.color(p.red(c) * factor, p.green(c) * factor, p.blue(c) * factor);
}

// Per-surface lighting factors, and the extra dimming applied at the far
// end of each surface for atmospheric depth.
const SHADE = { ceiling: 1.0, leftWall: 0.93, rightWall: 0.83, distance: 0.87 };

function drawGroundShadow(p, widthPx) {
  p.noStroke();
  const shadow = p.color(PALETTE.dark.black);
  shadow.setAlpha(60);
  p.fill(shadow);
  p.ellipse(0, 6, widthPx, widthPx * 0.22);
}

function hashToUnit(i, salt) {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

// A rounded, consistent icon badge used on both furniture types so the
// "what do I do here" cue reads the same way throughout the game.
function drawIconBadge(p, cy, kind) {
  p.push();
  p.translate(0, cy);
  p.noStroke();
  p.fill(0, 0, 0, 70);
  p.ellipse(2, 3, 50, 50);
  p.fill(PALETTE.pinkPeach.pink);
  p.ellipse(0, 0, 48, 48);
  p.noFill();
  p.stroke(PALETTE.dark.brown);
  p.strokeWeight(5);
  p.strokeCap(p.ROUND);
  p.strokeJoin(p.ROUND);
  if (kind === 'up') {
    p.beginShape();
    p.vertex(-12, 6);
    p.vertex(0, -8);
    p.vertex(12, 6);
    p.endShape();
  } else if (kind === 'down') {
    p.beginShape();
    p.vertex(-12, -6);
    p.vertex(0, 8);
    p.vertex(12, -6);
    p.endShape();
  } else {
    p.line(-8, -8, 8, 8);
    p.line(8, -8, -8, 8);
  }
  p.pop();
}

// ---- Background: a real 3D corridor box (floor, ceiling, two walls) -------
//
// Every element below — ceiling, walls, the far opening, windows, art,
// vines, and doorframes — is projected with world.screenXForLane /
// screenYForZ / screenCeilingYForZ: the SAME functions furniture and the
// player use. An earlier version drew wall decor as a flat band that
// scrolled sideways on its own (like a 2D parallax layer) while the floor
// and furniture used true depth perspective — those two motion systems
// disagreed with each other, which is what read as things drifting in an
// inconsistent or "wrong" direction and not looking like real architecture.
// Sharing one projection function for literally everything fixes that at
// the source: the walls now converge to the same vanishing band the floor
// and lane dividers do, so nothing can visually contradict anything else.

export function drawBackground(p, world, reducedMotion) {
  const theme = world.currentRoomTheme();
  const next = world.nextRoomTheme();
  const blend = world.transitionBlend();
  const wallColor = p.lerpColor(p.color(theme.wall), p.color(next.wall), blend);
  const wallAltColor = p.lerpColor(p.color(theme.wallAlt), p.color(next.wallAlt), blend);
  const trimColor = p.lerpColor(p.color(theme.trim), p.color(next.trim), blend);

  p.rectMode(p.CORNER);
  p.noStroke();
  p.fill(wallColor);
  p.rect(0, 0, world.width, world.height);

  drawCeiling(p, world, wallAltColor);
  drawSideWall(p, world, -1, wallColor, SHADE.leftWall);
  drawSideWall(p, world, 1, wallColor, SHADE.rightWall);
  drawFarOpening(p, world, next);
  drawWallTrim(p, world, trimColor);

  drawWallDecor(p, world, reducedMotion, -1);
  drawWallDecor(p, world, reducedMotion, 1);
  drawHangingVines(p, world, reducedMotion);
  drawDoorwayFrames(p, world, reducedMotion, trimColor);
}

// Baseboard + crown molding along the wall/floor and wall/ceiling seams.
// Without these the walls just end abruptly against the floor and ceiling
// with a bare polygon edge, which is what read as "corners not done
// properly" — a real house always has this trim. Drawn as fixed-position
// segments (thicker near the camera, like the lane dividers) rather than a
// scrolling decoration, since a seam is part of the room's geometry, not
// something that moves past the player.
function drawWallTrim(p, world, trimColor) {
  const segments = 18;
  p.stroke(trimColor);
  p.noFill();
  for (const side of [-1, 1]) {
    const u = CONFIG.WALL_LANE_UNITS * side;
    for (let i = 0; i < segments; i++) {
      const zA = (i / segments) * CONFIG.Z_FAR;
      const zB = ((i + 1) / segments) * CONFIG.Z_FAR;
      const weight = lerp(6, 0.6, i / segments);
      p.strokeWeight(weight);
      p.line(world.screenXForLane(u, zA), world.screenYForZ(zA), world.screenXForLane(u, zB), world.screenYForZ(zB));
      p.line(
        world.screenXForLane(u, zA),
        world.screenCeilingYForZ(zA),
        world.screenXForLane(u, zB),
        world.screenCeilingYForZ(zB)
      );
    }
  }
  p.noStroke();
}

function drawCeiling(p, world, ceilingColor) {
  const u = CONFIG.WALL_LANE_UNITS;
  const nearY = world.height * CONFIG.CEILING_Y_RATIO;
  const farY = world.screenCeilingYForZ(CONFIG.Z_FAR);
  const nearLeftX = world.screenXForLane(-u, 0);
  const nearRightX = world.screenXForLane(u, 0);
  const farLeftX = world.screenXForLane(-u, CONFIG.Z_FAR);
  const farRightX = world.screenXForLane(u, CONFIG.Z_FAR);

  p.noStroke();
  // Gradient spans the shape's ACTUAL vertical extent (nearY..farY). It
  // previously ran 0..nearY — a band the ceiling doesn't even occupy — so
  // the whole ceiling got the gradient's clamped end color and was flat.
  fillVerticalGradient(
    p,
    nearY,
    farY,
    shade(p, ceilingColor, SHADE.ceiling).toString(),
    shade(p, ceilingColor, SHADE.ceiling * SHADE.distance).toString()
  );
  p.beginShape();
  p.vertex(nearLeftX, nearY);
  p.vertex(nearRightX, nearY);
  p.vertex(farRightX, farY);
  p.vertex(farLeftX, farY);
  p.endShape(p.CLOSE);
}

/** @param {number} side -1 (left wall) or 1 (right wall) */
function drawSideWall(p, world, side, color, shadeFactor) {
  const u = CONFIG.WALL_LANE_UNITS * side;
  const nearTopY = world.height * CONFIG.CEILING_Y_RATIO;
  const nearBottomY = world.height * CONFIG.GROUND_Y_RATIO;
  const farTopY = world.screenCeilingYForZ(CONFIG.Z_FAR);
  const farBottomY = world.screenYForZ(CONFIG.Z_FAR);
  const nearX = world.screenXForLane(u, 0);
  const farX = world.screenXForLane(u, CONFIG.Z_FAR);

  p.noStroke();
  // On a side wall, horizontal screen position tracks depth, so a
  // horizontal gradient from the near edge to the far edge gives a cheap
  // but convincing atmospheric recession.
  fillHorizontalGradient(
    p,
    nearX,
    farX,
    shade(p, color, shadeFactor).toString(),
    shade(p, color, shadeFactor * SHADE.distance).toString()
  );
  p.beginShape();
  p.vertex(nearX, nearTopY);
  p.vertex(nearX, nearBottomY);
  p.vertex(farX, farBottomY);
  p.vertex(farX, farTopY);
  p.endShape(p.CLOSE);
}

// The far end of the corridor, glimpsed through where the walls/floor/
// ceiling converge — tinted with the NEXT room's color so the house reads
// as continuing beyond, rather than the scene simply ending at a void.
function drawFarOpening(p, world, nextTheme) {
  const u = CONFIG.WALL_LANE_UNITS;
  const topY = world.screenCeilingYForZ(CONFIG.Z_FAR);
  const bottomY = world.screenYForZ(CONFIG.Z_FAR);
  const leftX = world.screenXForLane(-u, CONFIG.Z_FAR);
  const rightX = world.screenXForLane(u, CONFIG.Z_FAR);
  p.noStroke();
  p.fill(shade(p, nextTheme.wallAlt, SHADE.distance * 0.82));
  p.rect(leftX, topY, rightX - leftX, bottomY - topY);
}

// A flat panel lying flush against a side wall: 4 corners independently
// projected (near/far edges at their own x/y, not a single translated
// rectangle), so it visually follows the wall's own perspective slant
// instead of looking like a sticker floating in front of it — this is
// what fixes windows/art "not coming in nice."
function drawWallPanel(p, world, u, zNear, zFar, topFrac, bottomFrac, color) {
  const xNear = world.screenXForLane(u, zNear);
  const xFar = world.screenXForLane(u, zFar);
  const yNearTop = lerp(world.screenCeilingYForZ(zNear), world.screenYForZ(zNear), topFrac);
  const yNearBottom = lerp(world.screenCeilingYForZ(zNear), world.screenYForZ(zNear), bottomFrac);
  const yFarTop = lerp(world.screenCeilingYForZ(zFar), world.screenYForZ(zFar), topFrac);
  const yFarBottom = lerp(world.screenCeilingYForZ(zFar), world.screenYForZ(zFar), bottomFrac);

  p.noStroke();
  p.fill(color);
  p.beginShape();
  p.vertex(xNear, yNearTop);
  p.vertex(xFar, yFarTop);
  p.vertex(xFar, yFarBottom);
  p.vertex(xNear, yNearBottom);
  p.endShape(p.CLOSE);
}

// Windows and wall art, mounted flush on the side walls at a fixed world-z
// depth (cycling like furniture rows, spaced widely so they don't flicker
// past too quickly) rather than sliding across a flat backdrop — see the
// section-level comment for why that distinction matters here.
function drawWallDecor(p, world, reducedMotion, side) {
  const u = CONFIG.WALL_LANE_UNITS * side;
  const offset = reducedMotion ? 0 : world.decorOffset;
  const spacing = CONFIG.WALL_DECOR_SPACING_Z;
  const halfDepth = 65;

  for (let i = -1; i < 5; i++) {
    const z = ((i * spacing - offset) % (CONFIG.Z_FAR + spacing) + CONFIG.Z_FAR + spacing) % (CONFIG.Z_FAR + spacing);
    // Keep clear of the player's immediate shoulder (too close to judge)
    // and the far haze (too small/indistinct to read as anything).
    if (z <= 220 || z > CONFIG.Z_FAR - 100) continue;
    const salt = i * 4 + (side > 0 ? 2 : 0);
    const kindRoll = hashToUnit(salt, 5);
    if (kindRoll > 0.7) continue; // bare wall sometimes — avoid clutter, per the brief

    const zNear = z - halfDepth;
    const zFar = z + halfDepth;

    if (kindRoll < 0.35) {
      // Window: cream frame, pale-blue glass, a soft highlight strip.
      drawWallPanel(p, world, u, zNear, zFar, 0.1, 0.62, PALETTE.cream.lightest);
      drawWallPanel(p, world, u, zNear + 10, zFar - 10, 0.14, 0.58, PALETTE.blue.sky);
      drawWallPanel(p, world, u, zNear + 10, z, 0.14, 0.58, 'rgba(255,255,255,0.35)');
    } else {
      // Wall art: dark frame, accent-colored canvas.
      const accents = [PALETTE.lilac.mid, PALETTE.pinkPeach.pink, PALETTE.blue.steel, PALETTE.pinkPeach.peach];
      const accent = accents[Math.floor(hashToUnit(salt, 6) * accents.length)];
      drawWallPanel(p, world, u, zNear, zFar, 0.2, 0.5, PALETTE.dark.brown);
      drawWallPanel(p, world, u, zNear + 8, zFar - 8, 0.225, 0.475, accent);
    }
  }
}

// Vines hang from the ceiling edge of each wall, at the same cycling z
// depths as the wall decor above, so they scale/move identically.
// A gently curved vine with a few rotated, leaf-shaped (not circular)
// accents close along the curve. An earlier version scattered several
// plain ellipses in a wide zigzag off to the side of a straight line,
// which — especially clustered near the ceiling corners, several to a
// wall — read as a loose cluster of floating circles rather than a single
// coherent plant. This is fully static per instance (no per-leaf
// animation); the only motion is the same forward approach every other
// piece of the scene has.
function drawHangingVines(p, world, reducedMotion) {
  const offset = reducedMotion ? 0 : world.decorOffset;
  const spacing = CONFIG.WALL_DECOR_SPACING_Z * 0.85;
  for (const side of [-1, 1]) {
    const u = CONFIG.WALL_LANE_UNITS * side * 0.9;
    for (let i = -1; i < 5; i++) {
      const salt = i * 5 + (side > 0 ? 3 : 0);
      if (hashToUnit(salt, 9) > 0.4) continue; // sparse — most slots stay bare wall
      const z = ((i * spacing - offset * 1.1) % (CONFIG.Z_FAR + spacing) + CONFIG.Z_FAR + spacing) % (CONFIG.Z_FAR + spacing);
      if (z <= 180 || z > CONFIG.Z_FAR - 120) continue;

      const scale = world.scaleForZ(z);
      const wallX = world.screenXForLane(u, z);
      const ceilY = world.screenCeilingYForZ(z);
      const len = 65 + hashToUnit(salt, 10) * 35;
      const bend = -side * 8; // curves in toward the room, like it's draping off the wall

      p.push();
      p.translate(wallX, ceilY);
      p.scale(scale);
      p.stroke(PALETTE.blue.graySteel);
      p.strokeWeight(2);
      p.noFill();
      p.beginShape();
      p.vertex(0, 0);
      p.quadraticVertex(bend, len * 0.55, bend * 0.4, len);
      p.endShape();

      p.noStroke();
      p.fill(PALETTE.sage);
      const leafCount = 3;
      for (let s = 1; s <= leafCount; s++) {
        const t = s / (leafCount + 0.6);
        const ly = len * t;
        const lx = bend * Math.sin(Math.PI * t * 0.9);
        p.push();
        p.translate(lx, ly);
        p.rotate((s % 2 === 0 ? 0.6 : -0.6) + bend * 0.02);
        p.ellipse(0, 0, 9, 17);
        p.pop();
      }
      p.pop();
    }
  }
}

// Periodic doorway-frame silhouettes spanning floor-to-ceiling, at fixed
// world-z intervals — a real architectural element the player passes
// through, not a flat scrolling graphic.
function drawDoorwayFrames(p, world, reducedMotion, trimColor) {
  const offset = reducedMotion ? 0 : world.scrollOffset;
  const spacing = CONFIG.DOORWAY_SPACING_Z;
  const u = CONFIG.WALL_LANE_UNITS;
  p.noStroke();
  p.fill(trimColor);
  p.rectMode(p.CORNER);
  for (let i = -1; i < 4; i++) {
    const z = ((i * spacing - offset) % (CONFIG.Z_FAR + spacing) + CONFIG.Z_FAR + spacing) % (CONFIG.Z_FAR + spacing);
    if (z <= 40 || z > CONFIG.Z_FAR) continue;
    const scale = world.scaleForZ(z);
    const floorY = world.screenYForZ(z);
    const ceilY = world.screenCeilingYForZ(z);
    const leftX = world.screenXForLane(-u, z);
    const rightX = world.screenXForLane(u, z);
    const postW = Math.max(4, 12 * scale);
    const headerH = Math.max(3, 12 * scale);

    p.rect(leftX - postW / 2, ceilY, postW, floorY - ceilY);
    p.rect(rightX - postW / 2, ceilY, postW, floorY - ceilY);
    p.rect(leftX - postW / 2, ceilY, rightX - leftX + postW, headerH);
  }
}

// ---- Floor: checkered tiles, rugs, lane dividers ---------------------------

export function drawGround(p, world, reducedMotion) {
  const theme = world.currentRoomTheme();
  const next = world.nextRoomTheme();
  const blend = world.transitionBlend();
  const toneA = p.lerpColor(p.color(theme.floor), p.color(next.floor), blend);
  // Derived from the room's own floor color rather than a fixed palette
  // entry. A hardcoded second tone happened to be byte-identical to the
  // living room's floor (#DECFBC), so in that room toneA === toneB and the
  // checkerboard disappeared entirely — the floor went flat the instant
  // the theme changed. Deriving it guarantees contrast in every room,
  // including any added later.
  const toneB = shade(p, toneA, 0.9);

  drawCheckerFloor(p, world, reducedMotion, toneA, toneB);
  drawLaneDividers(p, world, reducedMotion);
}

// A perspective-correct checkerboard, built the same way the game's own
// rows of furniture are laid out (evenly spaced in world-z, projected
// through the shared world.screenXForLane/screenYForZ functions) — this
// both reads clearly as "tiled house flooring" and gives a much stronger,
// unambiguous sense of forward motion than a single flat floor color did.
function drawCheckerFloor(p, world, reducedMotion, toneA, toneB) {
  const u = CONFIG.WALL_LANE_UNITS;
  const rows = 16;
  const cols = 8; // more columns, since the room is now considerably wider
  const rowDepth = CONFIG.Z_FAR / rows;
  const scroll = reducedMotion ? 0 : world.scrollOffset;

  p.noStroke();
  p.rectMode(p.CORNER);

  // Rows are laid out continuously and then clipped to the visible depth
  // range, rather than being wrapped individually with `% Z_FAR`. Wrapping
  // each row left the strip between the furthest row and Z_FAR uncovered —
  // a blank band at the horizon up to a full tile row (212 units) deep,
  // pulsing as the phase advanced. Verified by simulation before the fix.
  //
  // Parity is keyed to the row's ABSOLUTE position in the house
  // (`i + rowsTravelled`), not to the loop index, so the checker pattern
  // stays locked to the floor and scrolls toward the player instead of
  // flipping colors every time the row window shifts.
  const phase = scroll % rowDepth;
  const rowsTravelled = Math.floor(scroll / rowDepth);
  // Tile behind the player's plane too (negative z), so the checkerboard
  // reaches the bottom edge of the frame rather than stopping at the
  // player's feet.
  const behind = CONFIG.FLOOR_Z_BEHIND;
  const extraRows = Math.ceil(behind / rowDepth);

  for (let i = -extraRows; i <= rows + 1; i++) {
    const zFarRaw = i * rowDepth - phase;
    const zNearRaw = zFarRaw - rowDepth;
    const zFar = Math.min(zFarRaw, CONFIG.Z_FAR);
    const zNear = Math.max(zNearRaw, -behind);
    if (zFar - zNear < 0.5) continue;

    const yNear = world.screenYForZ(zNear);
    const yFar = world.screenYForZ(zFar);

    for (let c = 0; c < cols; c++) {
      const uLeft = -u + (c / cols) * (2 * u);
      const uRight = -u + ((c + 1) / cols) * (2 * u);
      const xNearLeft = world.screenXForLane(uLeft, zNear);
      const xNearRight = world.screenXForLane(uRight, zNear);
      const xFarLeft = world.screenXForLane(uLeft, zFar);
      const xFarRight = world.screenXForLane(uRight, zFar);

      // Guard the modulo: `i` is negative for the rows behind the player,
      // and JS `%` keeps the sign of the dividend.
      const parity = (((i + rowsTravelled + c) % 2) + 2) % 2;
      p.fill(parity === 0 ? toneA : toneB);
      p.beginShape();
      p.vertex(xNearLeft, yNear);
      p.vertex(xNearRight, yNear);
      p.vertex(xFarRight, yFar);
      p.vertex(xFarLeft, yFar);
      p.endShape(p.CLOSE);
    }
  }
}

function drawLaneDividers(p, world, reducedMotion) {
  const dividerUnits = [-0.5, 0.5];
  const scroll = reducedMotion ? 0 : world.scrollOffset;
  for (const u of dividerUnits) {
    const segments = 14;
    // Starts below 0 so the lane lines continue past the player to the
    // bottom of the frame, matching the floor tiles rather than being cut
    // off at the player's feet.
    const firstSegment = -Math.ceil(CONFIG.FLOOR_Z_BEHIND / (CONFIG.Z_FAR / segments));
    for (let i = firstSegment; i < segments; i++) {
      const zA = (i / segments) * CONFIG.Z_FAR + (scroll % (CONFIG.Z_FAR / segments));
      const zB = zA - (CONFIG.Z_FAR / segments) * 0.5;
      if (zB < -CONFIG.FLOOR_Z_BEHIND) continue;
      const ax = world.screenXForLane(u, zA);
      const ay = world.screenYForZ(zA);
      const bx = world.screenXForLane(u, zB);
      const by = world.screenYForZ(zB);
      p.stroke(PALETTE.dark.grayPurple);
      p.strokeWeight(p.lerp(0.4, 2.5, 1 - zA / CONFIG.Z_FAR));
      p.line(ax, ay, bx, by);
    }
  }
}

// (Floor rugs were removed deliberately: the floor is a continuous
// checkerboard with nothing overlaid on it, so nothing on the ground can be
// mistaken for a collectible or an obstacle.)

// ---- Decorative side furniture (non-playable, visually distinct) ----------
// Sits in the open space between the outermost lane and the wall, drawn
// with clear silhouettes and a soft outline so each piece is actually
// identifiable as furniture, but lower-contrast and shadowed so it never
// competes with the gameplay furniture in the lanes.

export function drawSideDecor(p, world, reducedMotion) {
  const theme = world.currentRoomTheme();
  const offset = reducedMotion ? 0 : world.decorOffset;
  const spacing = CONFIG.SIDE_DECOR_SPACING_Z;
  // Each room gets more than one kind of piece — rooms now last long
  // enough that a single repeated item would read as obviously tiled.
  const kinds = {
    corridor: ['plant', 'cabinet', 'chair'],
    living: ['sofa', 'chair', 'plant'],
    bedroom: ['bed', 'cabinet', 'plant'],
  };
  const set = kinds[theme.id] || ['plant'];

  // Sits at DECOR_LANE_UNITS: clear of the playable lanes (which end at
  // +-1) but short of the wall. Drawn near full size — an earlier version
  // shrank these to 72% and faded them to 55% opacity, which pushed them so
  // far back that they stopped being identifiable as furniture at all. The
  // separation from the lanes now comes from POSITION (a wider room), so
  // they can be drawn legibly instead of being hidden.
  const decorSide = CONFIG.DECOR_LANE_UNITS;
  for (const side of [-decorSide, decorSide]) {
    for (let i = -1; i < 5; i++) {
      const z = ((i * spacing - offset) % (CONFIG.Z_FAR + spacing) + CONFIG.Z_FAR + spacing) % (CONFIG.Z_FAR + spacing);
      if (z <= 0 || z > CONFIG.Z_FAR) continue;
      const salt = i * 3 + (side > 0 ? 1 : 0);
      const kind = set[Math.floor(hashToUnit(salt, 30) * set.length)];
      const x = world.screenXForLane(side, z);
      const y = world.screenYForZ(z);
      const scale = world.scaleForZ(z);

      p.push();
      p.translate(x, y);
      p.scale(scale);
      // Mirror the left-hand pieces so both sides face into the room.
      if (side < 0) p.scale(-1, 1);
      p.drawingContext.globalAlpha = lerp(1, 0.8, clamp(z / CONFIG.Z_FAR, 0, 1));
      drawDecorPiece(p, kind, salt);
      p.pop();
    }
  }
}

// Every decorative piece gets the same soft outline. Against pale pastel
// walls, an un-outlined pastel shape has almost no edge contrast and just
// reads as a vague blob — this is what made the side furniture hard to
// identify. One shared helper keeps the outline weight consistent across
// all of them.
function decorOutline(p) {
  p.stroke(shade(p, PALETTE.dark.grayPurple, 1));
  p.strokeWeight(2.5);
  p.strokeJoin(p.ROUND);
}

function drawDecorPiece(p, kind, salt) {
  p.rectMode(p.CENTER);
  p.noStroke();
  drawGroundShadow(p, 150);

  if (kind === 'sofa') {
    // Legs, then the seat base, a tall back, two armrests, and cushions —
    // the armrests-plus-back silhouette is what makes it read as a sofa.
    decorOutline(p);
    p.fill(PALETTE.blue.deep);
    p.rect(-58, -10, 12, 22, 3);
    p.rect(58, -10, 12, 22, 3);
    p.fill(PALETTE.blue.steel);
    p.rect(0, -92, 150, 56, 12); // backrest
    p.rect(0, -42, 160, 46, 12); // seat base
    p.fill(PALETTE.blue.deep);
    p.rect(-74, -64, 26, 70, 10); // armrests
    p.rect(74, -64, 26, 70, 10);
    p.noStroke();
    p.fill(PALETTE.pinkPeach.pink);
    p.rect(-34, -70, 40, 34, 8);
    p.rect(34, -70, 40, 34, 8);
  } else if (kind === 'chair') {
    decorOutline(p);
    p.fill(PALETTE.lilac.mauve);
    p.rect(-24, -12, 10, 26, 3); // legs
    p.rect(24, -12, 10, 26, 3);
    p.fill(PALETTE.lilac.mid);
    p.rect(0, -38, 74, 22, 6); // seat
    p.rect(0, -86, 66, 76, 12); // tall back
    p.noStroke();
    p.fill(PALETTE.lilac.pale);
    p.rect(0, -86, 44, 54, 8); // back panel inset
  } else if (kind === 'bed') {
    decorOutline(p);
    p.fill(PALETTE.pinkPeach.tan);
    p.rect(-84, -86, 18, 96, 6); // headboard
    p.fill(PALETTE.blue.pale);
    p.rect(6, -34, 182, 46, 8); // mattress
    p.fill(PALETTE.blue.steel);
    p.rect(26, -44, 140, 26, 8); // folded blanket
    p.fill(PALETTE.cream.lightest);
    p.rect(-52, -58, 56, 28, 8); // pillow
  } else if (kind === 'cabinet') {
    decorOutline(p);
    p.fill(PALETTE.blue.gray);
    p.rect(0, -74, 96, 148, 6); // body
    p.fill(PALETTE.blue.deep);
    p.rect(0, -150, 108, 12, 4); // top surface
    p.noStroke();
    p.fill(PALETTE.blue.pale);
    p.rect(-24, -74, 38, 120, 4); // two doors
    p.rect(24, -74, 38, 120, 4);
    p.fill(PALETTE.dark.brown);
    p.ellipse(-8, -74, 7, 7); // handles
    p.ellipse(8, -74, 7, 7);
  } else {
    // Plant: a tapered pot with a rim, and leaves fanning UPWARD from the
    // pot rather than orbiting a point (the old ring of rotated ellipses
    // looked like scattered blobs, not a plant).
    decorOutline(p);
    p.fill(PALETTE.pinkPeach.tan);
    p.beginShape();
    p.vertex(-26, -48);
    p.vertex(26, -48);
    p.vertex(19, 0);
    p.vertex(-19, 0);
    p.endShape(p.CLOSE);
    p.fill(PALETTE.pinkPeach.peach);
    p.rect(0, -50, 60, 14, 4); // pot rim
    p.fill(PALETTE.sage);
    const leafCount = 5;
    for (let leaf = 0; leaf < leafCount; leaf++) {
      // Fan from roughly -60deg to +60deg off vertical.
      const spread = (leaf / (leafCount - 1) - 0.5) * 2; // -1..1
      const angle = spread * 1.05;
      const len = 62 + hashToUnit(salt + leaf, 41) * 26;
      p.push();
      p.translate(0, -56);
      p.rotate(angle);
      p.ellipse(0, -len / 2, 22, len);
      p.pop();
    }
  }
  p.noStroke();
}

// ---- Gameplay furniture (obstacles) ----------------------------------------

function drawOttoman(p) {
  drawGroundShadow(p, 120);
  p.noStroke();
  fillVerticalGradient(p, -110, 0, PALETTE.lilac.pale, PALETTE.lilac.mid);
  p.rect(0, -55, 120, 110, 26);
  p.fill(PALETTE.pinkPeach.pink);
  p.ellipse(0, -108, 128, 30);
  p.fill(255, 255, 255, 90);
  p.ellipse(-25, -112, 40, 12);

  // Piped seam detail for a "cushion" read rather than a plain block.
  p.stroke(PALETTE.lilac.mauve);
  p.strokeWeight(2);
  p.noFill();
  p.ellipse(0, -108, 100, 20);
  p.noStroke();

  drawIconBadge(p, -150, 'up');
}

function drawTallFurniture(p) {
  drawGroundShadow(p, 130);
  p.noStroke();
  fillVerticalGradient(p, -400, 0, PALETTE.blue.gray, PALETTE.blue.deep);
  p.rect(0, -200, 130, 400, 10);

  // Shelf lines + a couple of "book" accents read as a bookshelf/cabinet
  // silhouette rather than a flat block.
  p.stroke(PALETTE.dark.brown);
  p.strokeWeight(3);
  for (let i = 1; i < 4; i++) {
    p.line(-58, -i * 90, 58, -i * 90);
  }
  p.noStroke();
  const bookColors = [PALETTE.pinkPeach.pink, PALETTE.blue.steel, PALETTE.pinkPeach.peach, PALETTE.lilac.mid];
  for (let shelf = 0; shelf < 3; shelf++) {
    for (let b = 0; b < 3; b++) {
      p.fill(bookColors[(shelf + b) % bookColors.length]);
      p.rect(-40 + b * 22, -70 - shelf * 90, 16, 50, 2);
    }
  }
  const shelfHighlight = p.color(PALETTE.cream.warm);
  shelfHighlight.setAlpha(90);
  p.fill(shelfHighlight);
  p.rect(0, -390, 110, 10, 4);

  drawIconBadge(p, -430, 'x');
}

// A table: a solid top at chest height on slim legs, with an obvious clear
// gap underneath. The gap is the affordance — it should read as "you can
// get under that" at a glance, the same way the ottoman reads as "you can
// hop over that."
function drawTable(p) {
  drawGroundShadow(p, 150);
  p.noStroke();

  // Legs first, so the top overlaps them.
  p.fill(PALETTE.lilac.mauveDeep);
  p.rect(-52, -55, 14, 110, 4);
  p.rect(52, -55, 14, 110, 4);

  // Table top (its underside sits at the band's lower edge, 85).
  fillVerticalGradient(p, -150, -85, PALETTE.pinkPeach.tan, PALETTE.lilac.mauveDeep);
  p.rect(0, -117, 170, 64, 8);
  p.fill(PALETTE.pinkPeach.peach);
  p.rect(0, -142, 178, 16, 6); // lighter lip along the top surface

  // A small runner + bowl, so it reads as a dressed table rather than a bar.
  p.fill(PALETTE.blue.pale);
  p.rect(0, -150, 90, 10, 4);
  p.fill(PALETTE.sage);
  p.ellipse(0, -156, 34, 16);

  drawIconBadge(p, -196, 'down');
}

export function drawFurnitureItem(p, world, item, time) {
  const laneUnits = item.lane - 1;
  const x = world.screenXForLane(laneUnits, item.z);
  const groundY = world.screenYForZ(item.z);
  const scale = world.scaleForZ(item.z);

  p.push();
  p.translate(x, groundY);
  p.scale(scale);
  p.rectMode(p.CENTER);
  p.noStroke();
  p.drawingContext.globalAlpha = clamp(item.age / CONFIG.SPAWN_FADE_IN_SECONDS, 0, 1);

  if (item.type === FURNITURE_TYPES.OTTOMAN) drawOttoman(p);
  else if (item.type === FURNITURE_TYPES.TALL) drawTallFurniture(p);
  else if (item.type === FURNITURE_TYPES.TABLE) drawTable(p);

  p.pop();
}

// ---- Collectible: a "coin" that reads clearly against the pastel scene --
// The original design used soft cream/pink tones for the coin itself,
// which are close in value to the cream walls/floor and pale furniture
// around it — easy to lose track of. This uses the palette's most
// saturated, coolest tone (steel blue) — a deliberate contrast against the
// otherwise warm cream/peach/lilac environment — plus a dark outline ring,
// which keeps it readable regardless of what's directly behind it.

export function drawCollectible(p, world, collectible, time) {
  const laneUnits = collectible.lane - 1;
  const x = world.screenXForLane(laneUnits, collectible.z);
  const groundY = world.screenYForZ(collectible.z);
  const scale = world.scaleForZ(collectible.z);
  const bob = Math.sin(time * 3 + collectible.id) * 8;
  const spin = time * 2.4 + collectible.id;

  p.push();
  p.translate(x, groundY - 120 * scale + bob * scale);
  p.scale(scale);
  p.drawingContext.globalAlpha = clamp(collectible.age / CONFIG.SPAWN_FADE_IN_SECONDS, 0, 1);

  // Soft ambient glow (kept warm, so it still reads as a friendly pickup).
  p.noStroke();
  const glow = p.color(PALETTE.pinkPeach.pink);
  glow.setAlpha(60);
  p.fill(glow);
  p.ellipse(0, 0, 52, 52);

  // The coin body itself: bold color + dark outline for contrast.
  p.stroke(PALETTE.dark.brown);
  p.strokeWeight(3);
  p.fill(PALETTE.blue.steel);
  p.ellipse(0, 0, 34, 34);

  // A rotating shine, sold with a simple width-squash rather than a
  // rotated ellipse, so it reads as a highlight sweeping across a coin
  // face rather than another circle.
  p.noStroke();
  const shineWidth = Math.abs(Math.cos(spin)) * 10 + 2;
  p.fill(255, 255, 255, 200);
  p.ellipse(0, 0, shineWidth, 26);

  p.fill(PALETTE.cream.lightest);
  p.ellipse(0, 0, 12, 12);
  p.pop();
}

// ---- Player: a simple pajama-clad runner ------------------------------------

function drawLimb(p, pivotX, pivotY, angle, width, length, color) {
  p.push();
  p.translate(pivotX, pivotY);
  p.rotate(angle);
  p.fill(color);
  p.rect(0, length / 2, width, length, width / 2);
  p.pop();
}

/** @param {number} energy 0..1, current movement energy — used only for a subtle visual glow/animation-rate cue, never for gameplay logic (that lives in main.js). */
export function drawPlayer(p, world, player, energy = 0) {
  const laneX = world.screenXForLane(player.laneX, 0);
  const groundY = world.screenYForZ(0);
  const scale = world.scaleForZ(0);
  const airborneY = -player.y;

  p.push();
  p.translate(laneX, groundY - airborneY * scale);
  p.scale(scale);

  // jumpBlend eases 0..1 across takeoff/landing (see player.js) so every
  // pose value below interpolates smoothly instead of snapping the instant
  // `mode` flips — that snap, while the body's height already arced
  // smoothly, is what made jumping look janky.
  const jb = player.jumpBlend;
  const sb = player.slideBlend;
  const bob = Math.sin(player.runCycle) * (4 + energy * 4) * (1 - jb) * (1 - sb);
  const bodyH = CONFIG.PLAYER_HEIGHT;
  const bodyW = CONFIG.PLAYER_WIDTH;
  // Legs mostly stop swinging while crouched.
  const legSwing = Math.sin(player.runCycle) * (0.6 + energy * 0.5) * (1 - sb * 0.75);

  // Shadow is drawn before the crouch squash below, so it stays a proper
  // ellipse on the floor instead of being flattened along with the body.
  drawGroundShadow(p, bodyW * 1.15);

  p.rectMode(p.CENTER);
  p.noStroke();

  // Crouch: compress the whole character toward the floor. The origin is
  // already at the feet, so a plain vertical scale pivots correctly, and
  // squashing to PLAYER_SLIDE_HEIGHT/PLAYER_HEIGHT makes the drawing match
  // the shortened collision hitbox the slide actually uses.
  p.push();
  p.scale(1, lerp(1, CONFIG.PLAYER_SLIDE_HEIGHT / CONFIG.PLAYER_HEIGHT, sb));

  // A soft energy glow behind the player that brightens with speed —
  // "character animation ... should reflect speed changes," made literal.
  if (energy > 0.05) {
    const glow = p.color(PALETTE.cream.gold2);
    glow.setAlpha(30 + energy * 50);
    p.fill(glow);
    p.ellipse(0, -bodyH * 0.55, bodyW * (1.3 + energy * 0.6), bodyH * (1.1 + energy * 0.5));
  }

  // Legs: blend between the running swing and the jump-tuck pose rather
  // than switching between them outright.
  const legLength = lerp(40, 34, jb);
  const swingA = lerp(legSwing, 0.7, jb);
  const swingB = lerp(-legSwing, -0.35, jb);
  drawLimb(p, -bodyW * 0.18, 2, swingA, 16, legLength, PALETTE.dark.grayPurple);
  drawLimb(p, bodyW * 0.18, 2, swingB, 16, legLength, PALETTE.dark.grayPurple);

  // Body (pajama top) + a contrasting sash/belt accent
  p.fill(PALETTE.blue.steel);
  p.rect(0, -bodyH / 2 + bob, bodyW, bodyH, 14);
  p.fill(PALETTE.pinkPeach.pink);
  p.rect(0, -bodyH * 0.42 + bob, bodyW * 0.9, 14, 6);

  // Arms
  const armAngle = lerp(legSwing * -0.8, 0.95, jb);
  drawLimb(p, -bodyW * 0.46, -bodyH * 0.8 + bob, -armAngle, 14, 42, PALETTE.blue.steel);
  drawLimb(p, bodyW * 0.46, -bodyH * 0.8 + bob, armAngle, 14, 42, PALETTE.blue.steel);

  // Head + soft hair shape
  p.fill(PALETTE.pinkPeach.tan);
  p.ellipse(0, -bodyH - 14 + bob, 46, 46);
  p.fill(PALETTE.dark.grayPurple);
  p.arc(0, -bodyH - 22 + bob, 48, 40, p.PI, p.TWO_PI, p.CHORD);

  p.pop(); // crouch squash
  p.pop();
}

export function drawScene(p, world, player, spawner, time, energy) {
  const sorted = [...spawner.furniture, ...spawner.collectibles].sort((a, b) => b.z - a.z);
  for (const entity of sorted) {
    if (entity.kind === 'furniture') drawFurnitureItem(p, world, entity, time);
    else drawCollectible(p, world, entity, time);
  }
  drawPlayer(p, world, player, energy);
}
