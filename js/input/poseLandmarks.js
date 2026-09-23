// MediaPipe Pose landmark indices used by both movementEnergy.js and
// gestureDetector.js. Centralized so the two modules (which both read the
// same raw landmark array for different purposes) never disagree about
// which index means what.
export const LM = Object.freeze({
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
});

export function isVisible(landmark, minVisibility) {
  if (!landmark) return false;
  return landmark.visibility === undefined || landmark.visibility >= minVisibility;
}
