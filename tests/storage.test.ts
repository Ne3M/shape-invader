import { beforeEach, describe, expect, it } from 'vitest';
import { loadSave, writeSave } from '../src/storage';

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Pick<Storage, 'getItem' | 'setItem'> }).localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => void store.set(k, v),
};

describe('save data', () => {
  beforeEach(() => store.clear());

  it('opens levels 1 and 2 for a new player', () => {
    expect(loadSave().unlocked).toBe(2);
  });

  it('opens level 2 for older saves that only had level 1', () => {
    store.set('shape-defense-v1', JSON.stringify({ unlocked: 1 }));
    expect(loadSave().unlocked).toBe(2);
  });

  it('keeps further progress', () => {
    store.set('shape-defense-v1', JSON.stringify({ unlocked: 6 }));
    expect(loadSave().unlocked).toBe(6);
  });

  it('starts with no records and Normal mode', () => {
    const d = loadSave();
    expect(d.expert).toBe(false);
    expect(d.normal.endlessBestWave).toBe(0);
    expect(d.expertRecords.best.every((b) => b === 0)).toBe(true);
  });

  it('moves records saved before Expert mode existed into Normal mode', () => {
    const best = [1200, 3400, 0, 0, 0, 0, 0, 0, 0, 0];
    store.set('shape-defense-v1', JSON.stringify({ unlocked: 4, best, stars: [3, 2, 0, 0, 0, 0, 0, 0, 0, 0], endlessBestWave: 14, endlessBestScore: 52000 }));
    const d = loadSave();
    expect(d.unlocked).toBe(4);
    expect(d.normal).toMatchObject({ best, endlessBestWave: 14, endlessBestScore: 52000 });
    expect(d.normal.stars[0]).toBe(3);
    expect(d.expertRecords.endlessBestWave).toBe(0);
  });

  it('keeps Normal and Expert records apart, and remembers the selected mode', () => {
    const d = loadSave();
    d.expert = true;
    d.expertRecords.endlessBestWave = 9;
    d.normal.endlessBestWave = 20;
    writeSave(d);
    const back = loadSave();
    expect(back.expert).toBe(true);
    expect(back.expertRecords.endlessBestWave).toBe(9);
    expect(back.normal.endlessBestWave).toBe(20);
  });

  it('migrates the old single mute switch', () => {
    store.set('shape-defense-v1', JSON.stringify({ unlocked: 3, muted: true }));
    const d = loadSave();
    expect(d.sfxMuted).toBe(true);
    expect(d.musicMuted).toBe(true);
  });
});
