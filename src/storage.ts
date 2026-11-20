import { LEVEL_COUNT } from './levels';

/** Scores of one game mode (Normal or Expert), kept apart so each has its own leaderboard. */
export interface Records {
  best: number[];
  stars: number[];
  endlessBestWave: number;
  endlessBestScore: number;
}

export interface SaveData {
  /** Number of levels unlocked (at least 2). Shared by both modes. */
  unlocked: number;
  sfxMuted: boolean;
  musicMuted: boolean;
  /** Expert mode selected (shape-specific asteroid routes). */
  expert: boolean;
  normal: Records;
  expertRecords: Records;
}

// Key kept from the game's former name so existing progress is not lost.
const KEY = 'shape-defense-v1';

/** Levels open from the start: level 1 is a tutorial, level 2 is for players who want to skip it. */
const START_UNLOCKED = 2;

function freshRecords(): Records {
  return { best: Array(LEVEL_COUNT).fill(0), stars: Array(LEVEL_COUNT).fill(0), endlessBestWave: 0, endlessBestScore: 0 };
}

function fresh(): SaveData {
  return { unlocked: START_UNLOCKED, sfxMuted: false, musicMuted: false, expert: false, normal: freshRecords(), expertRecords: freshRecords() };
}

function readRecords(r: Partial<Records> | undefined): Records {
  return { ...freshRecords(), ...(r ?? {}) };
}

/** Older saves, before Expert mode: records stored at the top level, single mute switch. */
interface LegacySave extends Partial<Records> {
  muted?: boolean;
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const p = JSON.parse(raw) as Partial<SaveData> & LegacySave;
    const d = fresh();
    d.unlocked = Math.max(START_UNLOCKED, Math.min(LEVEL_COUNT, (p.unlocked ?? 0) | 0));
    d.sfxMuted = p.sfxMuted ?? p.muted ?? false;
    d.musicMuted = p.musicMuted ?? p.muted ?? false;
    d.expert = p.expert === true;
    // Records from before Expert mode existed become the Normal mode's records.
    d.normal = readRecords(
      p.normal ?? { best: p.best, stars: p.stars, endlessBestWave: p.endlessBestWave, endlessBestScore: p.endlessBestScore },
    );
    d.expertRecords = readRecords(p.expertRecords);
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
