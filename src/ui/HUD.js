import { CONFIG } from '../config.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');

// Galmuri11 is an 11px bitmap-style font: it only looks crisp at multiples of 11px.
const snap11 = (v) => Math.max(11, Math.round(v / 11) * 11);

/** DOM overlay. Positions itself in board-world coordinates via view.worldToScreen. */
export class HUD {
  constructor() {
    this.root = $('hud');
    this.el = {
      scoreBand: $('score-band'),
      score: $('score'),
      best: $('best'),
      timer: $('timer'),
      timerFill: $('timer-fill'),
      timerText: $('timer-text'),
      gaugeFill: $('gauge-fill'),
      nextLabel: $('next-label'),
      mult: $('mult'),
      multValue: $('mult-value'),
      speed: $('speed'),
      speedSegs: [...document.querySelectorAll('#speed .seg')],
      speedDrain: $('speed-drain'),
      callouts: $('callouts'),
      floaters: $('floaters'),
      title: $('title'),
      results: $('results'),
      pause: $('pause'),
      mute: $('btn-mute'),
      crt: $('btn-crt'),
    };
    this.displayScore = 0;
    this.shownMult = 1;
    this.cache = new Map(); // last written DOM values, so idle frames touch nothing
  }

  layout(view) {
    const { unit: u, px } = view.layout;
    const style = document.documentElement.style;
    style.setProperty('--u', `${u}px`);
    style.setProperty('--px', `${px}px`);
    style.setProperty('--f-xs', `${snap11(u * 0.3)}px`);
    style.setProperty('--f-s', `${snap11(u * 0.42)}px`);
    style.setProperty('--f-m', `${snap11(u * 0.6)}px`);
    style.setProperty('--f-l', `${snap11(u * 0.9)}px`);
    style.setProperty('--f-xl', `${snap11(u * 1.25)}px`);
    style.setProperty('--f-xxl', `${snap11(u * 2.4)}px`);
    const place = (el, x0, y0, x1, y1) => {
      const a = view.worldToScreen(x0, y1);
      const b = view.worldToScreen(x1, y0);
      Object.assign(el.style, { left: `${a.x}px`, top: `${a.y}px`, width: `${b.x - a.x}px`, height: `${b.y - a.y}px` });
    };
    place(this.el.scoreBand, -0.5, 12.75, 8.5, 14.3);
    place(this.el.timer, -0.5, -1.25, 5.5, -0.65);
    place(this.el.nextLabel, 6.3, 11.15, 8.5, 11.75);
    place(this.el.mult, 6.4, 2.6, 8.4, 4.9);
    place(this.el.speed, 6.4, -0.2, 8.4, 2.3);
    place(this.el.callouts, -0.5, -0.5, 5.5, 11.5);
    this.view = view;
  }

  set(key, el, prop, value) {
    if (this.cache.get(key) === value) return;
    this.cache.set(key, value);
    if (prop === 'text') el.textContent = value;
    else el.style[prop] = value;
  }

  toggle(key, el, cls, on) {
    const k = `${key}:${cls}`;
    if (this.cache.get(k) === on) return;
    this.cache.set(k, on);
    el.classList.toggle(cls, on);
  }

  update(game, dt) {
    this.displayScore += (game.score - this.displayScore) * (1 - Math.exp(-dt * 12));
    if (Math.abs(game.score - this.displayScore) < 1) this.displayScore = game.score;
    this.set('score', this.el.score, 'text', fmt(this.displayScore));
    this.set('best', this.el.best, 'text', fmt(Math.max(game.best, game.score)));

    const tl = game.timeLeft;
    this.set('timerFill', this.el.timerFill, 'transform', `scaleX(${Math.min(1, tl / CONFIG.gameTime).toFixed(3)})`);
    this.set('timerText', this.el.timerText, 'text', tl >= 10 ? String(Math.ceil(tl)) : tl > 0 ? tl.toFixed(1) : '0');
    this.toggle('timer', this.el.timer, 'urgent', tl < 10 && tl > 0);
    this.set('gauge', this.el.gaugeFill, 'transform', `scaleX(${game.gaugeProgress().toFixed(3)})`);

    const lvl = game.speedLevel;
    this.el.speedSegs.forEach((s, i) => this.toggle(`seg${i}`, s, 'on', i < lvl));
    this.set('drain', this.el.speedDrain, 'transform', `scaleX(${game.speedDrain().toFixed(2)})`);
    this.toggle('speed', this.el.speed, 'blazing', game.blazing > 0);

    if (game.mult !== this.shownMult) this.setMult(game.mult);
  }

  setMult(mult) {
    const up = mult > this.shownMult;
    this.shownMult = mult;
    this.el.multValue.textContent = mult;
    this.el.mult.dataset.level = String(Math.min(mult, 8));
    if (up) this.retrigger(this.el.mult, 'bump');
  }

  retrigger(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  /** Big center-of-board text (e.g. "BLAZING SPEED!"). */
  callout(html, cls = '', duration = 1100) {
    const d = document.createElement('div');
    d.className = `callout ${cls}`;
    d.innerHTML = html;
    this.el.callouts.appendChild(d);
    setTimeout(() => d.remove(), duration);
  }

  /** Floating text at board-world coordinates. */
  floatWorld(x, y, text, cls = '') {
    if (!this.view) return;
    const p = this.view.worldToScreen(x, y);
    this.floatScreen(p.x, p.y, text, cls);
  }

  floatScreen(x, y, text, cls = '') {
    const d = document.createElement('div');
    d.className = `floater ${cls}`;
    d.textContent = text;
    d.style.left = `${Math.round(x)}px`;
    d.style.top = `${Math.round(y)}px`;
    this.el.floaters.appendChild(d);
    setTimeout(() => d.remove(), 1200);
  }

  flashTimer(cls) {
    this.retrigger(this.el.timer, cls);
  }

  setBlazing(on) {
    document.body.classList.toggle('blazing', on);
  }

  setMuted(m) {
    this.el.mute.classList.toggle('off', m);
  }

  setCrt(on) {
    document.body.classList.toggle('crt-off', !on);
    this.el.crt.classList.toggle('off', !on);
  }

  // ─── overlays ─────────────────────────────────────────────────────────────

  show(name) {
    for (const k of ['title', 'results', 'pause']) this.el[k].classList.toggle('hidden', k !== name);
  }

  hideOverlays() {
    this.show(null);
  }

  showResults({ score, best, isBest, ending, stats }) {
    const escaped = ending === 'escape';
    $('res-title').textContent = escaped ? 'ESCAPED!' : 'K.O.';
    $('res-title').className = escaped ? 'escaped' : 'ko';
    $('res-sub').textContent = escaped
      ? 'LAST HURRAH로 탈출 성공!'
      : 'TIP: 특수 블롭을 남겨두면 마지막에 LAST HURRAH로 탈출해요';
    $('res-score').textContent = fmt(score);
    $('res-best').textContent = fmt(best);
    $('res-newbest').classList.toggle('hidden', !isBest);
    $('res-chain').textContent = stats.maxChain;
    $('res-popped').textContent = stats.popped;
    $('res-specials').textContent = stats.specials;
    $('res-mult').textContent = `×${stats.maxMult}`;
    $('res-time').textContent = `+${Math.round(stats.timeGained)}초`;
    $('res-step').textContent = fmt(stats.bestStep);
    this.show('results');
  }

  resetRound() {
    this.displayScore = 0;
    this.setMult(1);
    this.el.callouts.innerHTML = '';
    this.el.floaters.innerHTML = '';
    this.setBlazing(false);
  }
}
