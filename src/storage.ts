import { LEVEL_COUNT } from './levels';

export interface SaveData {
  /** Number of levels unlocked (at least 1). */
  unlocked: number;
  best: number[];
  stars: number[];
  sfxMuted: boolean;
  musicMuted: boolean;
}

// Key kept from the game's former name so existing progress is not lost.
const KEY = 'shape-defense-v1';

function fresh(): SaveData {
  return { unlocked: 1, best: Array(LEVEL_COUNT).fill(0), stars: Array(LEVEL_COUNT).fill(0), sfxMuted: false, musicMuted: false };
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const parsed = JSON.parse(raw) as Partial<SaveData> & { muted?: boolean };
    const d = { ...fresh(), ...parsed } as SaveData & { muted?: boolean };
    // Older saves had a single mute switch for everything.
    if (typeof parsed.muted === 'boolean') {
      d.sfxMuted = parsed.sfxMuted ?? parsed.muted;
      d.musicMuted = parsed.musicMuted ?? parsed.muted;
      delete d.muted;
    }
    d.unlocked = Math.max(1, Math.min(LEVEL_COUNT, d.unlocked | 0));
    return d;
  } catch {
    return fresh();
  }
}

export function writeSave(d: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* storage unavailable: progress lives for this session only */
  }
}
