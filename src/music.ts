/**
 * Procedural space music, generated live with Web Audio (no audio files).
 *
 * Menus: a slow (84 BPM) ambient pad with sparse echoing bells.
 * In game: the same Am – F – C – G progression at 120 BPM with kick, clap, hats,
 * a sequenced bass and a 16th-note arpeggio. Intensity (0–1, driven by wave progress)
 * adds layers, opens the bass filter and adds drum fills. Paused: muffled and quieter.
 */

export type MusicMode = 'menu' | 'game' | 'paused';

const MENU_BPM = 84;
const GAME_BPM = 120;
const STEPS_PER_CHORD = 32; // 2 bars of 16ths
const LOOKAHEAD = 0.25;

// Am – F – C – G, as MIDI notes (root first).
const PROGRESSION = [
  [57, 60, 64],
  [53, 57, 60],
  [48, 52, 55],
  [55, 59, 62],
];
const CYCLE = STEPS_PER_CHORD * PROGRESSION.length;

/** Bass rhythm per 16th in a bar: 0 = rest, 1 = root, 2 = root an octave up. */
const BASS_PATTERN = [1, 0, 1, 2, 0, 1, 0, 1, 1, 0, 1, 2, 0, 1, 2, 0];
/** Arpeggio over chord tones across two octaves (indices into [r, 3rd, 5th, r+12, 3rd+12, 5th+12]). */
const ARP_PATTERN = [0, 1, 2, 3, 4, 3, 2, 1, 0, 2, 3, 5, 4, 3, 2, 1];

const freq = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

export class Music {
  private filter: BiquadFilterNode;
  private level: GainNode;
  private delay: DelayNode;
  private delayIn: GainNode;
  private timer = 0;
  private nextTime = 0;
  private step = 0;
  private mode: MusicMode = 'menu';
  private intensity = 0;
  private playing = false;
  private pads: GainNode[] = [];

  constructor(
    private ctx: AudioContext,
    out: AudioNode,
    private noise: AudioBuffer,
  ) {
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 18000;
    this.level = ctx.createGain();
    this.level.gain.value = 0.9;
    this.filter.connect(this.level).connect(out);

    // Echo for the bells and arpeggio.
    this.delayIn = ctx.createGain();
    this.delayIn.gain.value = 0.35;
    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = this.stepDur() * 3;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2500;
    this.delayIn.connect(this.delay);
    this.delay.connect(tone).connect(fb).connect(this.delay);
    tone.connect(this.filter);
  }

  start(): void {
    if (this.playing) return;
    this.playing = true;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.step = 0;
    this.timer = window.setInterval(() => this.schedule(), 50);
    this.schedule();
  }

  stop(): void {
    this.playing = false;
    clearInterval(this.timer);
    this.fadePads(0.3);
  }

  setMode(mode: MusicMode): void {
    if (mode === this.mode) return;
    const wasGame = this.mode !== 'menu';
    const isGame = mode !== 'menu';
    this.mode = mode;
    const t = this.ctx.currentTime;
    const paused = mode === 'paused';
    this.filter.frequency.setTargetAtTime(paused ? 500 : 18000, t, 0.25);
    this.level.gain.setTargetAtTime(paused ? 0.55 : 0.9, t, 0.25);

    if (wasGame !== isGame) {
      // Switching between the ambient and the groove: restart the progression on a downbeat.
      this.delay.delayTime.setTargetAtTime(this.stepDur() * 3, t, 0.05);
      this.fadePads(0.4);
      this.step = 0;
      if (isGame) this.intensity = 0;
    }
  }

  /** 0 = calm start of a level, 1 = final wave. */
  setIntensity(v: number): void {
    this.intensity = Math.max(0, Math.min(1, v));
  }

  private stepDur(): number {
    return 60 / (this.mode === 'menu' ? MENU_BPM : GAME_BPM) / 4;
  }

  private fadePads(time: number): void {
    const t = this.ctx.currentTime;
    for (const g of this.pads) {
      g.gain.cancelScheduledValues(t);
      g.gain.setTargetAtTime(0.0001, t, time / 3);
    }
    this.pads = [];
  }

  private schedule(): void {
    if (!this.playing) return;
    const now = this.ctx.currentTime;
    // Fell behind (tab was in the background): skip ahead instead of playing a burst of notes.
    if (this.nextTime < now - 0.1) this.nextTime = now + 0.05;
    while (this.nextTime < now + LOOKAHEAD) {
      if (this.mode === 'menu') this.playMenuStep(this.step, this.nextTime);
      else this.playGameStep(this.step, this.nextTime);
      this.nextTime += this.stepDur();
      this.step = (this.step + 1) % CYCLE;
    }
  }

  private playMenuStep(step: number, t: number): void {
    const chord = PROGRESSION[Math.floor(step / STEPS_PER_CHORD)];
    const s = step % STEPS_PER_CHORD;
    if (s === 0) chord.forEach((n) => this.pad(n, t, STEPS_PER_CHORD * this.stepDur() + 1.5, 0.028));
    if (s === 0 || s === 16) this.bass(chord[0] - 12, t, 0.1, 2.5, 400);
    if (s % 2 === 0 && Math.random() < 0.18) {
      const n = chord[Math.floor(Math.random() * 3)] + (Math.random() < 0.5 ? 12 : 24);
      this.bell(n, t, 0.05, 1.2);
    }
  }

  private playGameStep(step: number, t: number): void {
    const chordIdx = Math.floor(step / STEPS_PER_CHORD);
    const chord = PROGRESSION[chordIdx];
    const s = step % STEPS_PER_CHORD;
    const inBar = s % 16;
    const I = this.intensity;
    // Drum fill on the last beat before the progression loops (and before every chord change when intense).
    const fill = s >= 28 && (chordIdx === PROGRESSION.length - 1 || I > 0.6);

    if (s === 0) {
      chord.forEach((n) => this.pad(n, t, STEPS_PER_CHORD * this.stepDur() + 0.5, 0.018));
      if (chordIdx === 0) this.crash(t, 0.05);
    }

    // Kick: half-time at the start of a level, four-on-the-floor after that.
    if (!fill) {
      const four = I >= 0.25 ? inBar % 4 === 0 : inBar === 0 || inBar === 8;
      if (four || (I > 0.7 && inBar === 14 && s >= 16)) this.kick(t);
    }

    // Clap on 2 and 4, snare roll in fills.
    if (fill) this.clap(t, 0.06 + (s - 28) * 0.035);
    else if (inBar === 4 || inBar === 12) this.clap(t, 0.17);

    // Hats: offbeat 8ths, plus 16ths as the level heats up.
    if (inBar % 4 === 2) this.hat(t, 0.05, 0.07);
    else if (inBar % 2 === 0) this.hat(t, 0.025, 0.04);
    else if (I > 0.4) this.hat(t, 0.015, 0.03);

    // Sequenced bass; the filter opens up with intensity.
    const b = BASS_PATTERN[inBar];
    if (b) this.bass(chord[0] - 24 + (b === 2 ? 12 : 0), t, 0.13, 0.18, 350 + 1100 * I + (inBar % 4 === 0 ? 300 : 0), true);

    // Arpeggio: 8ths at first, 16ths later.
    if (I > 0.15 || s % 2 === 0) {
      const tones = [...chord, ...chord.map((n) => n + 12)];
      this.bell(tones[ARP_PATTERN[inBar]] + 12, t, 0.022 + 0.012 * I, 0.18);
    }
  }

  // ------------------------------------------------------------ instruments

  private pad(midi: number, t: number, dur: number, vol: number): void {
    const g = this.ctx.createGain();
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(700, t);
    lp.frequency.linearRampToValueAtTime(1300, t + dur / 2);
    lp.frequency.linearRampToValueAtTime(700, t + dur);
    const attack = Math.min(1.8, dur / 4);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.setValueAtTime(vol, t + dur - attack);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    lp.connect(g).connect(this.filter);
    for (const detune of [-8, 7]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq(midi);
      o.detune.value = detune;
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
    this.pads.push(g);
    if (this.pads.length > 12) this.pads.shift();
  }

  private bass(midi: number, t: number, vol: number, dur: number, cutoff: number, saw = false): void {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const lp = this.ctx.createBiquadFilter();
    o.type = saw ? 'sawtooth' : 'triangle';
    o.frequency.value = freq(midi);
    lp.type = 'lowpass';
    lp.Q.value = saw ? 6 : 1;
    lp.frequency.setValueAtTime(saw ? cutoff * 2 : cutoff, t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(80, cutoff * 0.6), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp).connect(g).connect(this.filter);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private bell(midi: number, t: number, vol: number, dur: number): void {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.value = freq(midi);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.filter);
    g.connect(this.delayIn);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private kick(t: number): void {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(g).connect(this.filter);
    o.start(t);
    o.stop(t + 0.35);
  }

  private clap(t: number, vol: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1700;
    bp.Q.value = 0.8;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    src.connect(bp).connect(g).connect(this.filter);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.18);
    const o = this.ctx.createOscillator();
    const og = this.ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(120, t + 0.06);
    og.gain.setValueAtTime(vol * 0.5, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    o.connect(og).connect(this.filter);
    o.start(t);
    o.stop(t + 0.1);
  }

  private hat(t: number, vol: number, dur: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(hp).connect(g).connect(this.filter);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  private crash(t: number, vol: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 4500;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    src.connect(hp).connect(g).connect(this.filter);
    src.start(t, Math.random() * 0.2);
    src.stop(t + 1.45);
  }
}
