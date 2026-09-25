import { CONFIG } from './config.js';
import { EventBus } from './core/EventBus.js';
import { Game, State } from './core/Game.js';
import { Renderer } from './render/Renderer.js';
import { BoardView } from './render/BoardView.js';
import { computeLayout } from './render/Layout.js';
import { BattleStage } from './battle/BattleStage.js';
import { HUD } from './ui/HUD.js';
import { Input } from './input/Input.js';
import { Sfx } from './audio/Sfx.js';

// ?ending=death / ?ending=escape forces one outro (handy for comparing them)
const endingParam = new URLSearchParams(location.search).get('ending');
if (endingParam === 'death' || endingParam === 'escape') CONFIG.battle.ending = endingParam;

await Promise.race([document.fonts.load('11px Galmuri11'), new Promise((r) => setTimeout(r, 1200))]).catch(() => {});

const canvas = document.getElementById('c');
const bus = new EventBus();
const renderer = new Renderer(canvas);
const stage = new BattleStage(renderer);
const view = new BoardView(renderer, bus);
const hud = new HUD();
const sfx = new Sfx();
let layout = null;
const input = new Input(canvas, () => (layout ? layout.unit : 40));
const game = new Game({ bus, view, input });
game.outro = (ending) => stage.playEnding(ending);
let paused = false;

// ─── layout ───────────────────────────────────────────────────────────────

function resize() {
  layout = computeLayout(window.innerWidth, window.innerHeight);
  renderer.setSize(layout.width, layout.height, layout.px);
  view.setLayout(layout);
  stage.setFocus(layout);
  hud.layout(view);
  needsRender = true;
}
let needsRender = true;
window.addEventListener('resize', resize);
resize();

// ─── settings ─────────────────────────────────────────────────────────────

const CRT_KEY = 'blobBlitz.crt';
let crt = true;
try {
  crt = localStorage.getItem(CRT_KEY) !== '0';
} catch {
  /* storage unavailable */
}
hud.setCrt(crt);
function toggleCrt() {
  crt = !crt;
  hud.setCrt(crt);
  try {
    localStorage.setItem(CRT_KEY, crt ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
}

// ─── flow control ─────────────────────────────────────────────────────────

function startRound() {
  sfx.unlock();
  paused = false;
  hud.resetRound();
  hud.hideOverlays();
  stage.reset();
  game.start();
}

function setPaused(p) {
  if (game.state !== State.PLAY && game.state !== State.COUNTDOWN && game.state !== State.HURRAH) return;
  paused = p;
  hud.show(p ? 'pause' : null);
}

input.onPress((action) => {
  sfx.unlock();
  if (action === 'mute') hud.setMuted(sfx.toggleMute());
  else if (action === 'crt') toggleCrt();
  else if (action === 'pause') setPaused(!paused);
  else if (action === 'confirm') {
    if (game.state === State.TITLE || game.state === State.RESULTS) startRound();
    else if (paused) setPaused(false);
  }
});

document.addEventListener('click', (e) => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'start') startRound();
  if (action === 'resume') setPaused(false);
});
document.getElementById('btn-pause').addEventListener('click', () => setPaused(!paused));
document.getElementById('btn-crt').addEventListener('click', toggleCrt);
document.getElementById('btn-mute').addEventListener('click', () => {
  sfx.unlock();
  hud.setMuted(sfx.toggleMute());
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && !paused) setPaused(true);
});

// ─── gameplay events → presentation (HUD / audio / battle stage) ─────────

bus.on('countdown', (n) => {
  hud.callout(n > 0 ? String(n) : 'GO!', n > 0 ? 'count' : 'go', n > 0 ? 620 : 900);
  sfx.countdown(n);
});
bus.on('move', () => sfx.move());
bus.on('rotate', () => sfx.rotate());
bus.on('land', ({ hard }) => sfx.land(hard));

bus.on('step', ({ step, chain, points, colors, count, center, blazing, hurrah }) => {
  if (step.type === 'crush') return;
  if (step.type === 'prism') {
    sfx.prism();
    hud.callout('PRISM!', 'prism', 900);
  } else if (chain > 0) {
    sfx.pop(chain);
  }
  if (chain >= 2) hud.floatWorld(center.x, center.y + 0.9, `${chain} 연쇄!`, 'chain');
  if (points > 0) hud.floatWorld(center.x, center.y, `+${points.toLocaleString('en-US')}`, points >= 2000 ? 'big' : '');
  stage.attack({ chain: Math.max(1, chain), count, colors, points, blazing, hurrah });
});

bus.on('blast', (b) => (b.kind === 'bomb' ? sfx.bomb() : sfx.star()));
bus.on('special', () => sfx.special());
bus.on('prismGranted', () => {
  sfx.prismGranted();
  hud.floatWorld(7.4, 11.2, 'PRISM!', 'mult');
});

bus.on('mult', ({ mult, up }) => {
  if (!up) return;
  sfx.multUp();
  hud.floatWorld(7.4, 5.2, `×${mult}`, 'mult');
});

bus.on('timeBonus', ({ seconds, source }) => {
  const label = `+${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}초`;
  if (source === 'chain') {
    sfx.chainTime(seconds);
    hud.floatWorld(2.5, -0.3, label, 'time small');
  } else {
    if (source === 'gauge') sfx.gauge();
    else sfx.timeBonus();
    hud.flashTimer('bonus');
    hud.floatWorld(2.5, -0.3, source === 'gauge' ? `게이지 ${label}` : label, 'time');
  }
});

bus.on('speed', ({ level, bonus }) => {
  if (level >= 2) {
    sfx.speed(level);
    hud.floatWorld(7.4, 2.6, `SPEED +${bonus.toLocaleString('en-US')}`, 'speed');
  }
});

bus.on('blazing', (on) => {
  view.setBlazing(on);
  stage.onBlazing(on);
  hud.setBlazing(on);
  if (on) {
    sfx.blazing();
    hud.callout('BLAZING<br>SPEED!<small>점수 ×2</small>', 'blazing', 1300);
  }
});

bus.on('overflow', ({ penalty }) => {
  sfx.overflow();
  stage.onOverflow();
  hud.flashTimer('penalty');
  hud.callout(`OVERFLOW!<small>-${penalty}초 · 배수 감소</small>`, 'danger', 1200);
});

bus.on('timeup', () => {
  sfx.timeUp();
  sfx.menace();
  stage.onTimeUp();
  hud.callout('TIME UP!', 'danger', 1000);
});

bus.on('hurrah', () => {
  sfx.hurrah();
  hud.callout('LAST<br>HURRAH!<small>남은 특수 블롭 전부 폭발</small>', 'hurrah', 1600);
});

stage.onCue = (name, x, y) => {
  if (name === 'ko') {
    sfx.ko();
    hud.callout('K.O.', 'ko', 1600);
  } else if (name === 'smoke') {
    sfx.smoke();
  } else if (name === 'escaped') {
    sfx.escaped();
    hud.callout('ESCAPED!', 'escaped', 1400);
  } else if (name === 'confused') {
    sfx.confused();
    hud.floatScreen(x, y, '?', 'confused');
  }
};

bus.on('results', (res) => {
  sfx.results(res.isBest);
  hud.showResults(res);
});

stage.onDamage = (x, y, amount, big) =>
  hud.floatScreen(x + (Math.random() - 0.5) * 40, y, amount.toLocaleString('en-US'), big ? 'damage big' : 'damage');

// last-10-seconds tick
let lastSecond = null;
bus.on('state', () => (lastSecond = null));
function tickClock() {
  if (game.state !== State.PLAY || game.timeUp) return;
  const s = Math.ceil(game.timeLeft);
  if (s !== lastSecond) {
    if (lastSecond !== null && s <= 10 && s > 0) sfx.tick(s <= 5);
    lastSecond = s;
  }
}

// ─── main loop ────────────────────────────────────────────────────────────
// Capped at 60fps in play (120Hz phones would otherwise do double work) and 30fps on
// menus; nothing is simulated or drawn while paused – the last frame just stays up.

hud.show('title');
const debug = { timeScale: 1 };
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const active = game.state === State.PLAY || game.state === State.COUNTDOWN || game.state === State.HURRAH;
  const minStep = active ? 1000 / 61 : 1000 / 31;
  if (now - last < minStep - 1.5) return; // small tolerance for rAF jitter
  const dt = Math.min(0.05, (now - last) / 1000) * debug.timeScale;
  last = now;
  if (paused) {
    if (needsRender) render();
    input.endFrame();
    return;
  }
  game.update(dt);
  view.update(dt, game);
  stage.update(dt);
  tickClock();
  hud.update(game, dt);
  render();
  input.endFrame();
}

function render() {
  needsRender = false;
  renderer.render([
    { scene: stage.scene, camera: stage.camera },
    { scene: view.scene, camera: view.camera, rect: layout.board },
  ]);
}
requestAnimationFrame(frame);

// handy for tuning from the devtools console (e.g. blitz.debug.timeScale = 0.2 for slow-mo)
window.blitz = { game, view, stage, bus, debug };
