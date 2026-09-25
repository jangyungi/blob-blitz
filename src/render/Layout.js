// World-space window of the board scene (1 unit = 1 cell).
// Cell (x, y) is centered at world (x, y). Board well spans x -0.5..5.5, y -0.5..11.5,
// the NEXT column sits at x ≈ 7.4, the score band above y 12.6 and the timer below y -0.5.
export const BOARD_WORLD = { left: -1.0, right: 9.0, bottom: -1.35, top: 14.4 };

const W = BOARD_WORLD.right - BOARD_WORLD.left;
const H = BOARD_WORLD.top - BOARD_WORLD.bottom;
export const BOARD_ASPECT = W / H;

// Target size of one board cell in rendered pixels – the "resolution" of the retro look.
// Bigger = sharper (and more GPU work); smaller = chunkier.
export const CELL_PIXELS = 24;

/**
 * Where the board goes on screen and where the battle stage should center its action.
 *
 * One rendered pixel is a whole number of *device* pixels (`devPx`), so the pixelated upscale
 * is perfectly even on any screen density. In CSS terms that is `px = devPx / dpr` (may be
 * fractional). Everything is snapped to whole rendered pixels: `virtual` holds the integer
 * rendered-pixel sizes for the renderer, the rest is in CSS px for the DOM HUD.
 */
export function computeLayout(viewW, viewH, dpr = 1) {
  // hidden / collapsed containers report 0x0; keep sizes positive so WebGL never sees negatives
  viewW = Math.max(viewW, 120);
  viewH = Math.max(viewH, 120);
  const raw = rawLayout(viewW, viewH);
  const devPx = Math.max(1, Math.round((raw.unit * dpr) / CELL_PIXELS));
  const px = devPx / dpr;
  const toV = (v) => Math.round(v / px);
  const vw = Math.ceil(viewW / px - 1e-6);
  const vh = Math.ceil(viewH / px - 1e-6);
  const vb = { x: toV(raw.board.x), y: toV(raw.board.y), w: toV(raw.board.w), h: toV(raw.board.h) };
  const board = { x: vb.x * px, y: vb.y * px, w: vb.w * px, h: vb.h * px };
  return {
    ...raw,
    width: vw * px,
    height: vh * px,
    px,
    board,
    unit: board.h / H,
    virtual: { w: vw, h: vh, board: vb },
  };
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
