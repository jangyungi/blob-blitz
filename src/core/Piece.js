import { CONFIG } from '../config.js';

// rot 0: child above, 1: right, 2: below, 3: left
export const ROT_OFFSETS = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];

/** A falling pair (axis + child) or a single blob (child = null, e.g. PRISM). */
export class Piece {
  constructor(axis, child = null) {
    this.axis = axis;
    this.child = child;
    this.x = CONFIG.spawnX;
    this.y = CONFIG.visibleRows - 1;
    this.rot = 0;
    this.angle = 0; // continuous rotation in quarter turns, used by the view to swing the child
  }

  get single() {
    return !this.child;
  }

  get blobs() {
    return this.child ? [this.axis, this.child] : [this.axis];
  }

  cells(x = this.x, y = this.y, rot = this.rot) {
    const out = [[x, y, this.axis]];
    if (this.child) {
      const [dx, dy] = ROT_OFFSETS[rot];
      out.push([x + dx, y + dy, this.child]);
    }
    return out;
  }

  fits(board, x = this.x, y = this.y, rot = this.rot) {
    return this.cells(x, y, rot).every(([cx, cy]) => board.isFree(cx, cy));
  }

  /** Where each blob would come to rest after a hard drop (accounts for the pair splitting). */
  landing(board) {
    let y = this.y;
    while (this.fits(board, this.x, y - 1, this.rot)) y--;
    const cells = this.cells(this.x, y, this.rot).sort((a, b) => a[1] - b[1]);
    const used = new Map();
    return cells.map(([cx, , blob]) => {
      const h = board.height(cx) + (used.get(cx) || 0);
      used.set(cx, (used.get(cx) || 0) + 1);
      return [cx, h, blob];
    });
  }
}
