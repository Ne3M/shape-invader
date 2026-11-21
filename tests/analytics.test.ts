import { describe, expect, it } from 'vitest';
import { MAX_PROPERTIES, addRun, emptyActivity, ensurePlayer, sessionData, today } from '../src/analytics';
import type { LevelResult } from '../src/game';
import { loadSave } from '../src/storage';

(globalThis as unknown as { localStorage: Pick<Storage, 'getItem' | 'setItem'> }).localStorage ??= {
  getItem: () => null,
  setItem: () => {},
};

const run = (over: Partial<LevelResult> = {}): LevelResult => ({
  level: 2, endless: false, expert: false, score: 1000, hits: 0, kills: 20, bestMultiplier: 3, stars: 3, wave: 10, duration: 61.4, bombs: 1,
  ...over,
});

describe('session statistics', () => {
  it('adds up the runs of a visit', () => {
    const a = emptyActivity();
    addRun(a, run(), 'win');
    addRun(a, run({ level: 3, expert: true, bestMultiplier: 5, duration: 30 }), 'loss');
    addRun(a, run({ level: -1, endless: true, kills: 5, bombs: 0, duration: 10 }), 'quit');
    expect(a).toMatchObject({
      games: 3, wins: 1, losses: 1, quits: 1, levelGames: 2, endlessGames: 1, expertGames: 1,
      levelsPlayed: [3, 4], levelsWon: [3], kills: 45, bombs: 2, bestCombo: 5,
    });
    expect(a.playTime).toBeCloseTo(101.4);
  });

  it('builds a flat event with the activity and every record, Normal and Expert', () => {
    const save = loadSave();
    save.stats = { enabled: true, playerId: 'abc', firstSeen: '2026-10-03', visits: 12 };
    save.normal.best[0] = 63600;
    save.normal.stars[0] = 3;
    save.expertRecords.endlessBestWave = 7;
    const a = emptyActivity();
    addRun(a, run(), 'win');
    const d = sessionData(save, a, { lang: 'fr', pwa: true, late: false });
    expect(d).toMatchObject({
      v: 3, playerId: 'abc', visit: 12, firstSeen: '2026-10-03', lang: 'fr', pwa: true, late: false,
      games: 1, playTime: 61, levelsPlayed: '3', levelsWon: '3', unlocked: 2,
      nScores: '63600,0,0,0,0,0,0,0,0,0', nStars: '3,0,0,0,0,0,0,0,0,0',
      xScores: '0,0,0,0,0,0,0,0,0,0', xEndlessWave: 7, nEndlessScore: 0,
    });
    // Only strings, numbers and booleans: Umami stores flat properties.
    expect(Object.values(d).every((v) => ['string', 'number', 'boolean'].includes(typeof v))).toBe(true);
    // Umami ignores the data of an event with more than 50 properties.
    expect(Object.keys(d)).toHaveLength(29);
    expect(Object.keys(d).length).toBeLessThanOrEqual(MAX_PROPERTIES);
  });

  it('gives a new player an id, keeps it, and renews it after 13 months', () => {
    const s = loadSave().stats;
    ensurePlayer(s, '2026-01-10');
    const id = s.playerId;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    s.visits = 5;
    ensurePlayer(s, '2026-12-31');
    expect(s.playerId).toBe(id);
    ensurePlayer(s, '2027-02-15');
    expect(s.playerId).not.toBe(id);
    expect(s).toMatchObject({ firstSeen: '2027-02-15', visits: 0 });
  });

  it('formats the local date', () => {
    expect(today(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
