import { beforeEach, describe, expect, it } from 'vitest';
import { loadSave } from '../src/storage';

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

  it('starts with no endless record and keeps saved ones', () => {
    expect(loadSave().endlessBestWave).toBe(0);
    store.set('shape-defense-v1', JSON.stringify({ unlocked: 2, endlessBestWave: 14, endlessBestScore: 52000 }));
    expect(loadSave()).toMatchObject({ endlessBestWave: 14, endlessBestScore: 52000 });
  });

  it('migrates the old single mute switch', () => {
    store.set('shape-defense-v1', JSON.stringify({ unlocked: 3, muted: true }));
    const d = loadSave();
    expect(d.sfxMuted).toBe(true);
    expect(d.musicMuted).toBe(true);
  });
});
