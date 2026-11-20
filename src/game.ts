import type { Sfx } from './audio';
import { LEVELS, WAVES_PER_LEVEL, makeWave, pickWeighted, type WaveDef } from './levels';
import { MIN_STROKE_SIZE, recognize } from './recognizer';
import { SHAPE_ORDER, SHAPES, traceGlyph, type Pt, type ShapeId } from './shapes';

type State = 'menu' | 'playing' | 'paused' | 'over' | 'complete';

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
}

export interface LevelResult {
  level: number;
  score: number;
  hits: number;
  kills: number;
  bestMultiplier: number;
  stars: number;
  wave: number;
}

const COOLDOWN = 0.2;
const SHIELD_MAX = 100;
const HIT_DAMAGE = 22;
const REGEN_DELAY = 2;
const REGEN_RATE = 5;
const BLAST_DUR = 0.45;
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
  private waveIndex = 0;
  private wave: WaveDef | null = null;
  private toSpawn = 0;
  private spawnTimer = 0;
  private breakTimer = 0;
  private endTimer = 0;
  private dying = false;
  private shield = SHIELD_MAX;
  private lastHit = -99;
  private hits = 0;
  private kills = 0;
  private score = 0;
  private streak = 0;
  private multiplier = 1;
  private bestMultiplier = 1;
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
    window.addEventListener('resize', () => this.resize());
    this.bindInput();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------------------------------------------------------------- lifecycle

  startLevel(index: number): void {
    this.levelIndex = index;
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
    this.queued = null;
    this.dying = false;
    this.endTimer = 0;
    this.time = 0;
    this.cooldownUntil = 0;
    this.stroke = null;
    this.state = 'playing';
    this.beginWave();
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
    this.state = 'menu';
    this.asteroids = [];
    this.blasts = [];
    this.cancelStroke();
  }

  get isPlaying() {
    return this.state === 'playing';
  }

  private waveTitle(index: number): string {
    return index === WAVES_PER_LEVEL - 1 ? 'Final wave' : `Wave ${index + 1}`;
  }

  /** Starts the current wave. The level's first wave gets a longer lead-in and its own banner;
   *  later waves were already announced when the previous one was cleared. */
  private beginWave(): void {
    this.wave = makeWave(this.levelIndex, this.waveIndex);
    this.toSpawn = this.wave.count;
    this.breakTimer = 0;
    if (this.waveIndex === 0) {
      this.spawnTimer = 1.4;
      this.onBanner?.(this.waveTitle(0), `1 / ${WAVES_PER_LEVEL}`);
    } else {
      this.spawnTimer = WAVE_LEAD_IN;
    }
  }

  private result(): LevelResult {
    const stars = this.state === 'over' ? 0 : this.hits <= 1 ? 3 : this.hits <= 4 ? 2 : 1;
    return {
      level: this.levelIndex,
      score: this.score,
      hits: this.hits,
      kills: this.kills,
      bestMultiplier: this.bestMultiplier,
      stars,
      wave: this.waveIndex + 1,
    };
  }

  // ---------------------------------------------------------------- input

  private bindInput(): void {
    const c = this.canvas;
    const pos = (e: PointerEvent): Pt => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    c.addEventListener('pointerdown', (e) => {
      if (this.state !== 'playing' || this.dying || this.stroke) return;
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
      if (this.state === 'playing' && !this.dying) this.handleStroke(pts);
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
    if (Math.max(maxX - minX, maxY - minY) < MIN_STROKE_SIZE) return; // a tap
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
        this.floater(at.x, at.y - 20, info.name, info.color, 16);
        return;
      }
      if (!targets.length) {
        this.misfire(at, `No ${info.name.toLowerCase()}`);
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
    this.floater(at.x, at.y - 20, info.name, info.color, 15);

    const n = targets.length;
    const mult = this.multiplier;
    const each = 100 * mult;
    const bonus = n >= 2 ? 50 * n * (n - 1) * mult : 0;
    this.score += n * each + bonus;
    this.kills += n;
    for (const a of targets) a.points = each;
    if (bonus) {
      const label = n === 2 ? 'DOUBLE' : n === 3 ? 'TRIPLE' : n === 4 ? 'QUAD' : `${n}× MULTI`;
      this.floater(this.cx, this.cy - this.shipR * 3.2, `${label} +${bonus}`, info.color, 22, 1.3);
    }
    this.streak++;
    const newMult = Math.min(5, 1 + Math.floor(this.streak / 2));
    if (newMult > this.multiplier) this.floater(this.cx, this.cy + this.shipR * 3.4, `COMBO ×${newMult}`, '#ffffff', 18, 1.1);
    this.multiplier = newMult;
    this.bestMultiplier = Math.max(this.bestMultiplier, newMult);
  }

  private misfire(at: Pt, label: string): void {
    this.sfx.misfire();
    if (this.multiplier > 1) this.floater(this.cx, this.cy + this.shipR * 3.4, 'Combo lost', '#8a90a8', 16);
    this.streak = 0;
    this.multiplier = 1;
    this.floater(at.x, at.y - 20, label, '#8a90a8', 16);
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(20, 90);
      this.particles.push({ x: at.x, y: at.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.4, max: 0.4, color: '#8a90a8', size: 2 });
    }
  }

  private destroy(a: Asteroid, order: number, attract: boolean): void {
    a.dead = true;
    const color = SHAPES[a.shape].color;
    this.ghosts.push({ shape: a.shape, x: a.x, y: a.y, r: a.r, rot: a.rot, life: 0.45, max: 0.45 });
    this.burst(a.x, a.y, color, 22, a.r * 4);
    this.burst(a.x, a.y, '#ffffff', 6, a.r * 3);
    if (!attract) {
      this.sfx.explode(a.shape, order);
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
    this.sfx.hit();
    this.hits++;
    this.shield = Math.max(0, this.shield - HIT_DAMAGE);
    this.lastHit = this.time;
    this.shake = 16;
    if (this.multiplier > 1) this.floater(this.cx, this.cy + this.shipR * 3.4, 'Combo lost', '#ff4f64', 16);
    this.streak = 0;
    this.multiplier = 1;
    this.burst(a.x, a.y, '#ff4f64', 26, a.r * 4);
    this.burst(a.x, a.y, SHAPES[a.shape].color, 10, a.r * 3);
    if (this.shield <= 0) this.die();
  }

  private die(): void {
    this.dying = true;
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
    // Speed is set from the corner distance, so difficulty doesn't depend on the arrival side.
    const speed = ((this.halfDiag + r + 16) / travelTime) * rand(0.9, 1.1);
    // Spawn just past the screen edge in that direction (not on the corner circle), so no time
    // is spent travelling unseen; ~0.5 s of margin lets the edge indicator warn the player.
    const c = Math.abs(Math.cos(angle)) || 1e-6;
    const s = Math.abs(Math.sin(angle)) || 1e-6;
    const toEdge = Math.min(this.w / 2 / c, this.h / 2 / s);
    const dist = toEdge + r + Math.max(24, speed * 0.5) + extraDist;
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

    // Playing.
    if (this.queued && this.time >= this.cooldownUntil) {
      const q = this.queued;
      this.queued = null;
      this.fire(q.shape, q.at);
    }

    if (this.endTimer > 0) {
      this.endTimer -= dt;
      if (this.endTimer <= 0) {
        if (this.dying) {
          this.state = 'over';
          this.onGameOver?.(this.result());
        } else {
          this.state = 'complete';
          this.onLevelComplete?.(this.result());
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
    effects();

    // Wave cleared?
    if (!this.dying && this.endTimer <= 0 && this.breakTimer <= 0 && this.toSpawn === 0 && this.asteroids.length === 0 && this.blasts.length === 0) {
      if (this.waveIndex >= WAVES_PER_LEVEL - 1) {
        this.endTimer = 1.4;
        this.sfx.levelComplete();
        this.onBanner?.('Level clear!', LEVELS[this.levelIndex].name);
      } else {
        // Short breather: one banner announces the next wave and stays up while it starts.
        this.breakTimer = WAVE_BREAK;
        this.sfx.waveClear();
        const next = this.waveIndex + 1;
        this.onBanner?.(this.waveTitle(next), `Wave ${next} clear · ${next + 1} / ${WAVES_PER_LEVEL}`);
      }
    }

    this.onHud?.({
      shield: this.shield / SHIELD_MAX,
      score: this.score,
      multiplier: this.multiplier,
      wave: this.waveIndex + 1,
      level: this.levelIndex + 1,
      shapes: LEVELS[this.levelIndex].shapes,
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
    this.renderStrokes();

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
  }

  private renderAsteroid(a: Asteroid): void {
    const c = this.ctx;
    const info = SHAPES[a.shape];
    const flash = a.targeted ? 0.6 + 0.4 * Math.sin(this.realTime * 40) : 1;

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
