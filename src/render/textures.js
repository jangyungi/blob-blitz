import * as THREE from 'three';

const cache = new Map();

function canvasTexture(key, w, h, draw) {
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}

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
  glow() {
    return canvasTexture('glow', 128, 128, (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
      g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    });
  },

  star4() {
    return canvasTexture('star4', 256, 256, (ctx, s) => {
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
    });
  },

  rainbowRing() {
    return canvasTexture('rainbowRing', 256, 256, (ctx, s) => {
      const c = s / 2;
      const g = ctx.createConicGradient(0, c, c);
      ['#ff4d6d', '#ffb33b', '#fff04d', '#4dff88', '#4dc3ff', '#9b6bff', '#ff4dd2', '#ff4d6d'].forEach((col, i, a) =>
        g.addColorStop(i / (a.length - 1), col),
      );
      ctx.strokeStyle = g;
      ctx.lineWidth = s * 0.07;
      ctx.shadowColor = 'white';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(c, c, c * 0.8, 0, Math.PI * 2);
      ctx.stroke();
    });
  },

  badge(key, text, from, to) {
    return canvasTexture(`badge:${key}`, 128, 128, (ctx, s) => {
      const c = s / 2;
      const g = ctx.createLinearGradient(0, 0, 0, s);
      g.addColorStop(0, from);
      g.addColorStop(1, to);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(c, c, c - 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 8;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = `900 ${text.length > 1 ? 54 : 78}px "Black Han Sans", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = 6;
      ctx.fillText(text, c, c + 4);
    });
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
