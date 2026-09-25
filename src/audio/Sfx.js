// Procedural WebAudio sound effects – no asset files needed.
export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.lastLand = 0;
  }

  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(this.ctx.destination);
      this.noiseBuf = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }

  get ok() {
    return this.ctx && !this.muted;
  }

  tone({ freq = 440, to = null, type = 'sine', dur = 0.12, vol = 0.3, delay = 0, attack = 0.005 }) {
    if (!this.ok) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  noise({ dur = 0.3, vol = 0.4, freq = 800, to = null, q = 1, type = 'lowpass', delay = 0 }) {
    if (!this.ok) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    if (to) f.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  move() {
    this.tone({ freq: 520, type: 'triangle', dur: 0.03, vol: 0.08 });
  }

  rotate() {
    this.tone({ freq: 700, to: 980, type: 'triangle', dur: 0.05, vol: 0.1 });
  }

  land(hard) {
    const now = performance.now();
    if (now - this.lastLand < 40) return;
    this.lastLand = now;
    this.tone({ freq: hard ? 180 : 240, to: 90, type: 'sine', dur: 0.1, vol: hard ? 0.35 : 0.2 });
    if (hard) this.noise({ dur: 0.08, vol: 0.15, freq: 1200, to: 300 });
  }

  /** Rising pitch per chain step – the classic chain "voice". */
  pop(chain) {
    const base = 330 * Math.pow(2, (Math.min(chain, 12) * 2) / 12);
    this.tone({ freq: base, to: base * 1.5, type: 'sine', dur: 0.12, vol: 0.28 });
    this.tone({ freq: base * 2, to: base * 3, type: 'triangle', dur: 0.09, vol: 0.12, delay: 0.03 });
    this.noise({ dur: 0.06, vol: 0.12, freq: 3000, type: 'highpass' });
    if (chain >= 2) this.tone({ freq: base * 1.5, type: 'square', dur: 0.08, vol: 0.05, delay: 0.06 });
  }

  bomb() {
    this.noise({ dur: 0.5, vol: 0.7, freq: 1600, to: 90 });
    this.tone({ freq: 120, to: 40, type: 'sine', dur: 0.45, vol: 0.5 });
  }

  star() {
    this.tone({ freq: 1800, to: 300, type: 'sawtooth', dur: 0.25, vol: 0.12 });
    this.noise({ dur: 0.25, vol: 0.3, freq: 5000, to: 800, type: 'bandpass', q: 3 });
  }

  prism() {
    [0, 4, 7, 12, 16, 19].forEach((n, i) =>
      this.tone({ freq: 523 * Math.pow(2, n / 12), type: 'triangle', dur: 0.2, vol: 0.14, delay: i * 0.035 }),
    );
    this.noise({ dur: 0.4, vol: 0.25, freq: 6000, to: 1500, type: 'bandpass', q: 2 });
  }

  special() {
    this.tone({ freq: 880, to: 1760, type: 'triangle', dur: 0.18, vol: 0.14 });
    this.tone({ freq: 1320, to: 2640, type: 'sine', dur: 0.18, vol: 0.1, delay: 0.05 });
  }

  prismGranted() {
    [0, 7, 12].forEach((n, i) => this.tone({ freq: 660 * Math.pow(2, n / 12), type: 'sine', dur: 0.16, vol: 0.15, delay: i * 0.06 }));
  }

  multUp() {
    [0, 4, 7, 12].forEach((n, i) => this.tone({ freq: 587 * Math.pow(2, n / 12), type: 'square', dur: 0.1, vol: 0.07, delay: i * 0.05 }));
  }

  timeBonus() {
    this.tone({ freq: 1046, type: 'sine', dur: 0.12, vol: 0.2 });
    this.tone({ freq: 1568, type: 'sine', dur: 0.2, vol: 0.2, delay: 0.08 });
  }

  speed(level) {
    this.tone({ freq: 400 + level * 90, to: 700 + level * 120, type: 'sawtooth', dur: 0.12, vol: 0.06 });
  }

  blazing() {
    this.noise({ dur: 0.9, vol: 0.45, freq: 300, to: 4000, type: 'bandpass', q: 1.2 });
    [0, 3, 7, 10, 12].forEach((n, i) => this.tone({ freq: 220 * Math.pow(2, n / 12), type: 'sawtooth', dur: 0.2, vol: 0.08, delay: i * 0.05 }));
  }

  overflow() {
    this.tone({ freq: 300, to: 60, type: 'sawtooth', dur: 0.5, vol: 0.25 });
    this.noise({ dur: 0.6, vol: 0.5, freq: 900, to: 60 });
  }

  countdown(n) {
    if (n > 0) this.tone({ freq: 660, type: 'square', dur: 0.12, vol: 0.12 });
    else this.tone({ freq: 1320, type: 'square', dur: 0.3, vol: 0.14 });
  }

  tick(urgent) {
    this.tone({ freq: urgent ? 1500 : 1100, type: 'square', dur: 0.03, vol: urgent ? 0.1 : 0.05 });
  }

  timeUp() {
    this.tone({ freq: 880, to: 220, type: 'square', dur: 0.6, vol: 0.14 });
  }

  hurrah() {
    [0, 4, 7, 12, 16].forEach((n, i) => this.tone({ freq: 392 * Math.pow(2, n / 12), type: 'square', dur: 0.14, vol: 0.09, delay: i * 0.07 }));
  }

  results(best) {
    const notes = best ? [0, 4, 7, 12, 16, 19, 24] : [0, 4, 7, 12];
    notes.forEach((n, i) => this.tone({ freq: 523 * Math.pow(2, n / 12), type: 'triangle', dur: 0.22, vol: 0.14, delay: i * 0.08 }));
  }
}
