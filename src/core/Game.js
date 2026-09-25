import { CONFIG } from '../config.js';
import { Board, Kind, Tag, createBlob, isExplosive } from './Board.js';
import { Piece, ROT_OFFSETS } from './Piece.js';
import {
  computePopStep,
  computePrismStep,
  computeDetonateStep,
  computeCrushStep,
  scoreStep,
} from './Rules.js';

export const State = {
  TITLE: 'title',
  COUNTDOWN: 'countdown',
  PLAY: 'play',
  HURRAH: 'hurrah',
  RESULTS: 'results',
};

const BEST_KEY = 'blobBlitz.best';
const COUNTDOWN_TICK = 0.62;

function loadBest() {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function saveBest(v) {
  try {
    localStorage.setItem(BEST_KEY, String(v));
  } catch {
    /* storage unavailable (private mode etc.) */
  }
}

const randInt = (n) => Math.floor(Math.random() * n);

/**
 * Owns the rules and the round flow. Knows nothing about three.js:
 * it drives `view` through a small interface (reset / playStep / onLock / discard / settled)
 * and broadcasts everything else on the event bus.
 */
export class Game {
  constructor({ bus, view, input }) {
    this.bus = bus;
    this.view = view;
    this.input = input;
    this.best = loadBest();
    this.run = 0;
    this.state = State.TITLE;
    this.reset();
  }

  // ─── lifecycle ────────────────────────────────────────────────────────────

  reset() {
    this.run++;
    this.timers = [];
    this.board = new Board();
    this.queue = [];
    this.piecesMade = 0;
    this.active = null;
    this.phase = 'idle'; // idle | control | resolve | hurrah
    this.score = 0;
    this.mult = 1;
    this.timeLeft = CONFIG.gameTime;
    this.clock = 0;
    this.timeUp = false;
    this.speedLevel = 0;
    this.lastClearEnd = -Infinity;
    this.blazing = 0;
    this.fallTimer = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.das = { dir: 0, timer: 0, charged: false };
    this.stats = { maxChain: 0, popped: 0, specials: 0, prisms: 0, maxMult: 1, bestStep: 0 };
    this.fillQueue();
    this.view.reset(this);
  }

  start() {
    this.reset();
    this.state = State.COUNTDOWN;
    this.countdown = 3 * COUNTDOWN_TICK;
    this.bus.emit('state', this.state);
    this.bus.emit('countdown', 3);
  }

  update(dt) {
    this.tickTimers(dt);

    if (this.state === State.COUNTDOWN) {
      const before = Math.ceil(this.countdown / COUNTDOWN_TICK);
      this.countdown -= dt;
      const after = Math.ceil(this.countdown / COUNTDOWN_TICK);
      if (after !== before) this.bus.emit('countdown', Math.max(0, after));
      if (this.countdown <= 0) {
        this.state = State.PLAY;
        this.bus.emit('state', this.state);
        this.spawn();
      }
      return;
    }

    if (this.state !== State.PLAY) return;

    this.clock += dt;
    if (!this.timeUp) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) this.setTimeUp();
    }

    if (this.blazing > 0) {
      this.blazing -= dt;
      if (this.blazing <= 0) {
        this.blazing = 0;
        this.bus.emit('blazing', false);
      }
    }

    if (this.speedLevel > 0 && this.phase === 'control' && this.clock - this.lastClearEnd > CONFIG.speed.window) {
      this.speedLevel = 0;
      this.bus.emit('speed', { level: 0, bonus: 0 });
    }

    if (this.phase === 'control') {
      if (this.timeUp) {
        this.view.discard(this.active.blobs);
        this.active = null;
        this.lastHurrah();
        return;
      }
      this.updateControl(dt);
    }
  }

  setTimeUp() {
    this.timeLeft = 0;
    if (this.timeUp) return;
    this.timeUp = true;
    this.bus.emit('timeup');
  }

  // ─── scheduling (pause-aware, advances with game dt) ─────────────────────

  delay(seconds) {
    return new Promise((resolve) => this.timers.push({ t: seconds, resolve }));
  }

  tickTimers(dt) {
    if (!this.timers.length) return;
    const due = [];
    this.timers = this.timers.filter((tm) => {
      tm.t -= dt;
      if (tm.t <= 0) {
        due.push(tm.resolve);
        return false;
      }
      return true;
    });
    due.forEach((r) => r());
  }

  // ─── pieces ───────────────────────────────────────────────────────────────

  fillQueue() {
    while (this.queue.length < 3) this.queue.push(this.makePair());
  }

  makePair() {
    const index = this.piecesMade++;
    const colors = index < 2 ? 3 : CONFIG.numColors; // gentle opening
    const a = createBlob(randInt(colors));
    const b = createBlob(randInt(colors));
    if (index >= 2) {
      const S = CONFIG.specials;
      const pendingMult = this.queue.reduce((n, p) => n + p.blobs.filter((q) => q.tag === Tag.MULT).length, 0);
      const r = Math.random();
      const target = Math.random() < 0.5 ? a : b;
      if (r < S.multChance) {
        if (this.mult + pendingMult < S.maxMult) target.tag = Tag.MULT;
      } else if (r < S.multChance + S.timeChance) {
        target.tag = Tag.TIME;
      }
    }
    return new Piece(a, b);
  }

  grantPrism() {
    if (this.queue.some((p) => p.axis.kind === Kind.PRISM)) return;
    this.queue.unshift(new Piece(createBlob(-1, Kind.PRISM)));
    this.stats.prisms++;
    this.bus.emit('prismGranted');
  }

  spawn() {
    const piece = this.queue.shift();
    this.fillQueue();
    piece.x = CONFIG.spawnX;
    piece.y = CONFIG.visibleRows - 1;
    piece.rot = 0;
    piece.angle = 0;
    this.active = piece;
    this.phase = 'control';
    this.fallTimer = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.bus.emit('spawn', piece);
  }

  fallInterval() {
    const C = CONFIG.control;
    const t = Math.min(1, this.clock / CONFIG.gameTime);
    return C.fallInterval + (C.fallIntervalEnd - C.fallInterval) * t;
  }

  updateControl(dt) {
    const inp = this.input;
    const p = this.active;
    const C = CONFIG.control;

    for (let i = inp.count('rotCW'); i > 0; i--) this.rotate(1);
    for (let i = inp.count('rotCCW'); i > 0; i--) this.rotate(-1);

    const lefts = inp.count('left');
    const rights = inp.count('right');
    for (let i = 0; i < lefts; i++) this.shift(-1);
    for (let i = 0; i < rights; i++) this.shift(1);

    const dir = inp.horizontal();
    if (lefts || rights) {
      this.das = { dir, timer: 0, charged: false };
    } else if (dir !== 0) {
      if (dir !== this.das.dir) {
        this.das = { dir, timer: 0, charged: false };
      } else {
        this.das.timer += dt;
        if (!this.das.charged && this.das.timer >= C.das) {
          this.das.charged = true;
          this.das.timer -= C.das;
          this.shift(dir);
        }
        if (this.das.charged) {
          while (this.das.timer >= C.arr) {
            this.das.timer -= C.arr;
            if (!this.shift(dir)) {
              this.das.timer = 0;
              break;
            }
          }
        }
      }
    } else {
      this.das.dir = 0;
    }

    if (inp.count('hardDrop')) {
      let cells = 0;
      while (p.fits(this.board, p.x, p.y - 1)) {
        p.y--;
        cells++;
      }
      this.addScore(cells * CONFIG.score.softDropCell * 2);
      this.lock(true);
      return;
    }

    const soft = inp.held('soft');
    const interval = soft ? C.softDropInterval : this.fallInterval();
    if (p.fits(this.board, p.x, p.y - 1)) {
      this.lockTimer = 0;
      this.fallTimer += dt;
      while (this.fallTimer >= interval) {
        this.fallTimer -= interval;
        if (!p.fits(this.board, p.x, p.y - 1)) {
          this.fallTimer = 0;
          break;
        }
        p.y--;
        if (soft) this.addScore(CONFIG.score.softDropCell);
      }
    } else {
      this.fallTimer = 0;
      this.lockTimer += dt;
      if (this.lockTimer >= (soft ? C.softLockDelay : C.lockDelay)) this.lock(false);
    }
  }

  onPieceMoved() {
    const p = this.active;
    if (!p.fits(this.board, p.x, p.y - 1) && this.lockResets < CONFIG.control.maxLockResets) {
      this.lockTimer = 0;
      this.lockResets++;
    }
  }

  shift(dir) {
    const p = this.active;
    if (!p || !p.fits(this.board, p.x + dir, p.y)) return false;
    p.x += dir;
    this.onPieceMoved();
    this.bus.emit('move');
    return true;
  }

  rotate(dir) {
    const p = this.active;
    if (!p || p.single) return false;
    const attempt = (rot, turn) => {
      const [dx, dy] = ROT_OFFSETS[rot];
      for (const [kx, ky] of [
        [0, 0],
        [-dx, -dy], // kick away from whatever blocks the child
      ]) {
        if (p.fits(this.board, p.x + kx, p.y + ky, rot)) {
          p.x += kx;
          p.y += ky;
          p.rot = rot;
          p.angle += turn;
          this.onPieceMoved();
          this.bus.emit('rotate');
          return true;
        }
      }
      return false;
    };
    // normal quarter turn, then a quick 180° flip when squeezed into a 1-wide well
    return attempt((p.rot + dir + 4) % 4, dir) || attempt((p.rot + 2) % 4, 2 * dir);
  }

  lock(hard) {
    const p = this.active;
    this.active = null;
    const placed = new Set();
    const discarded = [];
    for (const [x, y, blob] of p.cells()) {
      if (y < this.board.rows) {
        this.board.set(x, y, blob);
        placed.add(blob.id);
      } else {
        discarded.push(blob);
      }
    }
    if (discarded.length) this.view.discard(discarded);
    this.view.onLock(p.blobs, hard);
    this.bus.emit('lock', { hard });
    this.phase = 'resolve';
    const prism = p.single && p.axis.kind === Kind.PRISM ? p.axis : null;
    this.resolve(placed, prism);
  }

  // ─── resolution ───────────────────────────────────────────────────────────

  findBlob(id) {
    let found = null;
    this.board.forEach((p, x, y) => {
      if (p.id === id) found = { x, y };
    });
    return found;
  }

  async resolve(recentIds, prism) {
    const run = this.run;
    const alive = () => run === this.run;

    this.board.applyGravity();
    await this.view.settled();
    if (!alive()) return;

    let chain = 0;
    let started = false;
    const begin = () => {
      if (!started) {
        started = true;
        this.onClearStart();
      }
    };

    if (prism) {
      const pos = this.findBlob(prism.id);
      if (pos) {
        begin();
        await this.playStep(computePrismStep(this.board, pos.x, pos.y), 0);
        if (!alive()) return;
      }
    }

    for (;;) {
      const step = computePopStep(this.board, recentIds);
      if (!step) break;
      begin();
      chain++;
      await this.playStep(step, chain);
      if (!alive()) return;
      recentIds = null;
    }

    if (started) this.onClearEnd(chain);

    if (!this.timeUp && this.board.get(CONFIG.spawnX, CONFIG.visibleRows - 1)) {
      await this.overflow();
      if (!alive()) return;
    }

    if (this.timeUp) this.lastHurrah();
    else this.spawn();
  }

  /** Applies one step to the board, scores it, lets the view animate it, then settles gravity. */
  async playStep(step, chain, { hurrah = false } = {}) {
    const run = this.run;
    const alive = () => run === this.run;

    for (const d of step.destroyed) this.board.set(d.x, d.y, null);

    let points = 0;
    if (step.type !== 'crush') {
      const mul =
        this.mult * (this.blazing > 0 ? CONFIG.speed.blazingMul : 1) * (hurrah ? CONFIG.score.hurrahMul : 1);
      points = Math.round(scoreStep(step, chain) * mul);
      this.addScore(points);
      this.stats.popped += step.destroyed.length;
      this.stats.maxChain = Math.max(this.stats.maxChain, chain);
      this.stats.bestStep = Math.max(this.stats.bestStep, points);

      let multUps = 0;
      let timeBonus = 0;
      for (const d of step.destroyed) {
        if (d.p.tag === Tag.MULT) multUps++;
        else if (d.p.tag === Tag.TIME) timeBonus += CONFIG.specials.timeBonus;
      }
      if (multUps) {
        const before = this.mult;
        this.mult = Math.min(CONFIG.specials.maxMult, this.mult + multUps);
        this.stats.maxMult = Math.max(this.stats.maxMult, this.mult);
        if (this.mult !== before) this.bus.emit('mult', { mult: this.mult, up: true });
      }
      if (timeBonus && !this.timeUp) {
        this.timeLeft += timeBonus;
        this.bus.emit('timeBonus', { seconds: timeBonus });
      }
      if (!hurrah && step.type === 'pop') {
        const big = step.groups.some((g) => g.cells.length >= CONFIG.specials.prismGroupAt);
        if (big || chain >= CONFIG.specials.prismChainAt) this.grantPrism();
      }
    }

    let cx = 0;
    let cy = 0;
    for (const d of step.destroyed) {
      cx += d.x;
      cy += d.y;
    }
    const n = Math.max(1, step.destroyed.length);
    const colors = [...new Set(step.destroyed.map((d) => d.p.color).filter((c) => c >= 0))];

    this.view.playStep(step);
    this.bus.emit('step', {
      step,
      chain,
      points,
      colors,
      count: step.destroyed.length,
      center: { x: cx / n, y: cy / n },
      blazing: this.blazing > 0,
      hurrah,
    });

    await this.view.settled();
    if (!alive()) return;

    for (const c of step.created) {
      this.board.set(c.x, c.y, createBlob(c.color, c.kind));
      this.stats.specials++;
      this.bus.emit('special', c);
    }

    this.board.applyGravity();
    await this.view.settled();
  }

  onClearStart() {
    const S = CONFIG.speed;
    const gap = this.clock - this.lastClearEnd;
    this.speedLevel = gap <= S.window ? this.speedLevel + 1 : 1;
    let bonus = 0;
    if (this.speedLevel >= 2) {
      bonus = CONFIG.score.speedBonus * (this.speedLevel - 1) * this.mult * (this.blazing > 0 ? S.blazingMul : 1);
      this.addScore(bonus);
    }
    this.bus.emit('speed', { level: this.speedLevel, bonus });
    if (this.speedLevel >= S.blazingAt) {
      this.blazing = S.blazingTime;
      this.speedLevel = 0;
      this.bus.emit('blazing', true);
    }
  }

  onClearEnd(chain) {
    this.lastClearEnd = this.clock;
    this.bus.emit('sequenceEnd', { chain });
  }

  /** Speed-chain timer for the HUD: 1 = just cleared, 0 = window expired. */
  speedDrain() {
    if (this.speedLevel <= 0) return 0;
    if (this.phase !== 'control') return 1;
    return Math.max(0, 1 - (this.clock - this.lastClearEnd) / CONFIG.speed.window);
  }

  async overflow() {
    const O = CONFIG.overflow;
    this.timeLeft -= O.timePenalty;
    if (this.timeLeft <= 0) this.setTimeUp();
    this.mult = Math.max(1, Math.floor(this.mult / 2));
    this.speedLevel = 0;
    this.bus.emit('overflow', { penalty: O.timePenalty });
    this.bus.emit('mult', { mult: this.mult, up: false });
    this.bus.emit('speed', { level: 0, bonus: 0 });
    await this.playStep(computeCrushStep(this.board, O.crushFromRow), 0);
  }

  async lastHurrah() {
    const run = this.run;
    const alive = () => run === this.run;
    this.phase = 'hurrah';
    this.state = State.HURRAH;
    this.bus.emit('state', this.state);
    this.bus.emit('hurrah');

    await this.delay(1.1);
    if (!alive()) return;

    for (let round = 0; round < 40; round++) {
      const specials = [];
      this.board.forEach((p, x, y) => {
        if (isExplosive(p) && y < this.board.visible) specials.push([x, y]);
      });
      if (!specials.length) break;
      specials.sort((a, b) => b[1] - a[1]);
      const [x, y] = specials[0];
      await this.playStep(computeDetonateStep(this.board, x, y), 0, { hurrah: true });
      if (!alive()) return;
      for (let chain = 1; ; chain++) {
        const step = computePopStep(this.board);
        if (!step) break;
        await this.playStep(step, chain, { hurrah: true });
        if (!alive()) return;
      }
      await this.delay(0.08);
      if (!alive()) return;
    }

    await this.delay(0.7);
    if (!alive()) return;
    this.finish();
  }

  finish() {
    this.state = State.RESULTS;
    this.phase = 'idle';
    const isBest = this.score > this.best;
    if (isBest) {
      this.best = this.score;
      saveBest(this.best);
    }
    this.bus.emit('state', this.state);
    this.bus.emit('results', { score: this.score, best: this.best, isBest, stats: { ...this.stats } });
  }

  addScore(n) {
    if (n > 0) this.score += Math.round(n);
  }
}
