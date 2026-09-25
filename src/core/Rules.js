import { CONFIG } from '../config.js';
import { Kind, isExplosive, neighbors } from './Board.js';

// Pure functions that decide *what* a resolution step destroys/creates.
// They never mutate the board; Game applies the result and BoardView animates it.
//
// Step shape:
// {
//   type: 'pop' | 'prism' | 'detonate' | 'crush',
//   groups:    [{ color, cells: [[x,y]...] }],
//   destroyed: [{ x, y, p, cause, blast }],   // blast = index into blasts, -1 if popped directly
//   created:   [{ x, y, kind, color }],        // specials left behind by big groups
//   blasts:    [{ kind, x, y, color, cells }], // in detonation order
//   prism:     { x, y, color } | null,
// }

const key = (x, y) => `${x},${y}`;

function blastArea(board, kind, x, y) {
  const out = [];
  if (kind === Kind.BOMB) {
    const r = CONFIG.specials.bombRadius;
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if ((dx === 0 && dy === 0) || Math.abs(dx) + Math.abs(dy) > r) continue;
        if (board.inBounds(x + dx, y + dy)) out.push([x + dx, y + dy]);
      }
    }
  } else if (kind === Kind.STAR) {
    for (let cx = 0; cx < board.cols; cx++) if (cx !== x) out.push([cx, y]);
    for (let cy = 0; cy < board.rows; cy++) if (cy !== y) out.push([x, cy]);
  }
  return out;
}

/** Detonates every explosive blob inside `destroyed`, recursively. Mutates `destroyed`. */
function detonate(board, destroyed) {
  const queue = [...destroyed.values()].filter((d) => isExplosive(d.p));
  const blasts = [];
  while (queue.length) {
    const src = queue.shift();
    const cells = blastArea(board, src.p.kind, src.x, src.y);
    const index = blasts.length;
    blasts.push({ kind: src.p.kind, x: src.x, y: src.y, color: src.p.color, cells });
    for (const [cx, cy] of cells) {
      const k = key(cx, cy);
      if (destroyed.has(k)) continue;
      const p = board.get(cx, cy);
      if (!p) continue;
      const entry = { x: cx, y: cy, p, cause: src.p.kind, blast: index };
      destroyed.set(k, entry);
      if (isExplosive(p)) queue.push(entry);
    }
  }
  return blasts;
}

function pickAnchor(board, cells, recentIds) {
  if (recentIds) {
    const recent = cells.find(([x, y]) => recentIds.has(board.get(x, y)?.id));
    if (recent) return recent;
  }
  return cells.reduce((best, c) => (c[1] < best[1] || (c[1] === best[1] && c[0] < best[0]) ? c : best));
}

export function computePopStep(board, recentIds = null) {
  const groups = board.findGroups();
  if (!groups.length) return null;
  const destroyed = new Map();
  const created = [];

  for (const g of groups) {
    for (const [x, y] of g.cells) {
      destroyed.set(key(x, y), { x, y, p: board.get(x, y), cause: 'group', blast: -1 });
    }
    const size = g.cells.length;
    let kind = null;
    if (size >= CONFIG.specials.starAt) kind = Kind.STAR;
    else if (size >= CONFIG.specials.bombAt) kind = Kind.BOMB;
    if (kind) {
      const [ax, ay] = pickAnchor(board, g.cells, recentIds);
      created.push({ x: ax, y: ay, kind, color: g.color });
    }
  }

  // Garbage touching a popped group dissolves with it.
  for (const g of groups) {
    for (const [x, y] of g.cells) {
      for (const [nx, ny] of neighbors(x, y)) {
        const p = board.get(nx, ny);
        if (p && p.kind === Kind.GARBAGE && ny < board.visible && !destroyed.has(key(nx, ny))) {
          destroyed.set(key(nx, ny), { x: nx, y: ny, p, cause: 'garbage', blast: -1 });
        }
      }
    }
  }

  const blasts = detonate(board, destroyed);
  return { type: 'pop', groups, destroyed: [...destroyed.values()], created, blasts, prism: null };
}

/** A prism piece that just landed at (x, y) wipes every blob of the color beneath it. */
export function computePrismStep(board, x, y) {
  const self = board.get(x, y);
  const below = board.get(x, y - 1);
  const color = below && below.color >= 0 ? below.color : board.mostCommonColor();
  const destroyed = new Map();
  destroyed.set(key(x, y), { x, y, p: self, cause: 'prism', blast: -1 });
  if (color >= 0) {
    board.forEach((p, cx, cy) => {
      if (p.color === color) destroyed.set(key(cx, cy), { x: cx, y: cy, p, cause: 'prism', blast: -1 });
    });
  }
  const blasts = detonate(board, destroyed);
  return { type: 'prism', groups: [], destroyed: [...destroyed.values()], created: [], blasts, prism: { x, y, color } };
}

/** LAST HURRAH: set off a single special by force. */
export function computeDetonateStep(board, x, y) {
  const p = board.get(x, y);
  if (!isExplosive(p)) return null;
  const destroyed = new Map([[key(x, y), { x, y, p, cause: 'hurrah', blast: -1 }]]);
  const blasts = detonate(board, destroyed);
  return { type: 'detonate', groups: [], destroyed: [...destroyed.values()], created: [], blasts, prism: null };
}

/** OVERFLOW penalty: crush the top of the stack. */
export function computeCrushStep(board, fromRow) {
  const destroyed = [];
  board.forEach((p, x, y) => {
    if (y >= fromRow) destroyed.push({ x, y, p, cause: 'crush', blast: -1 });
  });
  return { type: 'crush', groups: [], destroyed, created: [], blasts: [], prism: null };
}

export function scoreStep(step, chain) {
  const S = CONFIG.score;
  const pick = (arr, i) => arr[Math.min(i, arr.length - 1)];
  let points = 0;
  if (step.groups.length) {
    const count = step.groups.reduce((n, g) => n + g.cells.length, 0);
    const colors = new Set(step.groups.map((g) => g.color)).size;
    const groupBonus = step.groups.reduce((n, g) => n + pick(S.groupBonus, g.cells.length), 0);
    const power = pick(S.chainPower, chain) + groupBonus + pick(S.colorBonus, colors);
    points += count * S.base * Math.max(1, power);
  }
  for (const d of step.destroyed) {
    if (d.cause === 'group' || d.cause === 'crush') continue;
    points += d.cause === 'prism' ? S.prismCell : S.blastCell;
  }
  return points;
}
