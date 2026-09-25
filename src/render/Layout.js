// World-space window of the board scene (1 unit = 1 cell).
// Cell (x, y) is centered at world (x, y). Board well spans x -0.5..5.5, y -0.5..11.5,
// the NEXT column sits at x ≈ 7.4, the score band above y 12.6 and the timer below y -0.5.
export const BOARD_WORLD = { left: -1.0, right: 9.0, bottom: -1.35, top: 14.4 };

const W = BOARD_WORLD.right - BOARD_WORLD.left;
const H = BOARD_WORLD.top - BOARD_WORLD.bottom;
export const BOARD_ASPECT = W / H;

// Target size of one board cell in rendered (virtual) pixels – the "resolution" of the retro look.
export const CELL_PIXELS = 18;

/**
 * Where the board goes on screen and where the battle stage should center its action.
 * Everything is snapped to whole virtual pixels (`px` CSS px each) so the pixelated
 * upscale stays crisp and the DOM HUD lines up with the canvas exactly.
 */
export function computeLayout(viewW, viewH) {
  const raw = rawLayout(viewW, viewH);
  const px = Math.max(2, Math.round(raw.board.h / (BOARD_WORLD.top - BOARD_WORLD.bottom) / CELL_PIXELS));
  const snap = (v) => Math.round(v / px) * px;
  const width = Math.ceil(viewW / px) * px;
  const height = Math.ceil(viewH / px) * px;
  const board = { x: snap(raw.board.x), y: snap(raw.board.y), w: snap(raw.board.w), h: snap(raw.board.h) };
  return { ...raw, width, height, px, board, unit: board.h / H };
}

function rawLayout(width, height) {
  const landscape = width / height > 1.05;
  let bw;
  let bh;
  let x;
  let y;
  let focus;
  if (landscape) {
    bh = Math.min(height - 24, (width * 0.56) / BOARD_ASPECT);
    bw = bh * BOARD_ASPECT;
    x = Math.max(12, Math.min(width * 0.1, (width - bw) / 2));
    y = (height - bh) / 2;
    const right = x + bw;
    focus = { x: (right + width) / 2, y: height * 0.52 };
  } else {
    bh = Math.min(height * 0.74, (width - 16) / BOARD_ASPECT);
    bw = bh * BOARD_ASPECT;
    x = (width - bw) / 2;
    y = height - bh - 8;
    focus = { x: width / 2, y: Math.max(y * 0.55, height * 0.12) };
  }
  const board = { x: Math.round(x), y: Math.round(y), w: Math.round(bw), h: Math.round(bh) };
  return { width, height, landscape, board, focus, unit: board.h / H };
}

export function worldToScreen(layout, wx, wy) {
  const r = layout.board;
  return {
    x: r.x + ((wx - BOARD_WORLD.left) / W) * r.w,
    y: r.y + ((BOARD_WORLD.top - wy) / H) * r.h,
  };
}
