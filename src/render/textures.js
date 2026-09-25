import * as THREE from 'three';

const cache = new Map();

function canvasTexture(key, w, h, draw, { pixel = false } = {}) {
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (pixel) {
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
  }
  cache.set(key, tex);
  return tex;
}

/** Writes an RGBA pixel grid through a callback: fn(x, y) -> [r,g,b,a] | null. */
function paint(ctx, w, h, fn) {
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = fn(x, y);
      if (!c) continue;
      const i = (y * w + x) * 4;
      img.data[i] = c[0];
      img.data[i + 1] = c[1];
      img.data[i + 2] = c[2];
      img.data[i + 3] = c[3] ?? 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

// prettier-ignore
const BADGE_ART = {
  mult: [
    '....####....',
    '..##ffff##..',
    '.#ffffffff#.',
    '.#fXffffXf#.',
    '#fffXffXfff#',
    '#ffffXXffff#',
    '#ffffXXffff#',
    '#fffXffXfff#',
    '.#fXffffXf#.',
    '.#ffffffff#.',
    '..##ffff##..',
    '....####....',
  ],
  time: [
    '....####....',
    '..##ffff##..',
    '.#ffffXfff#.',
    '.#ffffXfff#.',
    '#fffffXffff#',
    '#fffffXffff#',
    '#fffffXXXff#',
    '#ffffffffff#',
    '.#ffffffff#.',
    '.#ffffffff#.',
    '..##ffff##..',
    '....####....',
  ],
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export const Tex = {
  /**
   * Cel-shaded sphere for MeshMatcapMaterial: 4 flat tones, a hard white highlight and a dark
   * outline ring. One texture lookup per pixel, no lights – the cheapest "glossy blob" there is.
   */
  matcap(hex) {
    return canvasTexture(
      `matcap:${hex}`,
      64,
      64,
      (ctx, s) => {
        const base = new THREE.Color(hex);
        const L = new THREE.Vector3(-0.45, 0.6, 0.66).normalize();
        const tones = [0.42, 0.62, 0.82, 1.0];
        paint(ctx, s, s, (x, y) => {
          const nx = ((x + 0.5) / s) * 2 - 1;
          const ny = 1 - ((y + 0.5) / s) * 2;
          const r2 = nx * nx + ny * ny;
          if (r2 > 1) return [0, 0, 0, 255];
          const nz = Math.sqrt(1 - r2);
          if (nz < 0.3) return [base.r * 60, base.g * 60, base.b * 60]; // outline
          const d = Math.max(0, nx * L.x + ny * L.y + nz * L.z);
          const shade = tones[Math.min(3, Math.floor((0.25 + 0.75 * d) * 4))];
          const spec = Math.pow(Math.max(0, d), 24);
          if (spec > 0.55) return [255, 255, 255];
          const k = shade * 255;
          return [Math.min(255, base.r * k + 12), Math.min(255, base.g * k + 12), Math.min(255, base.b * k + 12)];
        });
      },
      { pixel: true },
    );
  },

  /** Banded + dithered radial glow (for additive sprites). */
  glow() {
    return canvasTexture(
      'glow',
      32,
      32,
      (ctx, s) => {
        paint(ctx, s, s, (x, y) => {
          const d = Math.hypot(x + 0.5 - s / 2, y + 0.5 - s / 2) / (s / 2);
          if (d >= 1) return null;
          const a = (1 - d) ** 1.6;
          const level = Math.floor(a * 4 + BAYER4[(y % 4) * 4 + (x % 4)] / 16) / 4;
          return level > 0 ? [255, 255, 255, Math.round(level * 255)] : null;
        });
      },
      { pixel: true },
    );
  },

  /** 12x12 pixel-art coin badges. kind: 'mult' (×) | 'time' (clock) */
  pixelBadge(kind) {
    const pal =
      kind === 'mult'
        ? { f: [255, 207, 51], '#': [122, 74, 0], X: [255, 255, 255] }
        : { f: [94, 220, 255], '#': [16, 70, 140], X: [255, 255, 255] };
    const art = BADGE_ART[kind];
    return canvasTexture(`pixelBadge:${kind}`, 12, 12, (ctx) => paint(ctx, 12, 12, (x, y) => pal[art[y][x]] || null), {
      pixel: true,
    });
  },

  star4() {
    return canvasTexture('star4', 32, 32, (ctx, s) => {
      const c = s / 2;
      const g = ctx.createRadialGradient(c, c, 0, c, c, c);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.7)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
        const r = i % 2 === 0 ? c : c * 0.16;
        const x = c + Math.cos(a) * r;
        const y = c + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    }, { pixel: true });
  },

  rainbowRing() {
    return canvasTexture('rainbowRing', 32, 32, (ctx, s) => {
      const c = s / 2;
      const g = ctx.createConicGradient(0, c, c);
      ['#ff4d6d', '#ffb33b', '#fff04d', '#4dff88', '#4dc3ff', '#9b6bff', '#ff4dd2', '#ff4d6d'].forEach((col, i, a) =>
        g.addColorStop(i / (a.length - 1), col),
      );
      ctx.strokeStyle = g;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(c, c, c * 0.8, 0, Math.PI * 2);
      ctx.stroke();
    }, { pixel: true });
  },

  cross() {
    return canvasTexture('cross', 128, 128, (ctx, s) => {
      ctx.strokeStyle = '#ff3355';
      ctx.lineWidth = 14;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(s * 0.25, s * 0.25);
      ctx.lineTo(s * 0.75, s * 0.75);
      ctx.moveTo(s * 0.75, s * 0.25);
      ctx.lineTo(s * 0.25, s * 0.75);
      ctx.stroke();
    });
  },

  well(cols, rows) {
    const cell = 48;
    return canvasTexture(`well:${cols}x${rows}`, cols * cell, rows * cell, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, 'rgba(22,26,64,0.92)');
      g.addColorStop(1, 'rgba(8,10,30,0.96)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      for (let x = 0; x < cols; x++) {
        if (x % 2) {
          ctx.fillStyle = 'rgba(255,255,255,0.025)';
          ctx.fillRect(x * cell, 0, cell, h);
        }
      }
      ctx.fillStyle = 'rgba(160,180,255,0.18)';
      for (let x = 1; x < cols; x++) {
        for (let y = 1; y < rows; y++) {
          ctx.beginPath();
          ctx.arc(x * cell, y * cell, 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });
  },

  panel(key, w, h) {
    const px = 64;
    return canvasTexture(`panel:${key}`, Math.round(w * px), Math.round(h * px), (ctx, cw, ch) => {
      roundRect(ctx, 4, 4, cw - 8, ch - 8, 28);
      const g = ctx.createLinearGradient(0, 0, 0, ch);
      g.addColorStop(0, 'rgba(24,28,70,0.88)');
      g.addColorStop(1, 'rgba(10,12,34,0.88)');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(140,155,255,0.55)';
      ctx.stroke();
    });
  },

  frameGlow(key, w, h) {
    const px = 48;
    const pad = 40;
    return canvasTexture(`frameGlow:${key}`, Math.round(w * px) + pad * 2, Math.round(h * px) + pad * 2, (ctx, cw, ch) => {
      ctx.shadowColor = 'white';
      ctx.shadowBlur = 26;
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 10;
      roundRect(ctx, pad, pad, cw - pad * 2, ch - pad * 2, 18);
      ctx.stroke();
      ctx.stroke();
    });
  },
};

/** Extra margin (in world units) that frameGlow adds around its rect, for sizing its plane. */
export const FRAME_GLOW_PAD = 40 / 48;
