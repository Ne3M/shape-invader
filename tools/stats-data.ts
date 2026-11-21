/**
 * Turns Umami's raw CSV exports (stats/**.csv) into game statistics.
 *
 * Umami exports two tables:
 * - event_data.csv: one row per event property (event_id, data_key, string_value, number_value…)
 * - website_event.csv: one row per event (device, OS, country, distinct_id…)
 * Several exports can be dropped in stats/: rows are merged and de-duplicated by event id.
 */

export const LEVELS = 10;

export interface ModeRecords {
  scores: number[];
  stars: number[];
  endlessWave: number;
  endlessScore: number;
}

/** One "session" event: the activity since the last send, plus the player's records at that time. */
export interface Session {
  eventId: string;
  at: Date;
  playerId: string;
  visit: number;
  firstSeen: string;
  lang: string;
  pwa: boolean;
  late: boolean;
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
  unlocked: number;
  normal: ModeRecords;
  expert: ModeRecords;
  device: string;
  os: string;
  browser: string;
  country: string;
}

// ------------------------------------------------------------------ CSV

/** RFC 4180 CSV with Umami's `\N` for empty values (returned as null). */
export function parseCsv(text: string): (string | null)[][] {
  const rows: (string | null)[][] = [];
  let row: (string | null)[] = [];
  let field = '';
  let quoted = false;
  let wasQuoted = false;
  const endField = () => {
    row.push(!wasQuoted && field === '\\N' ? null : field);
    field = '';
    wasQuoted = false;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') {
      quoted = true;
      wasQuoted = true;
    } else if (c === ',') endField();
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      endField();
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || wasQuoted || row.length) {
    endField();
    rows.push(row);
  }
  return rows;
}

/** CSV rows as objects keyed by the header row. */
export function csvObjects(text: string): Record<string, string | null>[] {
  const [head, ...rows] = parseCsv(text);
  if (!head) return [];
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h ?? '', r[i] ?? null])));
}

// ------------------------------------------------------------------ sessions

/** Umami's created_at is UTC, written "YYYY-MM-DD HH:MM:SS". */
export function parseUtc(s: string | null): Date {
  return new Date(`${(s ?? '').replace(' ', 'T')}Z`);
}

const list = (s: unknown): number[] =>
  typeof s === 'string' && s.trim() ? s.split(',').map((x) => Number(x) || 0) : [];

const fill = (values: number[]) => Array.from({ length: LEVELS }, (_, i) => values[i] ?? 0);

/** Records of one mode, from format 3 lists (nScores…) or format 2 fields (n1Score…). */
function records(d: Map<string, string | number | boolean>, p: 'n' | 'x'): ModeRecords {
  const num = (k: string) => Number(d.get(k) ?? 0) || 0;
  const scores = d.has(`${p}Scores`) ? list(d.get(`${p}Scores`)) : Array.from({ length: LEVELS }, (_, i) => num(`${p}${i + 1}Score`));
  const stars = d.has(`${p}Stars`) && typeof d.get(`${p}Stars`) === 'string'
    ? list(d.get(`${p}Stars`))
    : Array.from({ length: LEVELS }, (_, i) => num(`${p}${i + 1}Stars`));
  return { scores: fill(scores), stars: fill(stars), endlessWave: num(`${p}EndlessWave`), endlessScore: num(`${p}EndlessScore`) };
}

/** Builds the sessions from every CSV file found (any mix of exports, duplicates removed). */
export function buildSessions(files: { name: string; text: string }[]): Session[] {
  const props = new Map<string, Map<string, string | number | boolean>>();
  const meta = new Map<string, { at: string | null; name: string | null }>();
  const events = new Map<string, Record<string, string | null>>();

  for (const f of files) {
    const rows = csvObjects(f.text);
    if (!rows.length) continue;
    if ('data_key' in rows[0]) {
      for (const r of rows) {
        const id = r.event_id;
        if (!id || !r.data_key) continue;
        let m = props.get(id);
        if (!m) props.set(id, (m = new Map()));
        // data_type: 1 string, 2 number, 3 boolean, 4 date.
        const v = r.data_type === '2' ? Number(r.number_value ?? r.string_value) : r.data_type === '3' ? r.string_value === 'true' : (r.string_value ?? '');
        m.set(r.data_key, v);
        if (!meta.has(id)) meta.set(id, { at: r.created_at, name: r.event_name });
      }
    } else if ('event_type' in rows[0]) {
      for (const r of rows) if (r.event_id) events.set(r.event_id, r);
    }
  }

  const sessions: Session[] = [];
  for (const [id, d] of props) {
    const m = meta.get(id)!;
    if (m.name !== 'session') continue;
    const e = events.get(id);
    const num = (k: string) => Number(d.get(k) ?? 0) || 0;
    const str = (k: string) => String(d.get(k) ?? '');
    sessions.push({
      eventId: id,
      at: parseUtc(m.at),
      playerId: str('playerId') || e?.distinct_id || e?.session_id || id,
      visit: num('visit'),
      firstSeen: str('firstSeen'),
      lang: str('lang') || '?',
      pwa: d.get('pwa') === true,
      late: d.get('late') === true,
      games: num('games'),
      playTime: num('playTime'),
      wins: num('wins'),
      losses: num('losses'),
      quits: num('quits'),
      levelGames: num('levelGames'),
      endlessGames: num('endlessGames'),
      expertGames: num('expertGames'),
      levelsPlayed: list(d.get('levelsPlayed')),
      levelsWon: list(d.get('levelsWon')),
      kills: num('kills'),
      bombs: num('bombs'),
      bestCombo: num('bestCombo'),
      unlocked: num('unlocked'),
      normal: records(d, 'n'),
      expert: records(d, 'x'),
      device: e?.device || '?',
      os: e?.os || '?',
      browser: e?.browser || '?',
      country: e?.country || '?',
    });
  }
  return sessions.sort((a, b) => a.at.getTime() - b.at.getTime());
}

// ------------------------------------------------------------------ players

export interface Player {
  id: string;
  firstSeen: string;
  first: Date;
  last: Date;
  visits: number;
  sessions: number;
  games: number;
  playTime: number;
  unlocked: number;
  /** Best records ever seen for this player (records only go up, so the element-wise max). */
  normal: ModeRecords;
  expert: ModeRecords;
  device: string;
  lang: string;
}

const maxRecords = (a: ModeRecords, b: ModeRecords): ModeRecords => ({
  scores: a.scores.map((s, i) => Math.max(s, b.scores[i])),
  stars: a.stars.map((s, i) => Math.max(s, b.stars[i])),
  endlessWave: Math.max(a.endlessWave, b.endlessWave),
  endlessScore: Math.max(a.endlessScore, b.endlessScore),
});

export function buildPlayers(sessions: Session[]): Player[] {
  const players = new Map<string, Player>();
  for (const s of sessions) {
    const p = players.get(s.playerId);
    if (!p) {
      players.set(s.playerId, {
        id: s.playerId, firstSeen: s.firstSeen, first: s.at, last: s.at, visits: s.visit, sessions: 1, games: s.games,
        playTime: s.playTime, unlocked: s.unlocked, normal: s.normal, expert: s.expert, device: s.device, lang: s.lang,
      });
      continue;
    }
    if (s.at < p.first) p.first = s.at;
    if (s.at >= p.last) {
      p.last = s.at;
      p.device = s.device;
      p.lang = s.lang;
    }
    if (s.firstSeen && (!p.firstSeen || s.firstSeen < p.firstSeen)) p.firstSeen = s.firstSeen;
    p.visits = Math.max(p.visits, s.visit);
    p.sessions++;
    p.games += s.games;
    p.playTime += s.playTime;
    p.unlocked = Math.max(p.unlocked, s.unlocked);
    p.normal = maxRecords(p.normal, s.normal);
    p.expert = maxRecords(p.expert, s.expert);
  }
  return [...players.values()];
}

// ------------------------------------------------------------------ aggregates

/** Local date YYYY-MM-DD. */
export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export interface DayStats {
  day: string;
  games: number;
  players: number;
  playTime: number;
  sessions: number;
}

/** One entry per calendar day from the first to the last session (empty days included). */
export function byDay(sessions: Session[]): DayStats[] {
  if (!sessions.length) return [];
  const days = new Map<string, { games: number; players: Set<string>; playTime: number; sessions: number }>();
  for (const s of sessions) {
    const k = dayKey(s.at);
    let d = days.get(k);
    if (!d) days.set(k, (d = { games: 0, players: new Set(), playTime: 0, sessions: 0 }));
    d.games += s.games;
    d.players.add(s.playerId);
    d.playTime += s.playTime;
    d.sessions++;
  }
  const out: DayStats[] = [];
  const end = new Date(sessions[sessions.length - 1].at);
  for (const d = new Date(sessions[0].at); dayKey(d) <= dayKey(end); d.setDate(d.getDate() + 1)) {
    const k = dayKey(d);
    const v = days.get(k);
    out.push({ day: k, games: v?.games ?? 0, players: v?.players.size ?? 0, playTime: v?.playTime ?? 0, sessions: v?.sessions ?? 0 });
  }
  return out;
}

export interface LevelStats {
  level: number;
  plays: number;
  wins: number;
  clearedNormal: number;
  clearedExpert: number;
  bestNormal: number;
  bestExpert: number;
  avgStarsNormal: number;
}

/** Per level: how often it was played and won (both modes), and how many players cleared it per mode. */
export function byLevel(sessions: Session[], players: Player[]): LevelStats[] {
  return Array.from({ length: LEVELS }, (_, i) => {
    const level = i + 1;
    let plays = 0;
    let wins = 0;
    for (const s of sessions) {
      plays += s.levelsPlayed.filter((l) => l === level).length;
      wins += s.levelsWon.filter((l) => l === level).length;
    }
    const clearedN = players.filter((p) => p.normal.stars[i] > 0);
    return {
      level,
      plays,
      wins,
      clearedNormal: clearedN.length,
      clearedExpert: players.filter((p) => p.expert.stars[i] > 0).length,
      bestNormal: Math.max(0, ...players.map((p) => p.normal.scores[i])),
      bestExpert: Math.max(0, ...players.map((p) => p.expert.scores[i])),
      avgStarsNormal: clearedN.length ? clearedN.reduce((t, p) => t + p.normal.stars[i], 0) / clearedN.length : 0,
    };
  });
}

/** Counts by a label, largest first. */
export function countBy<T>(items: T[], key: (t: T) => string, weight: (t: T) => number = () => 1): { label: string; value: number }[] {
  const m = new Map<string, number>();
  for (const it of items) m.set(key(it), (m.get(key(it)) ?? 0) + weight(it));
  return [...m].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

/** Endless best waves grouped in buckets of 5 (1–5, 6–10…), players who never played endless left out. */
export function waveBuckets(waves: number[], size = 5): { label: string; value: number }[] {
  const played = waves.filter((w) => w > 0);
  if (!played.length) return [];
  const top = Math.ceil(Math.max(...played) / size);
  return Array.from({ length: top }, (_, i) => ({
    label: `${i * size + 1}–${(i + 1) * size}`,
    value: played.filter((w) => Math.ceil(w / size) === i + 1).length,
  }));
}
