import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG, BLOB_COLORS, GARBAGE_COLOR } from '../config.js';
import { Kind, Tag } from '../core/Board.js';
import { BOARD_WORLD, worldToScreen } from './Layout.js';
import { Particles } from './Particles.js';
import { Tex, FRAME_GLOW_PAD } from './textures.js';

const R = 0.46; // blob radius in cells
const NEXT_X = 7.4;
const QUEUE_SLOTS = [
  { x: NEXT_X, y: 9.3, s: 1 },
  { x: NEXT_X, y: 6.95, s: 0.72 },
];
const FRAME = { normal: new THREE.Color(0x6f7dff), blazing: new THREE.Color(0xff7a1a), danger: new THREE.Color(0xff2a4a) };

const damp = (rate, dt) => 1 - Math.exp(-rate * dt);

function buildEyes() {
  const part = (sx, sy, sz, x, y, z, hex) => {
    const g = new THREE.SphereGeometry(1, 8, 6);
    g.scale(sx, sy, sz);
    g.translate(x, y, z);
    const c = new THREE.Color(hex);
    const n = g.attributes.position.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  };
  const parts = [];
  for (const sx of [-1, 1]) {
    parts.push(part(0.105, 0.14, 0.07, sx * 0.15, 0.07, 0.39, 0xffffff));
    parts.push(part(0.055, 0.08, 0.04, sx * 0.162, 0.05, 0.445, 0x0a0a16));
  }
  return mergeGeometries(parts);
}
const colorHex = (c) => (c >= 0 ? BLOB_COLORS[c].hex : GARBAGE_COLOR.hex);

// ─────────────────────────────────────────────────────────────────────────────
// One visual blob. Logic state lives in Game; this only tracks presentation.
// ─────────────────────────────────────────────────────────────────────────────
class BlobMesh {
  constructor(view, blob, x, y, scale) {
    this.view = view;
    this.blob = blob;
    this.group = new THREE.Group();
    this.inner = new THREE.Group();
    this.group.add(this.inner);
    this.body = new THREE.Mesh(view.geo.body, view.materialFor(blob));
    this.inner.add(this.body);
    this.pos = new THREE.Vector2(x, y);
    this.target = new THREE.Vector2(x, y);
    this.vy = 0;
    this.scale = scale;
    this.targetScale = 1;
    this.mode = 'new';
    this.rest = true;
    this.squashT = 1;
    this.squashAmp = 0;
    this.blinkT = 1 + Math.random() * 5;
    this.phase = Math.random() * Math.PI * 2;
    this.owned = [];
    if (this.body.material.userData.owned) this.owned.push(this.body.material);

    if (blob.kind !== Kind.GARBAGE) this.addEyes();
    if (blob.kind === Kind.GARBAGE) this.body.scale.setScalar(0.94);
    if (blob.kind === Kind.BOMB) this.addBomb();
    if (blob.kind === Kind.STAR) this.addStar();
    if (blob.kind === Kind.PRISM) this.addPrism();
    if (blob.tag === Tag.MULT) this.addBadge(view.tex.mult);
    if (blob.tag === Tag.TIME) this.addBadge(view.tex.time);

    view.root.add(this.group);
    this.sync();
  }

  addEyes() {
    this.eyes = new THREE.Mesh(this.view.geo.eyes, this.view.mats.eyes);
    this.inner.add(this.eyes);
  }

  own(material) {
    this.owned.push(material);
    return material;
  }

  addGlow(color, size, opacity) {
    const s = new THREE.Sprite(
      this.own(
        new THREE.SpriteMaterial({
          map: Tex.glow(),
          color,
          transparent: true,
          opacity,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      ),
    );
    s.scale.setScalar(size);
    s.position.z = -0.3;
    this.group.add(s);
    return s;
  }

  addBomb() {
    const c = new THREE.Color(colorHex(this.blob.color)).lerp(new THREE.Color(0xffa040), 0.45);
    this.glow = this.addGlow(c, 1.9, 0.75);
    this.ring = new THREE.Mesh(
      this.view.geo.ring,
      this.own(new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending })),
    );
    this.ring.rotation.x = 1.15;
    this.inner.add(this.ring);
    this.emberT = 0;
  }

  addStar() {
    const c = new THREE.Color(colorHex(this.blob.color)).lerp(new THREE.Color(0xffffff), 0.55);
    this.glow = this.addGlow(c, 1.6, 0.6);
    this.star = new THREE.Sprite(
      this.own(
        new THREE.SpriteMaterial({
          map: Tex.star4(),
          color: c,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      ),
    );
    this.star.scale.setScalar(1.75);
    this.star.position.z = -0.2;
    this.group.add(this.star);
  }

  addPrism() {
    this.prismMat = this.body.material;
    this.glow = this.addGlow(0xffffff, 1.9, 0.6);
    this.halo = new THREE.Sprite(
      this.own(
        new THREE.SpriteMaterial({ map: Tex.rainbowRing(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
      ),
    );
    this.halo.scale.setScalar(1.45);
    this.halo.position.z = 0.5;
    this.group.add(this.halo);
  }

  addBadge(map) {
    const s = new THREE.Sprite(this.own(new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false })));
    s.scale.setScalar(0.62);
    s.position.set(0.24, -0.22, 0.7);
    this.badge = s;
    this.group.add(s);
  }

  update(dt, t) {
    // landing squash (damped wobble)
    let sx = 1;
    let sy = 1;
    if (this.squashT < 1) {
      this.squashT = Math.min(1, this.squashT + dt / 0.38);
      const k = this.squashT;
      const w = this.squashAmp * Math.sin(k * Math.PI * 2.4) * (1 - k);
      sx += w * 0.75;
      sy -= w;
    }
    const breathe = this.mode === 'board' || this.mode === 'active' ? 0.018 * Math.sin(t * 3.1 + this.phase) : 0;
    this.inner.scale.set(sx + breathe, sy - breathe, sx + breathe);
    this.inner.position.y = -(1 - sy) * R;

    if (this.eyes) {
      this.blinkT -= dt;
      if (this.blinkT < 0) this.blinkT = 2 + Math.random() * 5;
      this.eyes.scale.y = this.blinkT < 0.11 ? 0.15 : 1;
    }
    if (this.ring) {
      this.ring.rotation.z += dt * 3;
      const p = 0.5 + 0.5 * Math.sin(t * 7 + this.phase);
      this.glow.material.opacity = 0.45 + 0.45 * p;
      this.glow.scale.setScalar(1.7 + 0.35 * p);
      this.emberT -= dt;
      if (this.emberT < 0 && this.mode === 'board') {
        this.emberT = 0.09;
        this.view.particles.emit(this.pos.x, this.pos.y + 0.3, 0.6, {
          count: 1,
          color: 0xffa040,
          speed: [0.6, 1.4],
          size: [0.12, 0.22],
          life: [0.4, 0.7],
          gravity: 1.5,
          angle: Math.PI / 2,
          spread: 1.2,
          spreadPos: 0.4,
        });
      }
    }
    if (this.star) {
      this.star.material.rotation += dt * 1.6;
      const p = 0.5 + 0.5 * Math.sin(t * 5 + this.phase);
      this.star.scale.setScalar(1.55 + 0.35 * p);
    }
    if (this.halo) {
      this.halo.material.rotation -= dt * 2.5;
      this.prismMat.color.setHSL((t * 0.35) % 1, 0.9, 0.65);
    }
    if (this.badge) {
      this.badge.position.y = -0.22 + 0.03 * Math.sin(t * 4 + this.phase);
    }
    this.sync();
  }

  sync() {
    this.group.position.set(this.pos.x, this.pos.y, 0);
    this.group.scale.setScalar(Math.max(0.0001, this.scale));
  }

  land(impact) {
    this.squashT = 0;
    this.squashAmp = Math.min(0.32, 0.06 + impact * 0.012);
  }

  dispose() {
    this.view.root.remove(this.group);
    this.owned.forEach((m) => m.dispose());
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export class BoardView {
  constructor(renderer, bus) {
    this.renderer = renderer;
    this.bus = bus;
    this.scene = new THREE.Scene();
    const { left, right, top, bottom } = BOARD_WORLD;
    // Far away so the matcap shader's per-pixel view direction is effectively parallel
    // (it assumes perspective; up close, blobs near the edges get skewed shading).
    this.camera = new THREE.OrthographicCamera(left, right, top, bottom, 980, 1020);
    this.camera.position.z = 1000;
    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.time = 0;
    this.layout = null;
    this.meshes = new Map();
    this.dying = [];
    this.fx = [];
    this.tasks = [];
    this.waiters = [];
    this.shakeAmp = 0;
    this.blazing = false;
    this.danger = 0;
    this.activeRef = null;
    this.visAngle = 0;
    this.lockLandPending = false;

    this.seen = new Set();
    this.initResources();
    this.initWell();
    this.initGhost();
    this.initBridges();
    this.particles = new Particles(900);
    this.root.add(this.particles.points);
  }

  // ─── setup ────────────────────────────────────────────────────────────────

  initResources() {
    // Low-poly on purpose: a blob is only ~18 rendered pixels wide.
    this.geo = {
      body: new THREE.SphereGeometry(R, 16, 12),
      eyes: buildEyes(), // both eyes merged into one vertex-colored mesh = 1 draw call
      bridge: new THREE.SphereGeometry(1, 10, 8),
      ring: new THREE.TorusGeometry(0.52, 0.05, 4, 24),
      ghost: new THREE.RingGeometry(0.14, 0.26, 12),
      shock: new THREE.RingGeometry(0.8, 1, 24),
      beam: new THREE.PlaneGeometry(1, 1),
    };
    // Matcap = one texture lookup per pixel, no lights. Special blobs get their own
    // material instances so they can pulse without touching normal blobs.
    const blobMat = (hex) => new THREE.MeshMatcapMaterial({ matcap: Tex.matcap(hex) });
    this.mats = {
      color: BLOB_COLORS.map((c) => blobMat(c.hex)),
      special: BLOB_COLORS.map((c) => blobMat(c.hex)),
      garbage: blobMat(GARBAGE_COLOR.hex),
      flash: new THREE.MeshBasicMaterial({ color: 0xffffff }),
      crush: blobMat(0x4a4f5e),
      eyes: new THREE.MeshBasicMaterial({ vertexColors: true }),
    };
    this.tex = {
      mult: Tex.pixelBadge('mult'),
      time: Tex.pixelBadge('time'),
    };
  }

  materialFor(blob) {
    if (blob.kind === Kind.GARBAGE) return this.mats.garbage;
    if (blob.kind === Kind.PRISM) {
      const m = new THREE.MeshMatcapMaterial({ matcap: Tex.matcap(0xffffff) });
      m.userData.owned = true;
      return m;
    }
    if (blob.kind === Kind.BOMB || blob.kind === Kind.STAR) return this.mats.special[blob.color];
    return this.mats.color[blob.color];
  }

  initWell() {
    const { cols, visibleRows: rows, spawnX } = CONFIG;
    const cx = (cols - 1) / 2;
    const cy = (rows - 1) / 2;

    const well = new THREE.Mesh(
      new THREE.PlaneGeometry(cols, rows),
      new THREE.MeshBasicMaterial({ map: Tex.well(cols, rows), transparent: true, depthWrite: false }),
    );
    well.position.set(cx, cy, -2);
    this.root.add(well);

    const glowW = cols + 0.3;
    const glowH = rows + 0.3;
    this.frameGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(glowW + FRAME_GLOW_PAD * 2, glowH + FRAME_GLOW_PAD * 2),
      new THREE.MeshBasicMaterial({
        map: Tex.frameGlow('well', glowW, glowH),
        color: FRAME.normal.clone(),
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.frameGlow.position.set(cx, cy, -1.9);
    this.root.add(this.frameGlow);

    const cross = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.9),
      new THREE.MeshBasicMaterial({ map: Tex.cross(), transparent: true, opacity: 0.45, depthWrite: false }),
    );
    cross.position.set(spawnX, rows - 1, -1.8);
    this.root.add(cross);
    this.cross = cross;

    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 5.1),
      new THREE.MeshBasicMaterial({ map: Tex.panel('next', 2.2, 5.1), transparent: true, depthWrite: false }),
    );
    panel.position.set(NEXT_X, 8.55, -2);
    this.root.add(panel);

    const sidePanel = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 5.3),
      new THREE.MeshBasicMaterial({ map: Tex.panel('side', 2.2, 5.3), transparent: true, depthWrite: false }),
    );
    sidePanel.position.set(NEXT_X, 2.35, -2);
    this.root.add(sidePanel);
  }

  initGhost() {
    this.ghosts = [0, 1].map(() => {
      const m = new THREE.Mesh(
        this.geo.ghost,
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false }),
      );
      m.position.z = -1;
      m.visible = false;
      this.root.add(m);
      return m;
    });
  }

  initBridges() {
    this.bridges = [];
    for (let i = 0; i < 60; i++) {
      const m = new THREE.Mesh(this.geo.bridge, this.mats.color[0]);
      m.visible = false;
      this.root.add(m);
      this.bridges.push(m);
    }
  }

  setLayout(layout) {
    this.layout = layout;
    this.particles.setScale(layout.unit / layout.px);
  }

  get rect() {
    return this.layout?.board;
  }

  worldToScreen(x, y) {
    return worldToScreen(this.layout, x, y);
  }

  // ─── interface used by Game ───────────────────────────────────────────────

  reset() {
    for (const m of this.meshes.values()) m.dispose();
    for (const m of this.dying) m.dispose();
    for (const f of this.fx) this.root.remove(f.obj);
    this.meshes.clear();
    this.dying = [];
    this.fx = [];
    this.tasks = [];
    this.waiters = [];
    this.activeRef = null;
    this.particles.clear();
    this.setBlazing(false);
    this.danger = 0;
  }

  /** Resolves once nothing on the board is moving, popping or scheduled. */
  settled() {
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  onLock(blobs, hard) {
    this.lockLandPending = true;
    for (const b of blobs) {
      const m = this.meshes.get(b.id);
      if (!m) continue;
      m.vy = hard ? CONFIG.anim.hardDropSpeed : 0;
      m.lockLanding = true;
      m.dropFrom = m.pos.y;
      m.hard = hard;
    }
  }

  discard(blobs) {
    for (const b of blobs) {
      const m = this.meshes.get(b.id);
      if (!m) continue;
      this.meshes.delete(b.id);
      m.mode = 'dying';
      m.death = { kind: 'discard', t: 0 };
      this.dying.push(m);
    }
  }

  playStep(step) {
    const A = CONFIG.anim;
    const blastTime = (i) => A.flash + i * A.blastStagger;
    for (const d of step.destroyed) {
      const m = this.meshes.get(d.p.id);
      if (!m) continue;
      this.meshes.delete(d.p.id);
      m.mode = 'dying';
      if (step.type === 'crush') {
        m.death = {
          kind: 'crush',
          t: -Math.random() * 0.08,
          vx: (Math.random() - 0.5) * 6,
          vy: 3 + Math.random() * 4,
          spin: (Math.random() - 0.5) * 12,
        };
      } else if (d.blast >= 0 || d.cause === 'prism') {
        const delay = d.cause === 'prism' ? 0.12 + Math.random() * 0.12 : blastTime(d.blast) + 0.02;
        m.death = { kind: 'pop', t: -delay, flash: 0.04 };
      } else {
        m.death = { kind: 'pop', t: 0, flash: A.flash };
      }
      this.dying.push(m);
    }
    step.blasts.forEach((b, i) => this.schedule(blastTime(i), () => this.blastFx(b)));
    if (step.prism) this.prismFx(step);
    if (step.type === 'crush') {
      this.danger = 1;
      this.shake(0.5);
    } else {
      this.shake(Math.min(0.45, 0.04 + step.destroyed.length * 0.012));
    }
  }

  // ─── fx ───────────────────────────────────────────────────────────────────

  schedule(delay, fn) {
    this.tasks.push({ t: delay, fn });
  }

  shake(amount) {
    this.shakeAmp = Math.max(this.shakeAmp, amount);
  }

  addFx(obj, duration, update) {
    this.root.add(obj);
    this.fx.push({ obj, t: 0, duration, update });
  }

  blastFx(b) {
    const col = new THREE.Color(b.color >= 0 ? BLOB_COLORS[b.color].hex : 0xffffff);
    this.bus.emit('blast', b);
    if (b.kind === Kind.BOMB) {
      const ringCol = col.clone().lerp(new THREE.Color(0xffb040), 0.5);
      const ring = new THREE.Mesh(
        this.geo.shock,
        new THREE.MeshBasicMaterial({ color: ringCol, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      ring.position.set(b.x, b.y, 1);
      const reach = CONFIG.specials.bombRadius + 0.6;
      this.addFx(ring, 0.35, (o, k) => {
        o.scale.setScalar(0.3 + reach * Math.sqrt(k));
        o.material.opacity = 1 - k;
      });
      this.flashSprite(b.x, b.y, ringCol, 4.5, 0.3);
      this.particles.emit(b.x, b.y, 1, { count: 36, color: 0xffc060, speed: [3, 10], size: [0.18, 0.4], life: [0.3, 0.6] });
      this.particles.emit(b.x, b.y, 1, { count: 20, color: col, speed: [2, 7], size: [0.2, 0.45], life: [0.4, 0.8] });
      this.shake(0.4);
    } else if (b.kind === Kind.STAR) {
      const beamCol = col.clone().lerp(new THREE.Color(0xffffff), 0.5);
      const { cols, totalRows } = CONFIG;
      for (const horizontal of [true, false]) {
        const beam = new THREE.Mesh(
          this.geo.beam,
          new THREE.MeshBasicMaterial({ color: beamCol, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
        );
        if (horizontal) beam.position.set((cols - 1) / 2, b.y, 1);
        else beam.position.set(b.x, (totalRows - 1) / 2, 1);
        this.addFx(beam, 0.32, (o, k) => {
          const thick = 0.9 * (1 - k) ** 1.5 + 0.02;
          if (horizontal) o.scale.set(cols + 0.6, thick, 1);
          else o.scale.set(thick, totalRows + 0.6, 1);
          o.material.opacity = 1 - k * k;
        });
      }
      for (let x = 0; x < cols; x++) this.particles.emit(x, b.y, 1, { count: 4, color: beamCol, speed: [1, 4], size: [0.15, 0.3] });
      for (let y = 0; y < totalRows; y++) this.particles.emit(b.x, y, 1, { count: 3, color: beamCol, speed: [1, 4], size: [0.15, 0.3] });
      this.flashSprite(b.x, b.y, beamCol, 3, 0.25);
      this.shake(0.3);
    }
  }

  prismFx(step) {
    const { x, y, color } = step.prism;
    const col = new THREE.Color(color >= 0 ? BLOB_COLORS[color].hex : 0xffffff);
    this.flashSprite(x, y, 0xffffff, 6, 0.4);
    for (const d of step.destroyed) {
      if (d.x === x && d.y === y) continue;
      const pts = [];
      const n = 7;
      for (let i = 0; i <= n; i++) {
        const k = i / n;
        const j = i === 0 || i === n ? 0 : 0.25;
        pts.push(
          new THREE.Vector3(
            x + (d.x - x) * k + (Math.random() - 0.5) * j,
            y + (d.y - y) * k + (Math.random() - 0.5) * j,
            1.2,
          ),
        );
      }
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: col.clone().lerp(new THREE.Color(0xffffff), 0.4), transparent: true, blending: THREE.AdditiveBlending }),
      );
      this.addFx(line, 0.35, (o, k) => {
        o.material.opacity = 1 - k;
      });
    }
    this.particles.emit(x, y, 1, { count: 50, color: 0xffffff, speed: [3, 11], size: [0.15, 0.4], life: [0.4, 0.8] });
    this.shake(0.45);
  }

  flashSprite(x, y, color, size, duration) {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: Tex.glow(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    s.position.set(x, y, 1.5);
    this.addFx(s, duration, (o, k) => {
      o.scale.setScalar(size * (0.6 + 0.6 * k));
      o.material.opacity = 1 - k;
    });
  }

  streak(x, fromY, toY, color) {
    const len = fromY - toY;
    if (len < 1.5) return;
    const m = new THREE.Mesh(
      this.geo.beam,
      new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    m.position.set(x, toY + len / 2, -0.5);
    this.addFx(m, 0.18, (o, k) => {
      o.scale.set(0.7 * (1 - k), len, 1);
      o.material.opacity = 0.45 * (1 - k);
    });
  }

  setBlazing(on) {
    this.blazing = on;
    this.mats.color.forEach((m) => m.color.setScalar(on ? 1.3 : 1));
  }

  // ─── per-frame ────────────────────────────────────────────────────────────

  ensure(blob, x, y, scale = 1) {
    let m = this.meshes.get(blob.id);
    if (!m) {
      m = new BlobMesh(this, blob, x, y, scale);
      this.meshes.set(blob.id, m);
    }
    return m;
  }

  update(dt, game) {
    this.time += dt;
    const t = this.time;
    const seen = this.seen;
    seen.clear();
    const pulse = 1 + 0.35 * (0.5 + 0.5 * Math.sin(t * 7));
    this.mats.special.forEach((m) => m.color.setScalar(pulse));

    // NEXT queue
    game.queue.slice(0, QUEUE_SLOTS.length).forEach((piece, i) => {
      const slot = QUEUE_SLOTS[i];
      piece.blobs.forEach((blob, j) => {
        const ty = slot.y + (piece.single ? 0.5 * slot.s : j * slot.s);
        const m = this.ensure(blob, slot.x, ty, 0);
        seen.add(blob.id);
        m.mode = 'queue';
        m.target.set(slot.x, ty);
        m.targetScale = slot.s;
        m.pos.lerp(m.target, damp(14, dt));
      });
    });

    // Active piece: axis eases to its cell, child swings around it on an arc
    const p = game.active;
    if (p) {
      if (this.activeRef !== p) {
        this.activeRef = p;
        this.visAngle = p.angle;
      }
      this.visAngle += (p.angle - this.visAngle) * damp(24, dt);
      const axis = this.ensure(p.axis, p.x, p.y);
      seen.add(p.axis.id);
      axis.mode = 'active';
      axis.targetScale = 1;
      axis.pos.x += (p.x - axis.pos.x) * damp(32, dt);
      axis.pos.y += (p.y - axis.pos.y) * damp(22, dt);
      if (p.child) {
        const child = this.ensure(p.child, p.x, p.y + 1);
        seen.add(p.child.id);
        child.mode = 'active';
        child.targetScale = 1;
        const a = this.visAngle * (Math.PI / 2);
        child.pos.set(axis.pos.x + Math.sin(a), axis.pos.y + Math.cos(a));
      }
    }

    // Board: gravity-driven settling towards logical cells
    const A = CONFIG.anim;
    game.board.forEach((blob, x, y) => {
      const m = this.ensure(blob, x, y, 0);
      seen.add(blob.id);
      if (m.mode !== 'board') {
        if (m.mode === 'new' && blob.kind !== Kind.NORMAL) this.spawnSpecialFx(x, y, blob);
        m.mode = 'board';
      }
      m.targetScale = 1;
      m.target.set(x, y);
      m.pos.x += (x - m.pos.x) * damp(26, dt);
      if (m.pos.y > y + 1e-3) {
        m.vy += A.gravity * dt;
        m.pos.y -= m.vy * dt;
        m.rest = false;
        if (m.pos.y <= y) {
          m.pos.y = y;
          this.onLand(m);
        }
      } else if (m.pos.y < y - 1e-3) {
        m.pos.y += (y - m.pos.y) * damp(22, dt);
        if (Math.abs(y - m.pos.y) < 0.01) m.pos.y = y;
        m.rest = false;
      } else {
        m.pos.y = y;
        m.vy = 0;
        m.rest = Math.abs(x - m.pos.x) < 0.02;
      }
    });

    for (const [id, m] of this.meshes) {
      if (!seen.has(id)) {
        m.dispose();
        this.meshes.delete(id);
        continue;
      }
      m.scale += (m.targetScale - m.scale) * damp(m.mode === 'board' ? 16 : 12, dt);
      m.update(dt, t);
    }

    this.updateDying(dt, t);
    this.updateBridges(game.board);
    this.updateGhost(game);
    this.updateTasks(dt);
    this.updateFx(dt);
    this.updateFrame(dt, t);
    this.particles.update(dt);

    this.shakeAmp *= Math.exp(-dt * 9);
    this.root.position.set((Math.random() - 0.5) * this.shakeAmp, (Math.random() - 0.5) * this.shakeAmp, 0);

    if (this.waiters.length && this.isSettled()) {
      const w = this.waiters;
      this.waiters = [];
      w.forEach((r) => r());
    }
  }

  isSettled() {
    if (this.dying.length || this.tasks.length) return false;
    for (const m of this.meshes.values()) if (m.mode === 'board' && !m.rest) return false;
    return true;
  }

  onLand(m) {
    const impact = m.vy;
    m.vy = 0;
    m.land(impact);
    if (m.lockLanding) {
      m.lockLanding = false;
      if (m.hard) this.streak(m.pos.x, m.dropFrom, m.pos.y, colorHex(m.blob.color));
      if (this.lockLandPending) {
        this.lockLandPending = false;
        this.bus.emit('land', { hard: m.hard });
      }
      if (m.hard) {
        this.particles.emit(m.pos.x, m.pos.y - 0.4, 0.6, {
          count: 6,
          color: 0xbfd0ff,
          speed: [1, 3],
          size: [0.1, 0.2],
          life: [0.2, 0.4],
          angle: Math.PI / 2,
          spread: 2.4,
          gravity: -4,
        });
      }
    }
  }

  spawnSpecialFx(x, y, blob) {
    const col = blob.color >= 0 ? BLOB_COLORS[blob.color].hex : 0xffffff;
    this.flashSprite(x, y, col, 3, 0.35);
    this.particles.emit(x, y, 1, { count: 18, color: 0xffffff, speed: [2, 5], size: [0.12, 0.25], life: [0.3, 0.6], gravity: 0 });
  }

  updateDying(dt, t) {
    const A = CONFIG.anim;
    this.dying = this.dying.filter((m) => {
      const d = m.death;
      d.t += dt;
      if (d.t < 0) {
        m.update(dt, t);
        return true;
      }
      if (d.kind === 'pop') {
        if (d.t < d.flash) {
          const k = d.t / d.flash;
          if (m.body.material !== this.mats.flash && k > 0.35) m.body.material = this.mats.flash;
          m.scale = 1 + 0.22 * Math.sin(k * Math.PI * 0.5);
        } else {
          if (!d.burst) {
            d.burst = true;
            const col = colorHex(m.blob.color);
            this.particles.emit(m.pos.x, m.pos.y, 0.8, { count: 12, color: col, speed: [2.5, 7], size: [0.2, 0.42] });
            this.particles.emit(m.pos.x, m.pos.y, 0.8, { count: 4, color: 0xffffff, speed: [1, 4], size: [0.12, 0.25], life: [0.2, 0.4] });
          }
          const k = (d.t - d.flash) / A.burst;
          m.scale = 1.22 * (1 - k) ** 2;
          if (k >= 1) {
            m.dispose();
            return false;
          }
        }
      } else if (d.kind === 'crush') {
        if (m.body.material !== this.mats.crush) {
          m.body.material = this.mats.crush;
          if (m.eyes) m.eyes.visible = false;
        }
        d.vy -= 26 * dt;
        m.pos.x += d.vx * dt;
        m.pos.y += d.vy * dt;
        m.group.rotation.z += d.spin * dt;
        m.scale = Math.max(0, 1 - d.t * 1.3);
        if (d.t > 0.75) {
          m.dispose();
          return false;
        }
      } else if (d.kind === 'discard') {
        m.scale = Math.max(0, 1 - d.t / 0.2);
        if (d.t > 0.2) {
          m.dispose();
          return false;
        }
      }
      m.update(dt, t);
      return true;
    });
  }

  updateBridges(board) {
    let i = 0;
    const link = (m, n, color, horizontal) => {
      if (i >= this.bridges.length) return;
      const b = this.bridges[i++];
      b.visible = true;
      b.material = this.mats.color[color];
      b.position.set((m.pos.x + n.pos.x) / 2, (m.pos.y + n.pos.y) / 2, -0.06);
      if (horizontal) b.scale.set(0.5, 0.3, 0.3);
      else b.scale.set(0.3, 0.5, 0.3);
    };
    const settled = (blob) => {
      const m = this.meshes.get(blob.id);
      return m && m.mode === 'board' && m.rest && m.scale > 0.95 ? m : null;
    };
    board.forEach((blob, x, y) => {
      if (blob.color < 0 || y >= board.visible) return;
      const m = settled(blob);
      if (!m) return;
      const right = board.get(x + 1, y);
      if (right && right.color === blob.color) {
        const n = settled(right);
        if (n) link(m, n, blob.color, true);
      }
      const up = board.get(x, y + 1);
      if (up && up.color === blob.color && y + 1 < board.visible) {
        const n = settled(up);
        if (n) link(m, n, blob.color, false);
      }
    });
    for (; i < this.bridges.length; i++) this.bridges[i].visible = false;
  }

  updateGhost(game) {
    const p = game.active;
    if (!p || game.phase !== 'control') {
      this.ghosts.forEach((g) => (g.visible = false));
      return;
    }
    const landing = p.landing(game.board);
    this.ghosts.forEach((g, i) => {
      const l = landing[i];
      if (!l || l[1] >= game.board.rows) {
        g.visible = false;
        return;
      }
      g.visible = true;
      g.position.set(l[0], l[1], -1);
      g.material.color.setHex(l[2].color >= 0 ? BLOB_COLORS[l[2].color].hex : 0xffffff);
      g.material.opacity = 0.45 + 0.2 * Math.sin(this.time * 8);
    });
  }

  updateTasks(dt) {
    if (!this.tasks.length) return;
    const due = [];
    this.tasks = this.tasks.filter((task) => {
      task.t -= dt;
      if (task.t <= 0) {
        due.push(task.fn);
        return false;
      }
      return true;
    });
    due.forEach((fn) => fn());
  }

  updateFx(dt) {
    this.fx = this.fx.filter((f) => {
      f.t += dt;
      const k = Math.min(1, f.t / f.duration);
      f.update(f.obj, k);
      if (k >= 1) {
        this.root.remove(f.obj);
        if (f.obj.geometry && ![this.geo.shock, this.geo.beam].includes(f.obj.geometry)) f.obj.geometry.dispose();
        f.obj.material?.dispose?.();
        return false;
      }
      return true;
    });
  }

  updateFrame(dt, t) {
    this.danger = Math.max(0, this.danger - dt * 1.4);
    const mat = this.frameGlow.material;
    const base = this.blazing ? FRAME.blazing : FRAME.normal;
    mat.color.copy(base).lerp(FRAME.danger, Math.min(1, this.danger));
    const pulse = this.blazing ? 0.75 + 0.25 * Math.sin(t * 12) : 0.5 + 0.08 * Math.sin(t * 2);
    mat.opacity = Math.max(pulse, this.danger);
    this.cross.material.opacity = 0.35 + 0.15 * Math.sin(t * 3);

    if (this.blazing && Math.random() < dt * 40) {
      this.particles.emit(Math.random() * CONFIG.cols - 0.5, -0.4, -0.5, {
        count: 1,
        color: Math.random() < 0.5 ? 0xff7a1a : 0xffc040,
        speed: [2, 5],
        size: [0.2, 0.45],
        life: [0.6, 1.2],
        gravity: 3,
        angle: Math.PI / 2,
        spread: 0.5,
      });
    }
  }
}
