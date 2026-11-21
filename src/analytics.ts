/**
 * Anonymous game statistics, sent to Umami (cloud.umami.is).
 *
 * To spare the free quota, nothing is sent per game: the visit's activity is added up and sent as a
 * single "session" event when the page is hidden or closed, together with the player's current
 * records for every level. The summary is also kept in localStorage, so if that last send fails
 * (closed app, offline), it goes out at the next launch with `late: true`.
 *
 * Nothing is sent while developing (localhost), or once the player turns statistics off.
 */
import type { LevelResult, RunOutcome } from './game';
import { getLang } from './i18n';
import { LEVEL_COUNT } from './levels';
import { isInstalled } from './pwa';
import { writeSave, type Records, type SaveData, type StatsInfo } from './storage';

const WEBSITE_ID = '706c5e2d-3da0-4724-91b9-2deb7a2dce51';
const SCRIPT_URL = 'https://cloud.umami.is/script.js';
const PENDING_KEY = 'shape-invaders-stats-pending';
/** Version of the event's data format. */
const FORMAT = 2;
/** The anonymous id is replaced after 13 months (CNIL rule for audience measurement). */
const ID_LIFETIME_DAYS = 395;

/** What happened during the visit (or since the last send). */
export interface Activity {
  games: number;
  playTime: number;
  wins: number;
  losses: number;
  quits: number;
  levelGames: number;
  endlessGames: number;
  expertGames: number;
  levelsPlayed: number[];
  levelsWon: number[];
  kills: number;
  bombs: number;
  bestCombo: number;
}

export type EventData = Record<string, string | number | boolean>;

export function emptyActivity(): Activity {
  return {
    games: 0, playTime: 0, wins: 0, losses: 0, quits: 0, levelGames: 0, endlessGames: 0, expertGames: 0,
    levelsPlayed: [], levelsWon: [], kills: 0, bombs: 0, bestCombo: 0,
  };
}

/** Adds one finished (or abandoned) run to the activity. */
export function addRun(a: Activity, r: LevelResult, outcome: RunOutcome): void {
  a.games++;
  a.playTime += r.duration;
  if (outcome === 'win') a.wins++;
  else if (outcome === 'loss') a.losses++;
  else a.quits++;
  if (r.endless) a.endlessGames++;
  else {
    a.levelGames++;
    a.levelsPlayed.push(r.level + 1);
    if (outcome === 'win') a.levelsWon.push(r.level + 1);
  }
  if (r.expert) a.expertGames++;
  a.kills += r.kills;
  a.bombs += r.bombs;
  a.bestCombo = Math.max(a.bestCombo, r.bestMultiplier);
}

/** Local date as YYYY-MM-DD. */
export function today(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const n = (Math.random() * 16) | 0;
    return (c === 'x' ? n : (n & 3) | 8).toString(16);
  });
}

/** Gives the player an id if they have none, or a new one once the current one is 13 months old. */
export function ensurePlayer(s: StatsInfo, date = today()): void {
  const age = s.firstSeen ? (Date.parse(date) - Date.parse(s.firstSeen)) / 86_400_000 : Infinity;
  if (s.playerId && age <= ID_LIFETIME_DAYS) return;
  s.playerId = newId();
  s.firstSeen = date;
  s.visits = 0;
}

function recordFields(prefix: 'n' | 'x', r: Records): EventData {
  const d: EventData = {};
  for (let i = 0; i < LEVEL_COUNT; i++) {
    d[`${prefix}${i + 1}Score`] = r.best[i] ?? 0;
    d[`${prefix}${i + 1}Stars`] = r.stars[i] ?? 0;
  }
  d[`${prefix}EndlessWave`] = r.endlessBestWave;
  d[`${prefix}EndlessScore`] = r.endlessBestScore;
  return d;
}

/** The "session" event's data: the activity, who played, and every current record. */
export function sessionData(save: SaveData, a: Activity, ctx: { lang: string; pwa: boolean; late: boolean }): EventData {
  return {
    v: FORMAT,
    playerId: save.stats.playerId,
    visit: save.stats.visits,
    firstSeen: save.stats.firstSeen,
    lang: ctx.lang,
    pwa: ctx.pwa,
    late: ctx.late,

    games: a.games,
    playTime: Math.round(a.playTime),
    wins: a.wins,
    losses: a.losses,
    quits: a.quits,
    levelGames: a.levelGames,
    endlessGames: a.endlessGames,
    expertGames: a.expertGames,
    levelsPlayed: a.levelsPlayed.join(','),
    levelsWon: a.levelsWon.join(','),
    kills: a.kills,
    bombs: a.bombs,
    bestCombo: a.bestCombo,

    unlocked: save.unlocked,
    ...recordFields('n', save.normal),
    ...recordFields('x', save.expertRecords),
  };
}

interface UmamiPayload {
  [key: string]: unknown;
}
interface Umami {
  track(fn: (props: UmamiPayload) => UmamiPayload): Promise<unknown> | void;
}

export class Analytics {
  /** Runs played since the last send. */
  private unsent = emptyActivity();
  private visitCounted = false;
  private umami: Promise<Umami | null> | null = null;
  /** Real sends only on the published site; otherwise the event is just logged. */
  private readonly live: boolean;

  constructor(
    private save: SaveData,
    private activeRun: () => { result: LevelResult; outcome: RunOutcome } | null,
  ) {
    const host = location.hostname;
    this.live = import.meta.env.PROD && host !== 'localhost' && host !== '127.0.0.1' && !host.endsWith('.localhost');

    // Summary of the previous visit that could not be sent.
    const pending = readPending();
    clearPending();
    if (pending && this.enabled) this.send(pending);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flush();
    });
    window.addEventListener('pagehide', () => this.flush());
  }

  get enabled(): boolean {
    return this.save.stats.enabled;
  }

  setEnabled(on: boolean): void {
    this.save.stats.enabled = on;
    writeSave(this.save);
    if (!on) {
      this.unsent = emptyActivity();
      clearPending();
    }
  }

  /** Called by the game at the end of every run. */
  runEnd(r: LevelResult, outcome: RunOutcome): void {
    if (!this.enabled) return;
    this.countVisit();
    addRun(this.unsent, r, outcome);
    this.keepPending();
  }

  /** Page hidden or closed: send what was played since the last send. */
  private flush(): void {
    if (!this.enabled) return;
    if (this.unsent.games > 0) {
      this.send(this.data(this.unsent, false));
      this.unsent = emptyActivity();
    }
    // A run still going on is saved as left midway, in case the app never comes back.
    this.keepPending();
  }

  /** Saves the unsent activity (plus the run in progress) to be sent at the next launch if needed. */
  private keepPending(): void {
    const a: Activity = { ...this.unsent, levelsPlayed: [...this.unsent.levelsPlayed], levelsWon: [...this.unsent.levelsWon] };
    const run = this.activeRun();
    if (run) {
      this.countVisit();
      addRun(a, run.result, run.outcome);
    }
    if (a.games === 0) clearPending();
    else writePending(this.data(a, true));
  }

  private countVisit(): void {
    if (this.visitCounted) return;
    this.visitCounted = true;
    ensurePlayer(this.save.stats);
    this.save.stats.visits++;
    writeSave(this.save);
  }

  private data(a: Activity, late: boolean): EventData {
    return sessionData(this.save, a, { lang: getLang(), pwa: isInstalled(), late });
  }

  private send(data: EventData): void {
    if (!this.live) {
      console.debug('[stats] session (not sent outside the published site)', data);
      return;
    }
    const playerId = String(data.playerId);
    this.loadUmami()
      .then((u) => {
        if (u) return u.track((props) => ({ ...props, id: playerId, name: 'session', data }));
        // Script unreachable (offline): keep the summary for the next launch.
        if (!readPending()) writePending({ ...data, late: true });
      })
      .catch(() => {
        /* offline or blocked: stats are optional */
      });
  }

  /** Loads Umami's script once, with automatic page views and click tracking turned off. */
  private loadUmami(): Promise<Umami | null> {
    this.umami ??= new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = SCRIPT_URL;
      s.defer = true;
      s.dataset.websiteId = WEBSITE_ID;
      s.dataset.autoTrack = 'false';
      s.onload = () => resolve((window as unknown as { umami?: Umami }).umami ?? null);
      s.onerror = () => {
        this.umami = null; // try again at the next send
        resolve(null);
      };
      document.head.appendChild(s);
    });
    return this.umami;
  }
}

function readPending(): EventData | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as EventData) : null;
  } catch {
    return null;
  }
}

function writePending(d: EventData): void {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(d));
  } catch {
    /* storage unavailable */
  }
}

function clearPending(): void {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    /* storage unavailable */
  }
}
