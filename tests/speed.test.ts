import { describe, expect, it } from 'vitest';
import { VISIBLE_SHARE, approachSpeed, edgeDistance } from '../src/levels';

const SCREENS: [string, number, number][] = [
  ['desktop', 1044, 769],
  ['phone portrait', 390, 844],
  ['phone landscape', 844, 390],
  ['tablet portrait', 820, 1180],
  ['ultrawide', 2560, 1080],
];
const HIT = 20 + 0.6 * 30; // ship radius + part of an asteroid's radius

/** Seconds an asteroid is on screen before hitting the ship, arriving from `deg`. */
function visibleTime(w: number, h: number, deg: number, travelTime = 6): number {
  const a = (deg * Math.PI) / 180;
  return (edgeDistance(a, w, h) - HIT) / approachSpeed(a, w, h, HIT, travelTime);
}

describe('asteroid speed', () => {
  it('gives the same time to react from every side, on every screen shape', () => {
    const expected = 6 * VISIBLE_SHARE;
    for (const [, w, h] of SCREENS) {
      for (let deg = 0; deg < 360; deg += 15) expect(visibleTime(w, h, deg)).toBeCloseTo(expected, 5);
    }
  });

  it('slows asteroids coming from the near sides of a tall phone', () => {
    const fromSide = approachSpeed(0, 390, 844, HIT, 6);
    const fromTop = approachSpeed(Math.PI / 2, 390, 844, HIT, 6);
    expect(fromSide).toBeLessThan(fromTop * 0.5);
  });

  it('keeps faster waves faster', () => {
    expect(approachSpeed(0.3, 390, 844, HIT, 3)).toBeGreaterThan(approachSpeed(0.3, 390, 844, HIT, 6));
  });
});
