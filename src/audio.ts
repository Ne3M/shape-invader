/** Synthesized sound effects with Web Audio. No audio files. */
export class Sfx {
  private ctx?: AudioContext;
  private master?: GainNode;
  private noiseBuf?: AudioBuffer;
  private _muted = false;

  get muted() {
    return this._muted;
  }

  /** Must be called from a user gesture (browsers block audio until then). */
  unlock(): void {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this._muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(m: boolean): void {
    this._muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.02);
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

  private noise(dur: number, vol: number, freq: number, delay = 0, q = 1): void {
    const { ctx, master, noiseBuf } = this;
    if (!ctx || !master || !noiseBuf || this._muted) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.15), t + dur);
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

  explode(i = 0): void {
    const d = Math.min(i * 0.04, 0.4);
    this.noise(0.45, 0.4, 2400 - Math.random() * 800, d);
    this.tone('triangle', 220 + Math.random() * 80, 40, 0.3, 0.2, d);
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
