import { CONFIG } from '../config.js';

export const Kind = {
  NORMAL: 'normal',
  BOMB: 'bomb',
  STAR: 'star',
  PRISM: 'prism',
  GARBAGE: 'garbage',
};

export const Tag = {
  MULT: 'mult',
  TIME: 'time',
};

let nextId = 1;

/** color: 0..n-1 for colored blobs, -1 for colorless (garbage, prism). */
export function createBlob(color, kind = Kind.NORMAL, tag = null) {
  return { id: nextId++, color, kind, tag };
}

export const isExplosive = (p) => p && (p.kind === Kind.BOMB || p.kind === Kind.STAR);

/**
 * Pure grid state. x = column (0 = left), y = row (0 = bottom).
 * Rows >= visibleRows are the hidden spawn area; they never pop.
 */
export class Board {
  constructor(cols = CONFIG.cols, rows = CONFIG.totalRows, visible = CONFIG.visibleRows) {
    this.cols = cols;
    this.rows = rows;
    this.visible = visible;
    this.grid = Array.from({ length: cols }, () => new Array(rows).fill(null));
  }

  inBounds(x, y) {
    return x >= 0 && x < this.cols && y >= 0 && y < this.rows;
  }

  get(x, y) {
    return this.inBounds(x, y) ? this.grid[x][y] : null;
  }

  set(x, y, blob) {
    if (this.inBounds(x, y)) this.grid[x][y] = blob;
  }

  /** Piece collision: walls and floor block, open air above the top is free. */
  isFree(x, y) {
    if (x < 0 || x >= this.cols || y < 0) return false;
    if (y >= this.rows) return true;
    return !this.grid[x][y];
  }

  height(x) {
    let h = 0;
    while (h < this.rows && this.grid[x][h]) h++;
    return h;
  }

  forEach(fn) {
    for (let x = 0; x < this.cols; x++) {
      for (let y = 0; y < this.rows; y++) {
        const p = this.grid[x][y];
        if (p) fn(p, x, y);
      }
    }
  }

  count() {
    let n = 0;
    this.forEach(() => n++);
    return n;
  }

  /** Compacts every column downward. Returns the moves that happened. */
  applyGravity() {
    const moves = [];
    for (let x = 0; x < this.cols; x++) {
      let write = 0;
      for (let y = 0; y < this.rows; y++) {
        const p = this.grid[x][y];
        if (!p) continue;
        if (y !== write) {
          this.grid[x][write] = p;
          this.grid[x][y] = null;
          moves.push({ id: p.id, x, from: y, to: write });
        }
        write++;
      }
    }
    return moves;
  }

  /** Connected same-colored groups inside the visible area with at least `min` blobs. */
  findGroups(min = 4) {
    const seen = Array.from({ length: this.cols }, () => new Array(this.visible).fill(false));
    const groups = [];
    for (let x = 0; x < this.cols; x++) {
      for (let y = 0; y < this.visible; y++) {
        const p = this.grid[x][y];
        if (!p || p.color < 0 || seen[x][y]) continue;
        const cells = [];
        const stack = [[x, y]];
        seen[x][y] = true;
        while (stack.length) {
          const [cx, cy] = stack.pop();
          cells.push([cx, cy]);
          for (const [nx, ny] of neighbors(cx, cy)) {
            if (nx < 0 || nx >= this.cols || ny < 0 || ny >= this.visible) continue;
            if (seen[nx][ny]) continue;
            const q = this.grid[nx][ny];
            if (!q || q.color !== p.color) continue;
            seen[nx][ny] = true;
            stack.push([nx, ny]);
          }
        }
        if (cells.length >= min) groups.push({ color: p.color, cells });
      }
    }
    return groups;
  }

  mostCommonColor() {
    const counts = new Map();
    this.forEach((p) => {
      if (p.color >= 0) counts.set(p.color, (counts.get(p.color) || 0) + 1);
    });
    let best = -1;
    let bestN = 0;
    for (const [c, n] of counts) {
      if (n > bestN) {
        best = c;
        bestN = n;
      }
    }
    return best;
  }
}

export function neighbors(x, y) {
  return [
    [x + 1, y],
    [x - 1, y],
    [x, y + 1],
    [x, y - 1],
  ];
}
