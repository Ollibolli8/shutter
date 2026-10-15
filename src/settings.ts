/**
 * What the camera is set to, and what it does with a rotor at a given speed (no three.js here, so the page can show
 * the controls before the scene loads).
 *
 *   rpm       how fast the rotors turn
 *   readout   seconds from the first row to the last (0: a global shutter, every row at once)
 *   exposure  seconds each row collects light
 *   fps       frames the camera records a second; the readout can't be longer than a frame
 *   slow      slow motion: time runs SLOW times as fast, and the readout's progress down the frame shows
 */
export type Settings = { rpm: number; readout: number; exposure: number; fps: number; slow: boolean };
// 1/16000: a phone in daylight; at 6,325 rpm the blades turn 2.4° while a row is exposed, so they come out sharp.
export const DEFAULTS: Settings = { rpm: 6325, readout: 0.02, exposure: 1 / 16000, fps: 30, slow: false };
/** Slow motion's speed. At the default readout one pass of the sensor takes five seconds. */
export const SLOW = 1 / 250;
/** Terne X's rotors have two blades. */
export const BLADES = 2;

/**
 * What a recording shows of a rotor at this speed: how far the blades seem to move from one frame to the next, as a
 * share of the gap between blades (0 or 1: they stand still; a half: two sets of blades, one each frame; over a half:
 * they seem to turn backwards).
 */
export function apparent(rpm: number, fps: number) {
  const pass = (BLADES * rpm) / 60 / fps;
  return pass - Math.floor(pass);
}
