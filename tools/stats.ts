/**
 * Local statistics dashboard: npm run stats.
 * Reads every Umami CSV export dropped in stats/ (see stats-data.ts) and shows the game's numbers.
 */
import {
  LEVELS, buildPlayers, buildSessions, byDay, byLevel, countBy, waveBuckets,
  type DayStats, type Player, type Session,
} from './stats-data';
import { shapeSvg, type ShapeId } from '../src/shapes';

type Period = 'all' | '7' | '30' | '90';
type Metric = 'games' | 'players' | 'playTime' | 'sessions';

const EXCLUDED_KEY = 'shape-invaders-stats-excluded';

const state = {
  files: [] as string[],
  all: [] as Session[],
  period: 'all' as Period,
  metric: 'games' as Metric,
  excluded: new Set<string>(readExcluded()),
};

const app = document.getElementById('app')!;
const tip = document.getElementById('tip')!;

// ------------------------------------------------------------------ formatting

const nf = new Intl.NumberFormat('fr-FR');
const fmt = (n: number) => nf.format(Math.round(n));
const pct = (n: number) => `${Math.round(n * 100)} %`;
const short = (id: string) => id.slice(0, 8);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const dateFr = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const dayFr = (k: string) => new Date(`${k}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });

/** Seconds as « 3 h 12 min », « 12 min », « 45 s ». */
function duration(s: number): string {
  s = Math.round(s);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

const METRICS: Record<Metric, { label: string; value: (d: DayStats) => number; show: (n: number) => string }> = {
  games: { label: 'Parties', value: (d) => d.games, show: fmt },
  players: { label: 'Joueurs', value: (d) => d.players, show: fmt },
  playTime: { label: 'Temps de jeu', value: (d) => d.playTime, show: duration },
  sessions: { label: 'Sessions', value: (d) => d.sessions, show: fmt },
};

const LABELS: Record<string, string> = {
  fr: 'Français', en: 'Anglais', mobile: 'Mobile', desktop: 'Ordinateur', tablet: 'Tablette', laptop: 'Portable',
  true: 'Appli installée', false: 'Navigateur', '?': 'Inconnu',
};
const label = (k: string) => LABELS[k] ?? k;

// ------------------------------------------------------------------ data

function readExcluded(): string[] {
  try {
    return JSON.parse(localStorage.getItem(EXCLUDED_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

function saveExcluded(): void {
  try {
    localStorage.setItem(EXCLUDED_KEY, JSON.stringify([...state.excluded]));
  } catch {
    /* per-browser convenience only */
  }
}

async function load(): Promise<void> {
  app.innerHTML = '<p class="empty">Chargement…</p>';
  try {
    const res = await fetch('/__stats/files', { cache: 'no-store' });
    if (!res.ok) throw new Error(await res.text());
    const files = (await res.json()) as { name: string; text: string }[];
    state.files = files.map((f) => f.name);
    state.all = buildSessions(files);
    render();
  } catch (e) {
    app.innerHTML = `<p class="empty">Impossible de lire les exports : ${esc(String(e))}<br>Lance le tableau de bord avec <code>npm run stats</code>.</p>`;
  }
}

function inPeriod(s: Session): boolean {
  if (state.period === 'all') return true;
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - Number(state.period) + 1);
  return s.at >= from;
}

// ------------------------------------------------------------------ charts (plain SVG)

/** Bar with its data end rounded (4px) and its foot square on the baseline. */
function vBar(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function hBar(x: number, y: number, w: number, h: number): string {
  if (w <= 0) return '';
  const r = Math.min(4, h / 2, w);
  return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
}

/** A "nice" axis maximum and its ticks (whole steps: every measure here is a count or seconds). */
function ticks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw)!);
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
}

/**
 * Charts are drawn at their box's real width, so their text keeps its size on a phone:
 * the page leaves a placeholder, filled once it is laid out (and again on resize).
 */
const charts = new Map<string, (width: number) => string>();
let chartId = 0;

function chartSlot(draw: (width: number) => string): string {
  const id = `chart-${chartId++}`;
  charts.set(id, draw);
  return `<div class="chart" id="${id}"></div>`;
}

function drawCharts(): void {
  for (const [id, draw] of charts) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = draw(Math.max(240, el.clientWidth));
  }
}

/** Vertical bars, one series. `items`: label, value and tooltip. */
function columnChart(items: { label: string; value: number; tip: string }[], show: (n: number) => string, height = 220): string {
  if (!items.length) return '<p class="empty">Aucune donnée.</p>';
  return chartSlot((W) => columnSvg(items, show, height, W));
}

function columnSvg(items: { label: string; value: number; tip: string }[], show: (n: number) => string, height: number, W: number): string {
  const left = 48;
  const bottom = 24;
  const top = 8;
  const plotH = height - bottom - top;
  const t = ticks(Math.max(...items.map((i) => i.value)));
  const max = t[t.length - 1];
  const slot = (W - left) / items.length;
  const bw = Math.max(2, Math.min(36, slot - 2));
  const every = Math.ceil(items.length / Math.max(2, Math.floor((W - left) / 70)));
  let s = `<svg viewBox="0 0 ${W} ${height}" role="img">`;
  for (const v of t) {
    const y = top + plotH - (v / max) * plotH;
    s += `<line class="${v === 0 ? 'base-line' : 'grid-line'}" x1="${left}" x2="${W}" y1="${y}" y2="${y}"/>`;
    s += `<text x="${left - 6}" y="${y + 4}" text-anchor="end">${show(v)}</text>`;
  }
  items.forEach((it, i) => {
    const x = left + i * slot + (slot - bw) / 2;
    const h = (it.value / max) * plotH;
    s += `<path class="s1" d="${vBar(x, top + plotH - h, bw, h)}"/>`;
    s += `<rect class="hit" x="${left + i * slot}" y="${top}" width="${slot}" height="${plotH}" data-tip="${esc(it.tip)}"/>`;
    if (i % every === 0) s += `<text x="${x + bw / 2}" y="${height - 6}" text-anchor="middle">${esc(it.label)}</text>`;
  });
  return `${s}</svg>`;
}

/** Horizontal bars, one series, value written at the end of each bar. */
function barList(items: { label: string; value: number }[], show: (n: number) => string = fmt): string {
  if (!items.length) return '<p class="empty">Aucune donnée.</p>';
  return chartSlot((W) => barSvg(items, show, W));
}

function barSvg(items: { label: string; value: number }[], show: (n: number) => string, W: number): string {
  const row = 26;
  const labelW = 120;
  const valueW = 70;
  const max = Math.max(...items.map((i) => i.value), 1);
  const total = items.reduce((t, i) => t + i.value, 0);
  let s = `<svg viewBox="0 0 ${W} ${items.length * row}" role="img">`;
  items.forEach((it, i) => {
    const y = i * row;
    const w = (it.value / max) * (W - labelW - valueW);
    s += `<text x="0" y="${y + 17}" class="val">${esc(label(it.label))}</text>`;
    s += `<path class="s1" d="${hBar(labelW, y + 6, w, 14)}"/>`;
    s += `<text x="${labelW + w + 6}" y="${y + 17}">${show(it.value)}</text>`;
    s += `<rect class="hit" x="0" y="${y}" width="${W}" height="${row}" data-tip="<b>${esc(label(it.label))}</b> · ${show(it.value)} (${pct(total ? it.value / total : 0)})"/>`;
  });
  return `${s}</svg>`;
}

/** Section title, with one of the game's neon shapes. */
const title = (text: string, shape?: ShapeId) => `<h2>${shape ? shapeSvg(shape, 22) : ''}${esc(text)}</h2>`;

const mini = (value: number, max: number, cls: 's1' | 's2') =>
  `<span class="mini"><span class="${cls}" style="width:${max ? (value / max) * 100 : 0}%"></span></span>`;

// ------------------------------------------------------------------ page

function render(): void {
  charts.clear();
  app.innerHTML = page();
  drawCharts();
}

function page(): string {
  const period = state.all.filter(inPeriod);
  const sessions = period.filter((s) => !state.excluded.has(s.playerId));
  const players = buildPlayers(sessions);
  const allPlayers = buildPlayers(period);

  const filters = `
    <div class="filters">
      <div class="seg" role="group" aria-label="Période">
        ${(['all', '7', '30', '90'] as Period[]).map((p) => `<button data-period="${p}" aria-pressed="${state.period === p}">${p === 'all' ? 'Tout' : `${p} jours`}</button>`).join('')}
      </div>
      <button class="btn" data-action="reload">Recharger les exports</button>
      ${state.excluded.size ? `<span class="sub">${state.excluded.size} joueur${state.excluded.size > 1 ? 's' : ''} exclu${state.excluded.size > 1 ? 's' : ''} · <button class="link" data-action="include-all">Tout réafficher</button></span>` : ''}
    </div>`;

  const head = `
    <header>
      <div><h1 class="logo">Shape <span>Invaders</span></h1><div class="kicker">Statistiques des joueurs</div></div>
      <span class="sub">${state.all.length} session${state.all.length > 1 ? 's' : ''} lue${state.all.length > 1 ? 's' : ''} dans ${state.files.length} fichier${state.files.length > 1 ? 's' : ''} de <code>stats/</code>${state.all.length ? ` · du ${dateFr(state.all[0].at)} au ${dateFr(state.all[state.all.length - 1].at)}` : ''}</span>
    </header>`;

  if (!state.all.length) {
    return `${head}<div class="card"><p class="empty">Aucune session trouvée. Dépose les fichiers CSV exportés d'Umami (<code>event_data.csv</code> et <code>website_event.csv</code>) dans le dossier <code>stats/</code>, puis recharge.</p></div>`;
  }

  return head + filters + (sessions.length ? tilesHtml(sessions, players) + activityHtml(sessions) + levelsHtml(sessions, players) + endlessHtml(players) + audienceHtml(sessions, players) : '<div class="card"><p class="empty">Aucune session sur cette période.</p></div>') + playersHtml(allPlayers);
}

function tilesHtml(sessions: Session[], players: Player[]): string {
  const games = sessions.reduce((t, s) => t + s.games, 0);
  const time = sessions.reduce((t, s) => t + s.playTime, 0);
  const from = state.period === 'all' ? '' : (() => {
    const d = new Date();
    d.setDate(d.getDate() - Number(state.period) + 1);
    return d.toISOString().slice(0, 10);
  })();
  const newcomers = players.filter((p) => p.firstSeen && p.firstSeen >= from).length;
  const returning = players.filter((p) => p.visits >= 2).length;
  const pwa = sessions.filter((s) => s.pwa).length;
  const tile = (k: string, v: string, d = '') => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div>${d ? `<div class="d">${d}</div>` : ''}</div>`;
  return `<div class="tiles">
    ${tile('Joueurs', fmt(players.length), `${fmt(newcomers)} nouveau${newcomers > 1 ? 'x' : ''}`)}
    ${tile('Parties', fmt(games), `${fmt(sessions.length)} sessions`)}
    ${tile('Temps de jeu', duration(time), `${duration(time / Math.max(1, games))} par partie`)}
    ${tile('Par joueur', duration(time / Math.max(1, players.length)), `${(games / Math.max(1, players.length)).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} parties en moyenne`)}
    ${tile('Joueurs revenus', pct(returning / Math.max(1, players.length)), `${fmt(returning)} ${returning > 1 ? 'sont revenus' : 'est revenu'} jouer au moins une fois`)}
    ${tile('Appli installée', pct(pwa / Math.max(1, sessions.length)), 'des sessions')}
  </div>`;
}

function activityHtml(sessions: Session[]): string {
  const days = byDay(sessions);
  const m = METRICS[state.metric];
  const chart = columnChart(
    days.map((d) => ({ label: dayFr(d.day).replace(/\.$/, ''), value: m.value(d), tip: `<b>${dayFr(d.day)}</b> · ${m.label} : ${m.show(m.value(d))}` })),
    m.show,
  );
  const table = `<details><summary>Voir le tableau</summary><div class="table-wrap"><table>
    <thead><tr><th>Jour</th><th>Sessions</th><th>Joueurs</th><th>Parties</th><th>Temps de jeu</th></tr></thead>
    <tbody>${[...days].reverse().map((d) => `<tr><td>${dayFr(d.day)}</td><td>${fmt(d.sessions)}</td><td>${fmt(d.players)}</td><td>${fmt(d.games)}</td><td>${duration(d.playTime)}</td></tr>`).join('')}</tbody>
  </table></div></details>`;
  return `<section class="card">
    <div class="row-head">
      <div>${title('Activité par jour', 'wave')}<p class="note">Le jour où chaque résumé a été reçu.</p></div>
      <div class="seg" role="group" aria-label="Mesure">
        ${(Object.keys(METRICS) as Metric[]).map((k) => `<button data-metric="${k}" aria-pressed="${state.metric === k}">${METRICS[k].label}</button>`).join('')}
      </div>
    </div>
    ${chart}${table}
  </section>`;
}

function levelsHtml(sessions: Session[], players: Player[]): string {
  const levels = byLevel(sessions, players);
  const maxPlays = Math.max(...levels.map((l) => l.plays), 1);
  const maxCleared = Math.max(...levels.map((l) => Math.max(l.clearedNormal, l.clearedExpert)), 1);
  const rows = levels.map((l) => `<tr>
      <td>Niveau ${l.level}</td>
      <td><span class="bar-cell">${fmt(l.plays)}${mini(l.plays, maxPlays, 's1')}</span></td>
      <td>${l.plays ? pct(l.wins / l.plays) : '–'}</td>
      <td><span class="bar-cell">${fmt(l.clearedNormal)}${mini(l.clearedNormal, maxCleared, 's1')}</span></td>
      <td>${l.clearedNormal ? l.avgStarsNormal.toLocaleString('fr-FR', { maximumFractionDigits: 1 }) : '–'}</td>
      <td>${l.bestNormal ? fmt(l.bestNormal) : '–'}</td>
      <td><span class="bar-cell">${fmt(l.clearedExpert)}${mini(l.clearedExpert, maxCleared, 's2')}</span></td>
      <td>${l.bestExpert ? fmt(l.bestExpert) : '–'}</td>
    </tr>`).join('');
  return `<section class="card">
    <div class="row-head">
      <div>${title('Progression par niveau', 'square')}
      <p class="note">Parties et réussite : les deux modes ensemble. Joueurs ayant réussi, étoiles et records : d'après les records envoyés par chaque joueur.</p></div>
      <div class="legend"><span><i style="background:var(--series-1)"></i>Normal</span><span><i style="background:var(--series-2)"></i>Expert</span></div>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Niveau</th><th>Parties</th><th>Taux de réussite</th><th>Réussi (Normal)</th><th>Étoiles moy.</th><th>Record Normal</th><th>Réussi (Expert)</th><th>Record Expert</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </section>`;
}

function endlessHtml(players: Player[]): string {
  const buckets = waveBuckets(players.map((p) => p.normal.endlessWave));
  const top = (mode: 'normal' | 'expert') => {
    const list = players.filter((p) => p[mode].endlessWave > 0).sort((a, b) => b[mode].endlessWave - a[mode].endlessWave || b[mode].endlessScore - a[mode].endlessScore).slice(0, 10);
    if (!list.length) return '<p class="empty">Personne n\'a encore joué.</p>';
    return `<table><thead><tr><th>#</th><th style="text-align:left">Joueur</th><th>Vague</th><th>Score</th></tr></thead><tbody>
      ${list.map((p, i) => `<tr class="${i === 0 ? 'rank-1' : ''}"><td>${i + 1}</td><td style="text-align:left"><code>${short(p.id)}</code></td><td>${fmt(p[mode].endlessWave)}</td><td>${fmt(p[mode].endlessScore)}</td></tr>`).join('')}
    </tbody></table>`;
  };
  return `<div class="grid2" style="margin-bottom:16px">
    <section class="card">${title('Mode infini : meilleure vague', 'infinity')}<p class="note">Nombre de joueurs selon leur record de vague en Normal.</p>
      ${columnChart(buckets.map((b) => ({ label: b.label, value: b.value, tip: `<b>Vagues ${b.label}</b> · ${fmt(b.value)} joueur${b.value > 1 ? 's' : ''}` })), fmt, 200)}
    </section>
    <section class="card">${title('Classement infini · Normal', 'circle')}<div class="table-wrap">${top('normal')}</div></section>
    <section class="card">${title('Classement infini · Expert', 'zigzag')}<div class="table-wrap">${top('expert')}</div></section>
  </div>`;
}

function audienceHtml(sessions: Session[], players: Player[]): string {
  const outcomes = [
    { label: 'Niveau réussi', value: sessions.reduce((t, s) => t + s.wins, 0) },
    { label: 'Bouclier détruit', value: sessions.reduce((t, s) => t + s.losses, 0) },
    { label: 'Abandon', value: sessions.reduce((t, s) => t + s.quits, 0) },
  ];
  const modes = [
    { label: 'Campagne', value: sessions.reduce((t, s) => t + s.levelGames, 0) },
    { label: 'Mode infini', value: sessions.reduce((t, s) => t + s.endlessGames, 0) },
  ];
  const card = (title: string, note: string, body: string) => `<section class="card"><h2>${title}</h2><p class="note">${note}</p>${body}</section>`;
  return `<div class="grid2" style="margin-bottom:16px">
    ${card('Fin des parties', 'Toutes les parties de la période.', barList(outcomes))}
    ${card('Modes joués', `Dont ${fmt(sessions.reduce((t, s) => t + s.expertGames, 0))} parties en Expert.`, barList(modes))}
    ${card('Niveaux débloqués', 'Joueurs selon leur progression.', barList(countBy(players, (p) => `${p.unlocked} niveaux`).sort((a, b) => parseInt(a.label) - parseInt(b.label))))}
    ${card('Appareil', 'Joueurs, d\'après leur dernière session.', barList(countBy(players, (p) => p.device)))}
    ${card('Langue du jeu', 'Joueurs, d\'après leur dernière session.', barList(countBy(players, (p) => p.lang)))}
    ${card('Lancement', 'Sessions jouées depuis l\'appli installée ou le navigateur.', barList(countBy(sessions, (s) => String(s.pwa))))}
    ${card('Pays', 'Sessions.', barList(countBy(sessions, (s) => s.country).slice(0, 8)))}
    ${card('Système', 'Sessions.', barList(countBy(sessions, (s) => s.os).slice(0, 8)))}
  </div>`;
}

function playersHtml(players: Player[]): string {
  const list = [...players].sort((a, b) => b.last.getTime() - a.last.getTime());
  const cleared = (p: Player) => p.normal.stars.filter((s) => s > 0).length;
  return `<section class="card">
    ${title('Joueurs', 'triangle')}
    <p class="note">Exclure un joueur (toi pendant tes tests, par exemple) le retire de tous les chiffres ci-dessus. Ce choix reste mémorisé dans ce navigateur.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Joueur</th><th>Première partie</th><th>Dernière session</th><th>Visites</th><th>Sessions</th><th>Parties</th><th>Temps de jeu</th><th>Débloqués</th><th>Réussis (N / E)</th><th>Infini (vague)</th><th>Appareil</th><th>Exclure</th></tr></thead>
      <tbody>${list.map((p) => `<tr class="${state.excluded.has(p.id) ? 'excluded' : ''}">
        <td><code title="${esc(p.id)}">${short(p.id)}</code></td>
        <td>${p.firstSeen ? dayFr(p.firstSeen) : '–'}</td>
        <td>${dateFr(p.last)}</td>
        <td>${fmt(p.visits)}</td>
        <td>${fmt(p.sessions)}</td>
        <td>${fmt(p.games)}</td>
        <td>${duration(p.playTime)}</td>
        <td>${p.unlocked}/${LEVELS}</td>
        <td>${cleared(p)} / ${p.expert.stars.filter((s) => s > 0).length}</td>
        <td>${p.normal.endlessWave || '–'}${p.expert.endlessWave ? ` · E ${p.expert.endlessWave}` : ''}</td>
        <td>${esc(label(p.device))}</td>
        <td><input type="checkbox" data-exclude="${esc(p.id)}" ${state.excluded.has(p.id) ? 'checked' : ''} aria-label="Exclure ${short(p.id)}"></td>
      </tr>`).join('')}</tbody>
    </table></div>
  </section>`;
}

// ------------------------------------------------------------------ events

document.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-period],[data-metric],[data-action]');
  if (!el) return;
  if (el.dataset.period) state.period = el.dataset.period as Period;
  else if (el.dataset.metric) state.metric = el.dataset.metric as Metric;
  else if (el.dataset.action === 'reload') return void load();
  else if (el.dataset.action === 'include-all') {
    state.excluded.clear();
    saveExcluded();
  }
  render();
});

document.addEventListener('change', (e) => {
  const box = e.target as HTMLInputElement;
  const id = box.dataset.exclude;
  if (!id) return;
  if (box.checked) state.excluded.add(id);
  else state.excluded.delete(id);
  saveExcluded();
  render();
});

document.addEventListener('pointermove', (e) => {
  const el = (e.target as Element).closest?.('[data-tip]');
  if (!el) {
    tip.style.display = 'none';
    return;
  }
  tip.innerHTML = el.getAttribute('data-tip')!;
  tip.style.display = 'block';
  const r = tip.getBoundingClientRect();
  const x = Math.min(e.clientX + 14, innerWidth - r.width - 8);
  const y = e.clientY - r.height - 12 < 8 ? e.clientY + 16 : e.clientY - r.height - 12;
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
});

let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(drawCharts, 120);
});

void load();
