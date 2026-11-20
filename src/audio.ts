import { Music, type MusicMode } from './music';
import type { ShapeId } from './shapes';

const SFX_VOLUME = 0.5;
const MUSIC_VOLUME = 0.35;

/**
 * All game audio, synthesized with Web Audio (no audio files).
 * Sound effects and music go through separate buses so each can be muted on its own.
 */
export class Sfx {
  private ctx?: AudioContext;
  /** Sound effects bus. */
  private master?: GainNode;
  private musicBus?: GainNode;
  private music?: Music;
  private noiseBuf?: AudioBuffer;
  private _muted = false;
  private musicMuted = false;
  private musicMode: MusicMode = 'menu';

  /** Must be called from a user gesture (browsers block audio until then). */
  unlock(): void {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      this.ctx = ctx;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.connect(ctx.destination);
      this.master = ctx.createGain();
      this.master.gain.value = this._muted ? 0 : SFX_VOLUME;
      this.master.connect(comp);
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = this.musicMuted ? 0 : MUSIC_VOLUME;
      this.musicBus.connect(comp);
      const len = ctx.sampleRate;
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.music = new Music(ctx, this.musicBus, this.noiseBuf);
      this.music.setMode(this.musicMode);
      if (!this.musicMuted) this.music.start();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Silences everything while the tab is in the background. */
  suspend(): void {
    if (this.ctx?.state === 'running') void this.ctx.suspend();
  }

  setMuted(m: boolean): void {
    this._muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : SFX_VOLUME, this.ctx.currentTime, 0.02);
  }

  setMusicMuted(m: boolean): void {
    this.musicMuted = m;
    if (!this.musicBus || !this.ctx || !this.music) return;
    this.musicBus.gain.setTargetAtTime(m ? 0 : MUSIC_VOLUME, this.ctx.currentTime, 0.05);
    // Stop scheduling notes while muted; restart cleanly on unmute.
    if (m) this.music.stop();
    else this.music.start();
  }

  setMusicMode(mode: MusicMode): void {
    this.musicMode = mode;
    this.music?.setMode(mode);
  }

  setMusicIntensity(v: number): void {
    this.music?.setIntensity(v);
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0): void {
    const { ctx, master } = this;
    if (!ctx || !master || this._muted) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, freq: number, delay = 0, q = 1, type: BiquadFilterType = 'lowpass'): void {
    const { ctx, master, noiseBuf } = this;
    if (!ctx || !master || !noiseBuf || this._muted) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (type === 'lowpass') f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.15), t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  blast(): void {
    this.tone('sawtooth', 180, 1400, 0.18, 0.18);
    this.tone('sine', 90, 50, 0.25, 0.35);
    this.noise(0.2, 0.15, 4000);
  }

  /**
   * Closed-shape destruction: a plucked note on the A minor pentatonic, in tune with the music,
   * with a sub-octave body and a soft thud. `a` is the angularity rank (0 circle, 1 infinity,
   * 2 square, 3 triangle): the more angular, the higher the note and the more resonant the filter.
   * The infinity sign plucks twice, once per loop.
   */
  private closedPluck(a: number, d: number): void {
    const f = [220, 262, 330, 440][a]; // A3, C4, E4, A4 (no random detune: stays in tune)
    const hits = a === 1 ? [0, 0.08] : [0];
    hits.forEach((h, k) => {
      const t = d + h;
      const v = k === 0 ? 1 : 0.75;
      this.pluck(f, 0.55, 0.2 * v, [1400, 1800, 2400, 3200][a], [2, 4, 7, 10][a], t);
      this.tone('sine', f / 2, f / 2, 0.35, 0.18 * v, t);
      this.noise(0.15, 0.16 * v, 700, t);
    });
  }

  /**
   * Open-shape destruction: glassy bell notes between C5 and C6 (above every closed shape),
   * in tune with the music. The number of notes follows the shape: a wave is one wavering note,
   * a line one clean note, a V two notes (one per stroke), a zigzag four fast notes (one per segment).
   * `b` is the angularity rank: 0 wave, 1 line, 2 V, 3 zigzag.
   */
  private openBell(b: number, d: number): void {
    const C5 = 523, D5 = 587, E5 = 659, G5 = 784, A5 = 880, C6 = 1047;
    const phrases: [number, number][][] = [
      [[C5, 0]],
      [[D5, 0]],
      [[E5, 0], [A5, 0.07]],
      [[G5, 0], [C6, 0.045], [G5, 0.09], [C6, 0.135]],
    ];
    phrases[b].forEach(([f, at], k) => this.bellNote(f, d + at, k === 0 ? 1 : 0.75, b === 0));
  }

  /** Triangle plus a quiet, slightly detuned octave sine: glassy and chime-like. */
  private bellNote(f: number, delay: number, v: number, vibrato: boolean): void {
    const { ctx, master } = this;
    if (!ctx || !master || this._muted) return;
    const t = ctx.currentTime + delay;
    const dur = 0.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3 * v, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(master);

    const oscs: OscillatorNode[] = [];
    for (const [type, mult, level] of [['triangle', 1, 1], ['sine', 2.003, 0.25]] as const) {
      const o = ctx.createOscillator();
      const lg = ctx.createGain();
      o.type = type;
      o.frequency.value = f * mult;
      lg.gain.value = level;
      o.connect(lg).connect(g);
      oscs.push(o);
    }

    if (vibrato) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = 9;
      depth.gain.value = f * 0.03;
      lfo.connect(depth);
      oscs.forEach((o) => depth.connect(o.frequency));
      lfo.start(t);
      lfo.stop(t + dur + 0.02);
    }
    for (const o of oscs) {
      o.start(t);
      o.stop(t + dur + 0.02);
    }
  }

  /** Plucked synth note: sawtooth through a resonant low-pass that snaps shut. */
  private pluck(f: number, dur: number, vol: number, cutoff: number, q: number, delay = 0): void {
    const { ctx, master } = this;
    if (!ctx || !master || this._muted) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const lp = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.value = f;
    lp.type = 'lowpass';
    lp.Q.value = q;
    lp.frequency.setValueAtTime(cutoff, t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(80, f * 0.8), t + dur * 0.6);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp).connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /**
   * Destruction sound, one per shape.
   * Closed shapes are plucked notes, low-mid (220–440 Hz); open shapes are bell notes, higher
   * (523–1047 Hz). Both are in tune with the music. Within each family, the more angular the
   * shape, the higher the sound.
   */
  explode(shape: ShapeId, i = 0): void {
    const d = Math.min(i * 0.04, 0.4); // stagger multi-kills
    switch (shape) {
      // ---- Closed: round to angular, low to higher note.
      case 'circle':
        this.closedPluck(0, d);
        break;
      case 'infinity':
        this.closedPluck(1, d);
        break;
      case 'square':
        this.closedPluck(2, d);
        break;
      case 'triangle':
        this.closedPluck(3, d);
        break;
      // ---- Open: curvy to jagged, higher notes and more of them.
      case 'wave':
        this.openBell(0, d);
        break;
      case 'line':
        this.openBell(1, d);
        break;
      case 'v':
        this.openBell(2, d);
        break;
      case 'zigzag':
        this.openBell(3, d);
        break;
    }
  }

  /**
   * Bomb going off ("Prism"): a wide, thick A minor 9 synth chord (A2 E3 A3 C4 E4 G4 B4, three
   * detuned saws per note) whose filter bursts open with the shockwave then slowly closes, over a
   * deep falling hit and a short rumble.
   */
  bomb(): void {
    this.tone('sine', 70, 28, 1.0, 0.45);
    this.noise(0.6, 0.25, 900, 0, 1);
    [110, 165, 220, 262, 330, 392, 494].forEach((f) => this.supersaw(f, 1.6, 0.05));
  }

  /** Three detuned saws through a low-pass that bursts open then slowly closes (a lush synth stab). */
  private supersaw(f: number, dur: number, vol: number, delay = 0): void {
    const { ctx, master } = this;
    if (!ctx || !master || this._muted) return;
    const t = ctx.currentTime + delay;
    const lp = ctx.createBiquadFilter();
    const g = ctx.createGain();
    lp.type = 'lowpass';
    lp.Q.value = 2;
    lp.frequency.setValueAtTime(300, t);
    lp.frequency.exponentialRampToValueAtTime(4500, t + 0.12);
    lp.frequency.exponentialRampToValueAtTime(500, t + dur);
    // Hold for a moment, then ring out (so the chord blooms instead of just blipping).
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.setValueAtTime(vol, t + dur * 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    lp.connect(g).connect(master);
    for (const cents of [-14, 0, 14]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = cents;
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.02);
    }
  }

  /** Bomb fully charged: short rising two-note chime. */
  bombReady(): void {
    this.tone('triangle', 659, 659, 0.16, 0.12);
    this.tone('triangle', 988, 988, 0.28, 0.12, 0.1);
  }

  hit(): void {
    this.noise(0.6, 0.6, 900, 0, 4);
    this.tone('square', 110, 30, 0.45, 0.3);
  }

  misfire(): void {
    this.tone('square', 300, 120, 0.18, 0.1);
    this.tone('square', 200, 80, 0.2, 0.08, 0.08);
  }

  waveClear(): void {
    [523, 659, 784].forEach((f, i) => this.tone('triangle', f, f, 0.18, 0.15, i * 0.08));
  }

  levelComplete(): void {
    [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone('triangle', f, f * 1.01, 0.3, 0.16, i * 0.1));
  }

  gameOver(): void {
    [392, 330, 262, 196].forEach((f, i) => this.tone('sawtooth', f, f * 0.97, 0.35, 0.12, i * 0.16));
    this.noise(1.2, 0.5, 1200);
  }

  click(): void {
    this.tone('sine', 880, 660, 0.06, 0.1);
  }
}
