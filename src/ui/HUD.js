import { CONFIG } from '../config.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');

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
    };
    this.displayScore = 0;
    this.shownMult = 1;
  }

  layout(view) {
    const u = view.layout.unit;
    this.root.style.setProperty('--u', `${u}px`);
    const place = (el, x0, y0, x1, y1) => {
      const a = view.worldToScreen(x0, y1);
      const b = view.worldToScreen(x1, y0);
      Object.assign(el.style, { left: `${a.x}px`, top: `${a.y}px`, width: `${b.x - a.x}px`, height: `${b.y - a.y}px` });
    };
    place(this.el.scoreBand, -0.5, 12.75, 8.5, 14.3);
    place(this.el.timer, -0.5, -1.2, 5.5, -0.7);
    place(this.el.nextLabel, 6.3, 11.15, 8.5, 11.75);
    place(this.el.mult, 6.4, 2.6, 8.4, 4.9);
    place(this.el.speed, 6.4, -0.2, 8.4, 2.3);
    place(this.el.callouts, -0.5, -0.5, 5.5, 11.5);
    this.view = view;
  }

  update(game, dt) {
    // score roll-up
    this.displayScore += (game.score - this.displayScore) * (1 - Math.exp(-dt * 12));
    if (Math.abs(game.score - this.displayScore) < 1) this.displayScore = game.score;
    this.el.score.textContent = fmt(this.displayScore);
    this.el.best.textContent = fmt(Math.max(game.best, game.score));

    // timer
    const tl = game.timeLeft;
    this.el.timerFill.style.transform = `scaleX(${Math.min(1, tl / CONFIG.gameTime)})`;
    this.el.timerText.textContent = tl >= 10 ? Math.ceil(tl) : tl > 0 ? tl.toFixed(1) : '0';
    this.el.timer.classList.toggle('urgent', tl < 10 && tl > 0);

    // speed chain
    const lvl = game.speedLevel;
    this.el.speedSegs.forEach((s, i) => s.classList.toggle('on', i < lvl));
    this.el.speedDrain.style.transform = `scaleX(${game.speedDrain()})`;
    this.el.speed.classList.toggle('blazing', game.blazing > 0);

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
    d.style.left = `${x}px`;
    d.style.top = `${y}px`;
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
    this.el.mute.classList.toggle('muted', m);
  }

  // ─── overlays ─────────────────────────────────────────────────────────────

  show(name) {
    for (const k of ['title', 'results', 'pause']) this.el[k].classList.toggle('hidden', k !== name);
  }

  hideOverlays() {
    this.show(null);
  }

  showResults({ score, best, isBest, stats }) {
    $('res-score').textContent = fmt(score);
    $('res-best').textContent = fmt(best);
    $('res-newbest').classList.toggle('hidden', !isBest);
    $('res-chain').textContent = stats.maxChain;
    $('res-popped').textContent = stats.popped;
    $('res-specials').textContent = stats.specials;
    $('res-mult').textContent = `×${stats.maxMult}`;
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
