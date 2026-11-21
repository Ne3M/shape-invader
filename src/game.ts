import type { Sfx } from './audio';
import {
  LEVELS,
  WAVES_PER_LEVEL,
  approachSpeed,
  edgeDistance,
  endlessNewShape,
  endlessShapes,
  makeEndlessWave,
  makeWave,
  pickWeighted,
  shuffledShapes,
  type WaveDef,
} from './levels';
import { levelName, shapeName, t } from './i18n';
import { expertCorners, expertPath, type RouteCorner } from './paths';
import { MIN_STROKE_SIZE, recognize } from './recognizer';
import { SHAPE_ORDER, SHAPES, traceGlyph, type Pt, type ShapeId } from './shapes';

/** 'sandbox' is only used by the FX lab test page (tools/fx-lab.html), never by the game. */
type State = 'menu' | 'playing' | 'paused' | 'over' | 'complete' | 'sandbox';

interface SandboxSlot {
  shape: ShapeId;
  angle: number;
  radius: number;
  ast: Asteroid | null;
  respawnAt: number;
}

/** Delay before a destroyed shape reappears in the FX lab. */
const SANDBOX_RESPAWN = 1;

interface Asteroid {
  shape: ShapeId;
  x: number;
  y: number;
  speed: number;
  r: number;
  rot: number;
  spin: number;
  rock: number[];
  age: number;
  wobble: number;
  dead: boolean;
  /** Score shown when destroyed. */
  points: number;
  /** Already hit by a blast in flight. */
  targeted: boolean;
  /** Expert mode: the shape-specific route it follows (see paths.ts). */
  path?: AsteroidPath;
}

interface AsteroidPath {
  /** Arrival direction and start distance from the ship. */
  theta0: number;
  rho0: number;
  /** Distance from the ship's center at which it hits. */
  hit: number;
  /** Progress 0 → 1, and the time the whole approach takes. */
  p: number;
  dur: number;
  side: number;
  /** Angular shapes: corners of their straight legs (null for curvy routes). */
  corners: RouteCorner[] | null;
  /** Once on screen, it is kept inside the screen. */
  entered: boolean;
}

interface Blast {
  shape: ShapeId;
  t: number;
  dur: number;
  maxR: number;
  rot: number;
  targets: Asteroid[];
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
}

interface Ghost {
  shape: ShapeId;
  x: number;
  y: number;
  r: number;
  rot: number;
  life: number;
  max: number;
}

interface Bolt {
  x: number;
  y: number;
  color: string;
  life: number;
}

interface Floater {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  max: number;
  size: number;
}

interface FadingStroke {
  pts: Pt[];
  color: string;
  life: number;
  max: number;
}

interface BgStar {
  x: number;
  y: number;
  z: number;
  tw: number;
}

export interface HudState {
  shield: number;
  score: number;
  multiplier: number;
  wave: number;
  level: number;
  shapes: ShapeId[];
  endless: boolean;
  expert: boolean;
  /** Bomb charge, 0 → 1 (ready). */
  bomb: number;
  /** Shapes left in the current wave (still to come + on screen, not yet hit), and the wave's total. */
  remaining: number;
  waveTotal: number;
}

export interface LevelResult {
  /** Level index, or -1 in endless mode. */
  level: number;
  endless: boolean;
  expert: boolean;
  score: number;
  hits: number;
  kills: number;
  bestMultiplier: number;
  stars: number;
  wave: number;
  /** Time played in seconds (pauses excluded, stops when the shield breaks). */
  duration: number;
  bombs: number;
}

/** How a run ended: level cleared, shield destroyed, or left before the end. */
export type RunOutcome = 'win' | 'loss' | 'quit';

const COOLDOWN = 0.2;
const SHIELD_MAX = 100;
const HIT_DAMAGE = 22;
const REGEN_DELAY = 2;
const REGEN_RATE = 5;
const BLAST_DUR = 0.45;
/** Seconds of play for the bomb to charge, and how long its shockwave takes to reach the screen edge. */
export const BOMB_CHARGE_TIME = 30;
const BOMB_WAVE_DUR = 0.6;
/** Points per asteroid destroyed by the bomb (no combo multiplier, no multi-kill bonus). */
const BOMB_POINTS = 100;
/** Pause after a wave is cleared, then delay before the next wave's first asteroid. */
const WAVE_BREAK = 0.8;
const WAVE_LEAD_IN = 0.6;

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export class Game {
  state: State = 'menu';
  onHud?: (h: HudState) => void;
  onLevelComplete?: (r: LevelResult) => void;
  onGameOver?: (r: LevelResult) => void;
  onBanner?: (text: string, sub?: string) => void;
  /** Every run ends here once: after onLevelComplete / onGameOver, or when it is left midway. */
  onRunEnd?: (r: LevelResult, outcome: RunOutcome) => void;

  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private cx = 0;
  private cy = 0;
  private halfDiag = 0;
  private shipR = 20;
  private astR = 30;

  private time = 0;
  private realTime = 0;
  private last = 0;

  private asteroids: Asteroid[] = [];
  private blasts: Blast[] = [];
  /** Bomb: charge 0 → 1, its expanding shockwaves, and the screen flash. */
  private bombCharge = 0;
  private shockwaves: { t: number; maxR: number; targets: Asteroid[] }[] = [];
  private flash = 0;
  private particles: Particle[] = [];
  private ghosts: Ghost[] = [];
  private bolts: Bolt[] = [];
  private floaters: Floater[] = [];
  private fading: FadingStroke[] = [];
  private stars: BgStar[] = [];

  private stroke: Pt[] | null = null;
  private strokePointer = -1;

  // Run state.
  private levelIndex = 0;
  /** Endless mode: waves never stop; the run ends when the shield is gone. */
  private endless = false;
  /** Endless: the order in which shapes join this run (shuffled per run). */
  private endlessOrder: ShapeId[] = [...SHAPE_ORDER];
  /** Expert mode: asteroids follow shape-specific routes instead of flying straight in. */
  private expert = false;
  private waveIndex = 0;
  private wave: WaveDef | null = null;
  private toSpawn = 0;
  private spawnTimer = 0;
  private breakTimer = 0;
  private endTimer = 0;
  /** Run time when the shield broke (the death animation doesn't count). */
  private deathTime = 0;
  private dying = false;
  private shield = SHIELD_MAX;
  private lastHit = -99;
  private hits = 0;
  private kills = 0;
  private score = 0;
  private streak = 0;
  private multiplier = 1;
  private bestMultiplier = 1;
  private bombs = 0;
  private cooldownUntil = 0;
  private queued: { shape: ShapeId; at: Pt } | null = null;
  private shake = 0;
  private shipAngle = -Math.PI / 2;
  private shipTargetAngle = -Math.PI / 2;
  private shipPulse = 0;
  private menuSpawn = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private sfx: Sfx,
  ) {
    this.ctx = canvas.getContext('2d')!;
    for (let i = 0; i < 170; i++) this.stars.push({ x: Math.random(), y: Math.random(), z: Math.random(), tw: Math.random() * 6 });
    this.resize();
    // The canvas's on-screen size can change without a usable window 'resize' event (phone
    // rotation, address bar showing/hiding, entering PWA full screen...). If the game kept stale
    // dimensions, the browser would stretch the old image and the ink would land far from the finger.
    // So watch the canvas itself, and also re-check every frame (see frame()).
    window.addEventListener('resize', () => this.resize());
    if ('ResizeObserver' in window) new ResizeObserver(() => this.resize()).observe(canvas);
    this.bindInput();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------------------------------------------------------------- lifecycle

  startLevel(index: number, expert = false): void {
    this.expert = expert;
    this.endless = false;
    this.levelIndex = index;
    this.startRun();
  }

  /** Endless mode: as many waves as the player can survive. */
  startEndless(expert = false, order: ShapeId[] = shuffledShapes()): void {
    this.endlessOrder = order;
    this.expert = expert;
    this.endless = true;
    this.levelIndex = -1;
    this.startRun();
  }

  /** The run being played (or paused) right now, as it would be reported if it stopped here. */
  activeRun(): { result: LevelResult; outcome: RunOutcome } | null {
    if (this.state !== 'playing' && this.state !== 'paused') return null;
    return { result: this.result(), outcome: this.dying ? 'loss' : 'quit' };
  }

  /** A run left before its end (restart, back to the menus) still gets reported. */
  private endActiveRun(): void {
    const run = this.activeRun();
    if (run) this.onRunEnd?.(run.result, run.outcome);
  }

  private startRun(): void {
    this.endActiveRun();
    this.waveIndex = 0;
    this.asteroids = [];
    this.blasts = [];
    this.bolts = [];
    this.ghosts = [];
    this.floaters = [];
    this.shield = SHIELD_MAX;
    this.lastHit = -99;
    this.hits = 0;
    this.kills = 0;
    this.score = 0;
    this.streak = 0;
    this.multiplier = 1;
    this.bestMultiplier = 1;
    this.bombs = 0;
    this.queued = null;
    this.dying = false;
    this.endTimer = 0;
    this.time = 0;
    this.cooldownUntil = 0;
    this.stroke = null;
    this.bombCharge = 0;
    this.shockwaves = [];
    this.flash = 0;
    this.state = 'playing';
    this.beginWave();
  }

  get bombReady(): boolean {
    return this.state === 'playing' && !this.dying && this.bombCharge >= 1;
  }

  /**
   * Bomb: a shockwave from the ship destroys every asteroid on screen, whatever its shape.
   * Needs a full charge (30 s of play) in a game; always available in the FX lab.
   * Returns whether it went off.
   */
  useBomb(): boolean {
    const sandbox = this.state === 'sandbox';
    if (!sandbox && !this.bombReady) return false;
    const targets = this.asteroids.filter((a) => !a.dead && !a.targeted && this.onScreen(a));
    for (const a of targets) {
      a.targeted = true;
      a.points = sandbox ? 0 : BOMB_POINTS;
    }
    if (!sandbox) {
      this.bombCharge = 0;
      this.score += targets.length * BOMB_POINTS;
      this.kills += targets.length;
      this.bombs++;
    }
    this.shockwaves.push({ t: 0, maxR: this.halfDiag * 1.1, targets });
    this.flash = 1;
    this.shake = Math.max(this.shake, 18);
    this.shipPulse = 1;
    this.sfx.bomb();
    this.floater(this.cx, this.cy - this.shipR * 3.2, targets.length ? t('fx.bombCount', { n: targets.length }) : t('fx.bomb'), '#ffffff', 24, 1.2);
    this.cancelStroke();
    return true;
  }

  private updateShockwaves(dt: number): void {
    for (const w of this.shockwaves) {
      w.t += dt;
      const k = Math.min(1, w.t / BOMB_WAVE_DUR);
      const radius = (1 - (1 - k) ** 2) * w.maxR; // fast then easing out
      let order = 0;
      for (const a of w.targets) {
        if (a.dead) continue;
        if (radius >= Math.hypot(a.x - this.cx, a.y - this.cy) - a.r) this.destroy(a, order++, false, order > 8);
      }
    }
    for (const w of this.shockwaves) {
      // Safety net: anything the wave somehow missed still goes when it ends.
      if (w.t >= BOMB_WAVE_DUR) w.targets.forEach((a, i) => !a.dead && this.destroy(a, i, false, true));
    }
    this.shockwaves = this.shockwaves.filter((w) => w.t < BOMB_WAVE_DUR + 0.35);
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.cancelStroke();
  }

  resume(): void {
    if (this.state === 'paused') this.state = 'playing';
  }

  toMenu(): void {
    this.endActiveRun();
    this.state = 'menu';
    this.asteroids = [];
    this.blasts = [];
    // A bomb set off just before leaving would otherwise stay frozen behind the menus.
    this.shockwaves = [];
    this.flash = 0;
    this.cancelStroke();
  }

  get isPlaying() {
    return this.state === 'playing';
  }

  // ---------------------------------------------------------------- FX lab (test page only)

  private slots: SandboxSlot[] = [];

  /** Stationary ring of shapes around the ship; each one comes back 1 s after being destroyed. */
  startSandbox(copies = 1, topInset = 0): void {
    this.state = 'sandbox';
    this.asteroids = [];
    this.blasts = [];
    this.queued = null;
    this.dying = false;
    this.breakTimer = 0;
    this.endTimer = 0;
    this.shield = SHIELD_MAX;
    this.cancelStroke();
    this.layoutSandbox(copies, topInset);
  }

  /** Blasts a shape exactly as if the player had drawn it. */
  /** FX lab: sends every shape at the ship along its Expert route (harmless), to check the routes. */
  sandboxParade(travelTime = 7): void {
    if (this.state !== 'sandbox') return;
    const was = this.expert;
    this.expert = true;
    SHAPE_ORDER.forEach((shape, i) => this.spawn(shape, (i / SHAPE_ORDER.length) * Math.PI * 2 + Math.PI / 8, travelTime));
    this.expert = was;
  }

  triggerShape(shape: ShapeId): void {
    if (this.state !== 'sandbox') return;
    const at = { x: this.cx, y: this.cy - this.shipR * 3 };
    if (this.time < this.cooldownUntil) this.queued = { shape, at };
    else this.fire(shape, at);
  }

  private layoutSandbox(copies: number, topInset: number): void {
    // Fit the ring (outermost copies included) in the space left free by the page's panel.
    // Copies of a shape are stacked outward; they squeeze together (down to a slight overlap)
    // rather than spill under the panel, and never get close enough to touch the ship.
    const outer = Math.min(this.w / 2, this.h / 2 - topInset) - this.astR * 1.2;
    const innerMin = this.shipR * 1.9 + this.astR * 1.2;
    const spacing = copies > 1 ? clamp((outer - innerMin) / (copies - 1), this.astR * 1.5, this.astR * 2.2) : 0;
    const inner = Math.max(innerMin, outer - spacing * (copies - 1));
    const single = Math.max(innerMin, Math.min(outer, Math.min(this.w, this.h) * 0.32));
    this.slots = [];
    SHAPE_ORDER.forEach((shape, i) => {
      const angle = -Math.PI / 2 + (i / SHAPE_ORDER.length) * Math.PI * 2;
      for (let c = 0; c < copies; c++) {
        const radius = copies === 1 ? single : inner + c * spacing;
        this.slots.push({ shape, angle, radius, ast: null, respawnAt: 0 });
      }
    });
  }

  private updateSandbox(): void {
    for (const s of this.slots) {
      if (s.ast && s.ast.dead) {
        s.ast = null;
        s.respawnAt = this.time + SANDBOX_RESPAWN;
      }
      if (!s.ast && this.time >= s.respawnAt) {
        this.spawn(s.shape, 0, 1);
        const a = this.asteroids[this.asteroids.length - 1];
        a.x = this.cx + Math.cos(s.angle) * s.radius;
        a.y = this.cy + Math.sin(s.angle) * s.radius;
        a.speed = 0;
        s.ast = a;
        this.burst(a.x, a.y, SHAPES[s.shape].color, 8, a.r * 1.5);
      }
    }
  }

  private isLastWave(index: number): boolean {
    return !this.endless && index === WAVES_PER_LEVEL - 1;
  }

  private waveTitle(index: number): string {
    return this.isLastWave(index) ? t('banner.finalWave') : t('banner.wave', { n: index + 1 });
  }

  /** Banner subtitle for a wave: progress in a level; in endless mode, any newly added shape. */
  private waveSubtitle(index: number): string {
    if (!this.endless) return t('banner.progress', { n: index + 1, total: WAVES_PER_LEVEL });
    const fresh = endlessNewShape(index, this.endlessOrder);
    return fresh ? t('banner.newShape', { shape: shapeName(fresh) }) : t('endless.name');
  }

  private currentShapes(): ShapeId[] {
    return this.endless ? endlessShapes(this.waveIndex, this.endlessOrder) : LEVELS[this.levelIndex].shapes;
  }

  /** Starts the current wave. The first wave gets a longer lead-in and its own banner;
   *  later waves were already announced when the previous one was cleared. */
  private beginWave(): void {
    this.wave = this.endless ? makeEndlessWave(this.waveIndex, Math.random, this.endlessOrder) : makeWave(this.levelIndex, this.waveIndex);
    this.toSpawn = this.wave.count;
    this.breakTimer = 0;
    if (this.waveIndex === 0) {
      this.spawnTimer = 1.4;
      this.onBanner?.(this.waveTitle(0), this.waveSubtitle(0));
    } else {
      this.spawnTimer = WAVE_LEAD_IN;
    }
  }

  private result(): LevelResult {
    const stars = this.state === 'over' || this.endless ? 0 : this.hits <= 1 ? 3 : this.hits <= 4 ? 2 : 1;
    return {
      level: this.levelIndex,
      endless: this.endless,
      expert: this.expert,
      score: this.score,
      hits: this.hits,
      kills: this.kills,
      bestMultiplier: this.bestMultiplier,
      stars,
      wave: this.waveIndex + 1,
      duration: this.dying ? this.deathTime : this.time,
      bombs: this.bombs,
    };
  }

  // ---------------------------------------------------------------- input

  private bindInput(): void {
    const c = this.canvas;
    // Map from the canvas's displayed size to the game's coordinates, so the ink stays under the
    // finger even during the frame before a size change has been picked up.
    const pos = (e: PointerEvent): Pt => {
      const r = c.getBoundingClientRect();
      return {
        x: ((e.clientX - r.left) * this.w) / (r.width || this.w),
        y: ((e.clientY - r.top) * this.h) / (r.height || this.h),
      };
    };
    c.addEventListener('pointerdown', (e) => {
      if ((this.state !== 'playing' && this.state !== 'sandbox') || this.dying || this.stroke) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      this.sfx.unlock();
      try {
        c.setPointerCapture(e.pointerId);
      } catch {
        /* capture is a nicety; drawing works without it */
      }
      this.strokePointer = e.pointerId;
      this.stroke = [pos(e)];
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.stroke || e.pointerId !== this.strokePointer) return;
      e.preventDefault();
      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      if (events.length) for (const ev of events) this.stroke.push(pos(ev));
      else this.stroke.push(pos(e));
    });
    const end = (e: PointerEvent) => {
      if (!this.stroke || e.pointerId !== this.strokePointer) return;
      const pts = this.stroke;
      this.stroke = null;
      this.strokePointer = -1;
      if ((this.state === 'playing' || this.state === 'sandbox') && !this.dying) this.handleStroke(pts);
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', () => this.cancelStroke());
    c.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private cancelStroke(): void {
    this.stroke = null;
    this.strokePointer = -1;
  }

  private handleStroke(pts: Pt[]): void {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, sx = 0, sy = 0;
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      sx += p.x; sy += p.y;
    }
    if (Math.max(maxX - minX, maxY - minY) < MIN_STROKE_SIZE) {
      // A tap. In the FX lab, tapping a shape blasts it.
      if (this.state === 'sandbox') {
        const p = pts[pts.length - 1];
        const hit = this.asteroids.find((a) => !a.dead && !a.targeted && Math.hypot(a.x - p.x, a.y - p.y) < a.r * 1.2);
        if (hit) this.triggerShape(hit.shape);
      }
      return;
    }
    const at = { x: sx / pts.length, y: sy / pts.length };
    const res = recognize(pts);
    const color = res.shape ? SHAPES[res.shape].color : '#8a90a8';
    this.fading.push({ pts, color, life: 0.5, max: 0.5 });

    if (!res.shape) {
      this.misfire(at, '?');
      return;
    }
    if (this.time < this.cooldownUntil) this.queued = { shape: res.shape, at };
    else this.fire(res.shape, at);
  }

  // ---------------------------------------------------------------- combat

  private onScreen(a: Asteroid): boolean {
    const m = a.r * 0.4;
    return a.x > -m && a.x < this.w + m && a.y > -m && a.y < this.h + m;
  }

  private fire(shape: ShapeId, at: Pt, attract = false): void {
    const info = SHAPES[shape];
    const targets = this.asteroids.filter((a) => !a.dead && !a.targeted && a.shape === shape && this.onScreen(a));

    if (!attract) {
      this.cooldownUntil = this.time + COOLDOWN;
      if (this.breakTimer > 0 || this.endTimer > 0) {
        // Between waves: just show what was recognized, no penalty.
        this.floater(at.x, at.y - 20, shapeName(shape), info.color, 16);
        return;
      }
      if (!targets.length) {
        this.misfire(at, t(`shape.${shape}.none`));
        return;
      }
    }
    if (!targets.length) return;

    let maxD = 0;
    let nearest = targets[0];
    let nearestD = Infinity;
    for (const a of targets) {
      a.targeted = true;
      const d = Math.hypot(a.x - this.cx, a.y - this.cy);
      maxD = Math.max(maxD, d + a.r);
      if (d < nearestD) { nearestD = d; nearest = a; }
      this.bolts.push({ x: a.x, y: a.y, color: info.color, life: 0.22 });
    }
    this.blasts.push({ shape, t: 0, dur: BLAST_DUR, maxR: Math.max(this.halfDiag * 1.05, maxD), rot: this.shipAngle + Math.PI / 2, targets });
    this.shipTargetAngle = Math.atan2(nearest.y - this.cy, nearest.x - this.cx);
    this.shipPulse = 1;

    if (attract) return;
    this.sfx.blast();
    this.floater(at.x, at.y - 20, shapeName(shape), info.color, 15);

    const n = targets.length;
    const mult = this.multiplier;
    const each = 100 * mult;
    const bonus = n >= 2 ? 50 * n * (n - 1) * mult : 0;
    this.score += n * each + bonus;
    this.kills += n;
    for (const a of targets) a.points = each;
    if (bonus) {
      const label = n === 2 ? t('fx.double') : n === 3 ? t('fx.triple') : n === 4 ? t('fx.quad') : t('fx.multi', { n });
      this.floater(this.cx, this.cy - this.shipR * 3.2, `${label} +${bonus}`, info.color, 22, 1.3);
    }
    this.streak++;
    const newMult = Math.min(5, 1 + Math.floor(this.streak / 2));
    if (newMult > this.multiplier) this.floater(this.cx, this.cy + this.shipR * 3.4, t('fx.combo', { n: newMult }), '#ffffff', 18, 1.1);
    this.multiplier = newMult;
    this.bestMultiplier = Math.max(this.bestMultiplier, newMult);
  }

  private misfire(at: Pt, label: string): void {
    this.sfx.misfire();
    if (this.multiplier > 1) this.floater(this.cx, this.cy + this.shipR * 3.4, t('fx.comboLost'), '#8a90a8', 16);
    this.streak = 0;
    this.multiplier = 1;
    this.floater(at.x, at.y - 20, label, '#8a90a8', 16);
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(20, 90);
      this.particles.push({ x: at.x, y: at.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.4, max: 0.4, color: '#8a90a8', size: 2 });
    }
  }

  /** `silent`: no sound (a bomb clearing many asteroids plays only the first few, to stay listenable). */
  private destroy(a: Asteroid, order: number, attract: boolean, silent = false): void {
    a.dead = true;
    const color = SHAPES[a.shape].color;
    this.ghosts.push({ shape: a.shape, x: a.x, y: a.y, r: a.r, rot: a.rot, life: 0.45, max: 0.45 });
    this.burst(a.x, a.y, color, 22, a.r * 4);
    this.burst(a.x, a.y, '#ffffff', 6, a.r * 3);
    if (!attract) {
      if (!silent) this.sfx.explode(a.shape, order);
      const pts = a.points;
      if (pts) this.floater(a.x, a.y, `+${pts}`, color, 15);
    }
  }

  private burst(x: number, y: number, color: string, n: number, speed: number): void {
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const s = rand(0.2, 1) * speed;
      const life = rand(0.35, 0.8);
      this.particles.push({ x, y, vx: Math.cos(ang) * s, vy: Math.sin(ang) * s, life, max: life, color, size: rand(1.5, 3.5) });
    }
  }

  private shipHit(a: Asteroid): void {
    a.dead = true;
    if (this.state === 'sandbox') {
      // FX lab: arriving shapes just pop, no damage.
      this.burst(a.x, a.y, SHAPES[a.shape].color, 16, a.r * 3);
      return;
    }
    this.sfx.hit();
    this.hits++;
    this.shield = Math.max(0, this.shield - HIT_DAMAGE);
    this.lastHit = this.time;
    this.shake = 16;
    if (this.multiplier > 1) this.floater(this.cx, this.cy + this.shipR * 3.4, t('fx.comboLost'), '#ff4f64', 16);
    this.streak = 0;
    this.multiplier = 1;
    this.burst(a.x, a.y, '#ff4f64', 26, a.r * 4);
    this.burst(a.x, a.y, SHAPES[a.shape].color, 10, a.r * 3);
    if (this.shield <= 0) this.die();
  }

  private die(): void {
    this.dying = true;
    this.deathTime = this.time;
    this.endTimer = 1.6;
    this.cancelStroke();
    this.sfx.gameOver();
    this.burst(this.cx, this.cy, '#ffffff', 40, 260);
    this.burst(this.cx, this.cy, '#3df5ff', 50, 200);
    this.asteroids.forEach((a, i) => {
      if (!a.dead && this.onScreen(a)) this.destroy(a, i, true);
    });
    this.asteroids = [];
  }

  private floater(x: number, y: number, text: string, color: string, size: number, life = 0.9): void {
    this.floaters.push({ x, y, text, color, size, life, max: life });
  }

  private spawn(shape: ShapeId, angle: number, travelTime: number, extraDist = 0): void {
    const r = this.astR * rand(0.9, 1.1);
    // Speed matches the distance from this side of the screen to the ship, so every asteroid stays
    // visible for the same time whatever side it comes from (on a tall phone, the sides are close).
    const speed = approachSpeed(angle, this.w, this.h, this.shipR + r * 0.6, travelTime) * rand(0.9, 1.1);
    // Spawn just past the screen edge in that direction, so no time is spent travelling unseen;
    // ~0.5 s of margin lets the edge indicator warn the player.
    const dist = edgeDistance(angle, this.w, this.h) + r + Math.max(24, speed * 0.5) + extraDist;
    const rock = Array.from({ length: 9 }, () => rand(0.82, 1.08));
    this.asteroids.push({
      shape,
      x: this.cx + Math.cos(angle) * dist,
      y: this.cy + Math.sin(angle) * dist,
      speed,
      r,
      rot: rand(0, Math.PI * 2),
      spin: rand(-0.8, 0.8),
      rock,
      age: rand(0, 10),
      wobble: rand(-1, 1),
      dead: false,
      targeted: false,
      points: 0,
    });
    // Expert mode: follow the shape's route, staying on screen exactly as long as a straight run would.
    if (this.expert && this.state !== 'menu') {
      const a = this.asteroids[this.asteroids.length - 1];
      const hit = this.shipR + r * 0.6;
      const side = Math.random() < 0.5 ? 1 : -1;
      const path: AsteroidPath = { theta0: angle, rho0: dist, hit, p: 0, dur: 1, side, corners: expertCorners(shape, side), entered: false };
      // Time a Normal-mode run spends on screen (it counts as visible once it overlaps the edge by 0.4 r).
      const visibleTarget = (edgeDistance(angle, this.w, this.h) + r * 0.4 - hit) / speed;
      const { enter, impact } = this.routeVisibleSpan(a, path);
      path.dur = visibleTarget / Math.max(0.2, impact - enter);
      a.path = path;
    }
  }

  /**
   * Walks an Expert route ahead of time to find where (as progress 0–1) the asteroid comes on screen
   * and where it reaches the ship. The route's duration is then set so the on-screen part lasts as
   * long as in Normal mode, whatever the shape: a spiral that skims the edges, or a staircase.
   */
  private routeVisibleSpan(a: Asteroid, path: AsteroidPath): { enter: number; impact: number } {
    const probe = { ...a };
    let entered = false;
    let enter = 0;
    const steps = 240;
    for (let i = 0; i <= steps; i++) {
      const p = i / steps;
      const pos = this.routePoint(probe, path, p, entered);
      probe.x = pos.x;
      probe.y = pos.y;
      if (!entered && this.onScreen(probe)) {
        entered = true;
        enter = p;
      }
      if (entered && Math.hypot(pos.x - this.cx, pos.y - this.cy) < path.hit) return { enter, impact: p };
    }
    return { enter, impact: 1 };
  }

  /** Screen position on an Expert route at progress `p`. `keepOnScreen` stops it slipping out of reach. */
  private routePoint(a: Asteroid, path: AsteroidPath, p: number, keepOnScreen: boolean): Pt {
    const polar = (q: number, dTheta: number, rhoScale = 1): Pt => {
      const theta = path.theta0 + dTheta;
      let rho = (path.rho0 + (path.hit - path.rho0) * q) * rhoScale;
      if (keepOnScreen) rho = Math.min(rho, edgeDistance(theta, this.w, this.h) - a.r * 0.5);
      rho = Math.max(path.hit * (q >= 1 ? 1 : 0.5), rho);
      return { x: this.cx + Math.cos(theta) * rho, y: this.cy + Math.sin(theta) * rho };
    };
    // Angular shapes: straight legs between corners.
    const corners = path.corners;
    if (corners) {
      let i = 1;
      while (i < corners.length - 1 && corners[i].p < p) i++;
      const c0 = corners[i - 1];
      const c1 = corners[i];
      const t = c1.p > c0.p ? (p - c0.p) / (c1.p - c0.p) : 1;
      const A = polar(c0.q, c0.dTheta);
      const B = polar(c1.q, c1.dTheta);
      return { x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t };
    }
    const pt = expertPath(a.shape, p, path.side);
    return polar(pt.q, pt.dTheta, pt.rhoScale);
  }

  /** Moves an expert-mode asteroid along its route. */
  private followPath(a: Asteroid, path: AsteroidPath, dt: number): void {
    path.p = Math.min(1, path.p + dt / path.dur);
    // Never leave the screen once it has come in (a spiral would otherwise slip out of reach).
    const pos = this.routePoint(a, path, path.p, path.entered);
    a.x = pos.x;
    a.y = pos.y;
    if (!path.entered && this.onScreen(a)) path.entered = true;
  }

  // ---------------------------------------------------------------- update

  private update(dt: number): void {
    this.realTime += dt;
    const effects = () => this.updateEffects(dt);

    if (this.state === 'paused') return;
    if (this.state === 'over' || this.state === 'complete') {
      effects();
      return;
    }

    this.time += dt;
    if (this.state === 'menu') {
      this.updateMenu(dt);
      this.updateAsteroids(dt, true);
      this.updateBlasts(dt, true);
      effects();
      return;
    }

    // Playing (or FX lab).
    if (this.queued && this.time >= this.cooldownUntil) {
      const q = this.queued;
      this.queued = null;
      this.fire(q.shape, q.at);
    }

    if (this.state === 'sandbox') {
      this.updateSandbox();
      this.updateAsteroids(dt, false);
      this.updateBlasts(dt, false);
      this.updateShockwaves(dt);
      effects();
      return;
    }

    // Bomb charges during play (not while paused: update() returns early then).
    if (!this.dying && this.bombCharge < 1) {
      this.bombCharge = Math.min(1, this.bombCharge + dt / BOMB_CHARGE_TIME);
      if (this.bombCharge >= 1) {
        this.sfx.bombReady();
        this.floater(this.cx, this.cy + this.shipR * 3.4, t('fx.bombReady'), '#ffffff', 16, 1.2);
      }
    }

    if (this.endTimer > 0) {
      this.endTimer -= dt;
      if (this.endTimer <= 0) {
        if (this.dying) {
          this.state = 'over';
          const r = this.result();
          this.onGameOver?.(r);
          this.onRunEnd?.(r, 'loss');
        } else {
          this.state = 'complete';
          const r = this.result();
          this.onLevelComplete?.(r);
          this.onRunEnd?.(r, 'win');
        }
      }
    } else if (this.breakTimer > 0) {
      this.breakTimer -= dt;
      if (this.breakTimer <= 0) {
        this.waveIndex++;
        this.beginWave();
      }
    } else if (this.wave) {
      this.updateSpawning(dt, this.wave);
    }

    if (!this.dying && this.time - this.lastHit > REGEN_DELAY) this.shield = Math.min(SHIELD_MAX, this.shield + REGEN_RATE * dt);

    this.updateAsteroids(dt, false);
    this.updateBlasts(dt, false);
    this.updateShockwaves(dt);
    effects();

    // Wave cleared?
    if (!this.dying && this.endTimer <= 0 && this.breakTimer <= 0 && this.toSpawn === 0 && this.asteroids.length === 0 && this.blasts.length === 0 && this.shockwaves.length === 0) {
      if (this.isLastWave(this.waveIndex)) {
        this.endTimer = 1.4;
        this.sfx.levelComplete();
        this.onBanner?.(t('banner.levelClear'), levelName(this.levelIndex));
      } else {
        // Short breather: one banner announces the next wave and stays up while it starts.
        this.breakTimer = WAVE_BREAK;
        this.sfx.waveClear();
        const next = this.waveIndex + 1;
        const progress = this.endless ? this.waveSubtitle(next) : t('banner.progress', { n: next + 1, total: WAVES_PER_LEVEL });
        this.onBanner?.(this.waveTitle(next), t('banner.cleared', { n: next, next: progress }));
      }
    }

    this.onHud?.({
      shield: this.shield / SHIELD_MAX,
      score: this.score,
      multiplier: this.multiplier,
      wave: this.waveIndex + 1,
      level: this.levelIndex + 1,
      // Endless: show the next wave's shapes during the break, so a new one appears with its banner.
      shapes: this.endless && this.breakTimer > 0 ? endlessShapes(this.waveIndex + 1, this.endlessOrder) : this.currentShapes(),
      endless: this.endless,
      expert: this.expert,
      bomb: this.bombCharge,
      remaining: this.toSpawn + this.asteroids.filter((a) => !a.dead && !a.targeted).length,
      waveTotal: this.wave?.count ?? 0,
    });
  }

  private updateSpawning(dt: number, wave: WaveDef): void {
    if (this.toSpawn <= 0) return;
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    const angle = Math.random() * Math.PI * 2;
    let n = 1;
    if (Math.random() < wave.burstChance) n = 2 + Math.floor(Math.random() * (wave.burstMax - 1));
    n = Math.min(n, this.toSpawn);
    for (let i = 0; i < n; i++) {
      const shape = pickWeighted(wave.shapes, wave.weights);
      this.spawn(shape, angle + (i - (n - 1) / 2) * 0.35, wave.travelTime, i * this.astR * 0.8);
    }
    this.toSpawn -= n;
    this.spawnTimer = wave.spawnInterval * rand(0.7, 1.3) * (n > 1 ? 1.6 : 1);
  }

  private updateMenu(dt: number): void {
    this.menuSpawn -= dt;
    if (this.menuSpawn <= 0 && this.asteroids.length < 7) {
      this.menuSpawn = 1.3;
      this.spawn(SHAPE_ORDER[Math.floor(Math.random() * SHAPE_ORDER.length)], Math.random() * Math.PI * 2, 10);
    }
    for (const a of this.asteroids) {
      if (!a.targeted && Math.hypot(a.x - this.cx, a.y - this.cy) < this.halfDiag * 0.42) this.fire(a.shape, { x: a.x, y: a.y }, true);
    }
  }

  private updateAsteroids(dt: number, attract: boolean): void {
    for (const a of this.asteroids) {
      if (a.dead) continue;
      a.age += dt;
      a.rot += a.spin * dt;
      if (a.path) {
        this.followPath(a, a.path, dt);
        const reached = a.path.p >= 1 || Math.hypot(a.x - this.cx, a.y - this.cy) < this.shipR + a.r * 0.6;
        if (!attract && !a.targeted && reached) this.shipHit(a);
        continue;
      }
      const dx = this.cx - a.x;
      const dy = this.cy - a.y;
      const d = Math.hypot(dx, dy) || 1;
      // Home in on the ship with a gentle sideways weave.
      const ang = Math.atan2(dy, dx) + Math.sin(a.age * 1.3) * 0.18 * a.wobble * Math.min(1, d / (this.halfDiag * 0.5));
      a.x += Math.cos(ang) * a.speed * dt;
      a.y += Math.sin(ang) * a.speed * dt;
      if (!attract && !a.targeted && d < this.shipR + a.r * 0.6) this.shipHit(a);
      if (attract && d < this.shipR) a.dead = true;
    }
    this.asteroids = this.asteroids.filter((a) => !a.dead);
  }

  private updateBlasts(dt: number, attract: boolean): void {
    for (const b of this.blasts) {
      b.t += dt;
      const radius = (b.t / b.dur) * b.maxR;
      let order = 0;
      for (const a of b.targets) {
        if (a.dead) continue;
        if (radius >= Math.hypot(a.x - this.cx, a.y - this.cy) - a.r) this.destroy(a, order++, attract);
      }
    }
    this.blasts = this.blasts.filter((b) => b.t < b.dur || b.targets.some((a) => !a.dead));
  }

  private updateEffects(dt: number): void {
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.96;
      p.vy *= 0.96;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const g of this.ghosts) g.life -= dt;
    this.ghosts = this.ghosts.filter((g) => g.life > 0);
    for (const b of this.bolts) b.life -= dt;
    this.bolts = this.bolts.filter((b) => b.life > 0);
    for (const f of this.floaters) {
      f.life -= dt;
      f.y -= 28 * dt;
    }
    this.floaters = this.floaters.filter((f) => f.life > 0);
    for (const s of this.fading) s.life -= dt;
    this.fading = this.fading.filter((s) => s.life > 0);
    this.flash = Math.max(0, this.flash - dt * 2.5);
    this.shake = Math.max(0, this.shake - dt * 60);
    this.shipPulse = Math.max(0, this.shipPulse - dt * 3);
    let da = this.shipTargetAngle - this.shipAngle;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    this.shipAngle += da * Math.min(1, dt * 10);
  }

  // ---------------------------------------------------------------- render

  private resize(): void {
    const oldCx = this.cx;
    const oldCy = this.cy;
    this.w = this.canvas.clientWidth || window.innerWidth;
    this.h = this.canvas.clientHeight || window.innerHeight;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.cx = this.w / 2;
    this.cy = this.h / 2;
    this.halfDiag = Math.hypot(this.w, this.h) / 2;
    const s = Math.min(this.w, this.h);
    this.shipR = clamp(s * 0.04, 14, 28);
    this.astR = clamp(s * 0.055, 18, 40);
    if (oldCx || oldCy) {
      const dx = this.cx - oldCx;
      const dy = this.cy - oldCy;
      for (const a of this.asteroids) { a.x += dx; a.y += dy; }
    }
  }

  private frame(t: number): void {
    const dt = this.last ? Math.min(0.05, (t - this.last) / 1000) : 0.016;
    this.last = t;
    // Safety net for size or pixel-density changes no event told us about.
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    if (cw > 0 && ch > 0 && (cw !== this.w || ch !== this.h || dpr !== this.dpr)) this.resize();
    this.update(dt);
    this.render();
    requestAnimationFrame((tt) => this.frame(tt));
  }

  private glow(color: string, width: number, alpha = 1): void {
    const c = this.ctx;
    c.strokeStyle = color;
    c.globalAlpha = alpha * 0.14;
    c.lineWidth = width * 5;
    c.stroke();
    c.globalAlpha = alpha * 0.3;
    c.lineWidth = width * 2.4;
    c.stroke();
    c.globalAlpha = alpha;
    c.lineWidth = width;
    c.stroke();
    c.globalAlpha = alpha * 0.7;
    c.lineWidth = width * 0.4;
    c.strokeStyle = '#ffffff';
    c.stroke();
    c.globalAlpha = 1;
  }

  private render(): void {
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.globalCompositeOperation = 'source-over';

    // Background.
    const bg = c.createRadialGradient(this.cx, this.cy, 0, this.cx, this.cy, this.halfDiag);
    bg.addColorStop(0, '#0d1230');
    bg.addColorStop(1, '#03040c');
    c.fillStyle = bg;
    c.fillRect(0, 0, this.w, this.h);
    for (const s of this.stars) {
      const x = ((s.x * this.w - this.realTime * (4 + s.z * 10)) % this.w + this.w) % this.w;
      const y = s.y * this.h;
      c.globalAlpha = 0.25 + 0.5 * s.z * (0.6 + 0.4 * Math.sin(this.realTime * 2 + s.tw));
      c.fillStyle = '#cfe3ff';
      const sz = 0.6 + s.z * 1.4;
      c.fillRect(x, y, sz, sz);
    }
    c.globalAlpha = 1;

    c.save();
    if (this.shake > 0) c.translate(rand(-1, 1) * this.shake * 0.5, rand(-1, 1) * this.shake * 0.5);
    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.globalCompositeOperation = 'lighter';

    this.renderBlasts();
    this.renderShockwaves();
    for (const g of this.ghosts) {
      const k = g.life / g.max;
      traceGlyph(c, g.shape, g.x, g.y, g.r * (1 + (1 - k) * 1.2), g.rot);
      this.glow(SHAPES[g.shape].color, 2, k);
    }
    for (const a of this.asteroids) this.renderAsteroid(a);
    for (const b of this.bolts) {
      c.beginPath();
      c.moveTo(this.cx, this.cy);
      c.lineTo(b.x, b.y);
      this.glow(b.color, 1.5, b.life / 0.22);
    }
    if (!this.dying && this.state !== 'over') this.renderShip();
    for (const p of this.particles) {
      c.globalAlpha = p.life / p.max;
      c.fillStyle = p.color;
      c.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    c.globalAlpha = 1;

    // The player's ink is drawn without screen shake, so it never drifts from the finger.
    c.save();
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.renderStrokes();
    c.restore();

    c.globalCompositeOperation = 'source-over';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (const f of this.floaters) {
      c.globalAlpha = Math.min(1, (f.life / f.max) * 2);
      c.font = `700 ${f.size}px ui-rounded, "Segoe UI", system-ui, sans-serif`;
      c.fillStyle = f.color;
      c.shadowColor = f.color;
      c.shadowBlur = 10;
      c.fillText(f.text, f.x, f.y);
    }
    c.shadowBlur = 0;
    c.globalAlpha = 1;
    c.restore();

    // Bomb flash over the whole screen.
    if (this.flash > 0) {
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = this.flash * 0.45;
      c.fillStyle = '#cfefff';
      c.fillRect(0, 0, this.w, this.h);
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'source-over';
    }
  }

  /** FX lab only: dotted preview of the rest of an Expert route. */
  private renderRoute(a: Asteroid, path: AsteroidPath): void {
    const c = this.ctx;
    c.beginPath();
    for (let k = 0; k <= 120; k++) {
      const { x, y } = this.routePoint(a, path, path.p + ((1 - path.p) * k) / 120, true);
      if (k === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.setLineDash([4, 6]);
    this.glow(SHAPES[a.shape].color, 1, 0.35);
    c.setLineDash([]);
  }

  private renderAsteroid(a: Asteroid): void {
    const c = this.ctx;
    const info = SHAPES[a.shape];
    const flash = a.targeted ? 0.6 + 0.4 * Math.sin(this.realTime * 40) : 1;
    if (a.path && this.state === 'sandbox') this.renderRoute(a, a.path);

    if (!this.onScreen(a)) {
      // Edge indicator for incoming asteroids.
      const ang = Math.atan2(a.y - this.cy, a.x - this.cx);
      const m = 16;
      const ix = clamp(this.cx + Math.cos(ang) * this.halfDiag, m, this.w - m);
      const iy = clamp(this.cy + Math.sin(ang) * this.halfDiag, m, this.h - m);
      const d = Math.hypot(a.x - this.cx, a.y - this.cy) - this.halfDiag;
      const alpha = clamp(1 - d / (this.astR * 6), 0.25, 0.8);
      traceGlyph(c, a.shape, ix, iy, 8, 0);
      this.glow(info.color, 1.2, alpha);
      return;
    }

    if (info.closed) {
      traceGlyph(c, a.shape, a.x, a.y, a.r, a.rot);
      c.globalCompositeOperation = 'source-over';
      c.globalAlpha = 0.75;
      c.fillStyle = '#070a18';
      c.fill();
      c.globalAlpha = 0.18;
      c.fillStyle = info.color;
      c.fill();
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'lighter';
      this.glow(info.color, 2.4, flash);
    } else {
      // Open strokes ride on a dark rock.
      c.beginPath();
      a.rock.forEach((k, i) => {
        const ang = a.rot + (i / a.rock.length) * Math.PI * 2;
        const px = a.x + Math.cos(ang) * a.r * k;
        const py = a.y + Math.sin(ang) * a.r * k;
        if (i === 0) c.moveTo(px, py);
        else c.lineTo(px, py);
      });
      c.closePath();
      c.globalCompositeOperation = 'source-over';
      c.globalAlpha = 0.85;
      c.fillStyle = '#0a0d1d';
      c.fill();
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'lighter';
      this.glow(info.color, 1, 0.35 * flash);
      traceGlyph(c, a.shape, a.x, a.y, a.r * 0.68, a.rot * 0.25);
      this.glow(info.color, 2.6, flash);
    }
  }

  /** Bomb shockwave: a thick white ring with rings in every shape color trailing behind. */
  private renderShockwaves(): void {
    const c = this.ctx;
    const colors = SHAPE_ORDER.map((s) => SHAPES[s].color);
    for (const w of this.shockwaves) {
      const k = Math.min(1, w.t / BOMB_WAVE_DUR);
      const radius = (1 - (1 - k) ** 2) * w.maxR;
      const fade = w.t < BOMB_WAVE_DUR ? 1 : Math.max(0, 1 - (w.t - BOMB_WAVE_DUR) / 0.35);
      colors.forEach((col, i) => {
        c.beginPath();
        c.arc(this.cx, this.cy, Math.max(1, radius - i * 9), 0, Math.PI * 2);
        this.glow(col, 2, fade * (1 - i / colors.length) * 0.8);
      });
      c.beginPath();
      c.arc(this.cx, this.cy, Math.max(1, radius), 0, Math.PI * 2);
      this.glow('#ffffff', 6, fade);
    }
  }

  private renderBlasts(): void {
    const c = this.ctx;
    for (const b of this.blasts) {
      const k = Math.min(1, b.t / b.dur);
      const radius = k * b.maxR;
      const alpha = 1 - k * 0.85;
      const color = SHAPES[b.shape].color;
      c.beginPath();
      c.arc(this.cx, this.cy, Math.max(1, radius), 0, Math.PI * 2);
      this.glow(color, 1.5, alpha * 0.5);
      traceGlyph(c, b.shape, this.cx, this.cy, Math.max(1, radius * 0.92), b.rot);
      this.glow(color, 3.5, alpha);
    }
  }

  private renderShip(): void {
    const c = this.ctx;
    const r = this.shipR * (1 + this.shipPulse * 0.15);
    const s = this.shield / SHIELD_MAX;
    const hue = 0 + 185 * s;
    const ringColor = `hsl(${hue}, 100%, 62%)`;

    // Shield ring.
    c.beginPath();
    c.arc(this.cx, this.cy, this.shipR * 1.9, 0, Math.PI * 2);
    const hitFlash = clamp(1 - (this.time - this.lastHit) * 2, 0, 1);
    this.glow(ringColor, 1.5, 0.2 + 0.5 * s + hitFlash * 0.6);
    // Shield fill arc.
    c.beginPath();
    c.arc(this.cx, this.cy, this.shipR * 1.9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * s);
    this.glow(ringColor, 2.5, 0.6);

    // Hull.
    const a = this.shipAngle;
    const pt = (dx: number, dy: number): [number, number] => [
      this.cx + (dx * Math.cos(a) - dy * Math.sin(a)) * r,
      this.cy + (dx * Math.sin(a) + dy * Math.cos(a)) * r,
    ];
    c.beginPath();
    c.moveTo(...pt(1, 0));
    c.lineTo(...pt(-0.7, 0.65));
    c.lineTo(...pt(-0.35, 0));
    c.lineTo(...pt(-0.7, -0.65));
    c.closePath();
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = '#0a1028';
    c.fill();
    c.globalCompositeOperation = 'lighter';
    this.glow('#e8f6ff', 2, 1);
    // Thruster flicker.
    c.beginPath();
    c.moveTo(...pt(-0.45, 0));
    c.lineTo(...pt(-0.75 - Math.random() * 0.35, 0));
    this.glow('#3df5ff', 2, 0.8);
  }

  private renderStrokes(): void {
    const c = this.ctx;
    const path = (pts: Pt[]) => {
      c.beginPath();
      pts.forEach((p, i) => (i === 0 ? c.moveTo(p.x, p.y) : c.lineTo(p.x, p.y)));
    };
    for (const s of this.fading) {
      path(s.pts);
      this.glow(s.color, 3, s.life / s.max);
    }
    if (this.stroke && this.stroke.length > 1) {
      path(this.stroke);
      this.glow('#ffffff', 3, 0.9);
    }
  }
}
