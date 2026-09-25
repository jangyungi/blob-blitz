import * as THREE from 'three';
import { BLOB_COLORS } from '../config.js';
import { Tex } from '../render/textures.js';
import { Particles } from '../render/Particles.js';

/**
 * Full-screen 3D layer behind the puzzle board.
 *
 * This is the hook for the future battle presentation. The puzzle never talks to it
 * directly: main.js forwards bus events into these methods. Replace the primitive
 * hero/enemy with GLTF characters and keep this public surface:
 *
 *   setFocus(layout)          – where on screen the action should be framed
 *   update(dt)
 *   attack({ chain, count, colors, points, blazing, hurrah })
 *   onBlazing(active) / onOverflow() / onTimeUp() / reset()
 *   playEnding('escape' | 'death') -> Promise   (resolved when the outro is over)
 *   onDamage = (screenX, screenY, amount, big) => {}
 *   onCue    = (name, screenX, screenY) => {}     ('ko' | 'smoke' | 'escaped' | 'confused')
 *
 * Kept deliberately cheap: Lambert/flat materials, low-poly meshes, no shadow maps.
 */

const HERO_HOME = new THREE.Vector3(-2.6, 0, 0.4);
const HERO_YAW = 0.5;
const ENEMY_HOME = new THREE.Vector3(2.7, 0, -0.4);
const ENEMY_YAW = -0.4;

const lerp = (a, b, k) => a + (b - a) * k;
const clamp01 = (k) => Math.min(1, Math.max(0, k));
const easeIn = (k) => k * k;
const easeOut = (k) => 1 - (1 - k) * (1 - k);
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _p = new THREE.Vector3();

function flat(color, extra = {}) {
  return new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
}

export class BattleStage {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x140c2a, 14, 42);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 260);
    this.camBase = new THREE.Vector3(0, 3.1, 10.5);
    this.lookAt = new THREE.Vector3(0, 1.3, 0);
    this.time = 0;
    this.shakeAmp = 0;
    this.projectiles = [];
    this.blazing = false;
    this.menace = 0;
    this.menaceTarget = 0;
    this.ending = null;
    this.onDamage = null;
    this.onCue = null;

    this.buildWorld();
    this.hero = this.buildHero();
    this.enemy = this.buildEnemy();
    this.scene.add(this.hero.root, this.enemy.root);

    this.particles = new Particles(700, { perspective: true });
    this.scene.add(this.particles.points);
    this.reset();
  }

  // ─── world ────────────────────────────────────────────────────────────────

  buildWorld() {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(200, 16, 10),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uTop: { value: new THREE.Color(0x0b0d2e) },
          uMid: { value: new THREE.Color(0x3a1d5c) },
          uBottom: { value: new THREE.Color(0xff6a7a) },
        },
        vertexShader: /* glsl */ `
          varying vec3 vPos;
          void main() {
            vPos = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        // banded gradient + 4x4 ordered dither = 16-bit era sky
        fragmentShader: /* glsl */ `
          uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uBottom;
          varying vec3 vPos;
          const float BAYER[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
          void main() {
            float h = vPos.y;
            vec3 c = mix(uMid, uTop, smoothstep(0.05, 0.6, h));
            c = mix(uBottom, c, smoothstep(-0.12, 0.14, h));
            int i = int(mod(gl_FragCoord.x, 4.0)) + int(mod(gl_FragCoord.y, 4.0)) * 4;
            float d = (BAYER[i] + 0.5) / 16.0;
            c = floor(c * 7.0 + d) / 7.0;
            gl_FragColor = vec4(c, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    );
    this.scene.add(sky);

    const starGeo = new THREE.BufferGeometry();
    const pts = [];
    for (let i = 0; i < 260; i++) {
      const v = new THREE.Vector3().randomDirection();
      if (v.y < 0.08) v.y = Math.abs(v.y) + 0.08;
      pts.push(v.multiplyScalar(150));
    }
    starGeo.setFromPoints(pts);
    this.scene.add(
      new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1, sizeAttenuation: false, fog: false })),
    );

    this.scene.add(new THREE.HemisphereLight(0x9db2ff, 0x3a1830, 1.5));
    const sun = new THREE.DirectionalLight(0xffd7c2, 2.0);
    sun.position.set(-6, 10, 6);
    this.scene.add(sun);
    this.flashLight = new THREE.PointLight(0xffffff, 0, 12, 1.5);
    this.flashLight.position.set(2.7, 1.8, 0.5);
    this.scene.add(this.flashLight);

    const ground = new THREE.Mesh(new THREE.CircleGeometry(120, 24), flat(0x1a1433));
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    const arena = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.5, 0.3, 24), flat(0x2a2150));
    arena.position.y = 0.15;
    this.scene.add(arena);

    this.runeRing = new THREE.Mesh(new THREE.TorusGeometry(4.6, 0.06, 4, 48), new THREE.MeshBasicMaterial({ color: 0x6f7dff }));
    this.runeRing.rotation.x = -Math.PI / 2;
    this.runeRing.position.y = 0.31;
    this.scene.add(this.runeRing);

    this.pillarCaps = [];
    const pillarMat = flat(0x2b2448);
    for (let i = 0; i < 8; i++) {
      const a = Math.PI * (1.02 + (i / 7) * 0.96); // back half-circle only
      const r = 7.5 + (i % 2) * 1.5;
      const h = 2.5 + (i % 3) * 1.2;
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, h, 6), pillarMat);
      pillar.position.set(Math.cos(a) * r * 1.3, h / 2, Math.sin(a) * r - 1);
      this.scene.add(pillar);
      const cap = new THREE.Mesh(new THREE.OctahedronGeometry(0.35), new THREE.MeshBasicMaterial({ color: BLOB_COLORS[i % 4].hex }));
      cap.position.set(pillar.position.x, h + 0.6, pillar.position.z);
      this.scene.add(cap);
      this.pillarCaps.push(cap);
    }

    this.shadowGeo = new THREE.CircleGeometry(1, 12);
    this.shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false });
  }

  blobShadow(radius) {
    const s = new THREE.Mesh(this.shadowGeo, this.shadowMat);
    s.rotation.x = -Math.PI / 2;
    s.position.y = 0.32;
    s.scale.setScalar(radius);
    return s;
  }

  glowSprite(color, size) {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: Tex.glow(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    s.scale.setScalar(size);
    return s;
  }

  buildHero() {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body, this.blobShadow(0.75));
    const robe = new THREE.Mesh(new THREE.ConeGeometry(0.62, 1.4, 8), flat(0x3b4bd8));
    robe.position.y = 0.7;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.36, 8, 6), flat(0xffe0c8));
    head.position.y = 1.62;
    const hatMat = flat(0x28208a);
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.46, 0.9, 8), hatMat);
    hat.position.y = 2.18;
    hat.rotation.z = -0.2;
    const brim = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.06, 4, 10), hatMat);
    brim.rotation.x = Math.PI / 2;
    brim.position.y = 1.82;
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 2.1, 4), flat(0x7a4a2a));
    staff.position.set(0.62, 1.05, 0.1);
    staff.rotation.z = -0.12;
    const orb = new THREE.Mesh(new THREE.OctahedronGeometry(0.17), new THREE.MeshBasicMaterial({ color: 0x9fe8ff }));
    orb.position.set(0.74, 2.14, 0.1);
    const orbGlow = this.glowSprite(0x7fd8ff, 1.2);
    orb.add(orbGlow);
    body.add(robe, head, hat, brim, staff, orb);
    return { root, body, orb, orbGlow, cast: 0 };
  }

  buildEnemy() {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body, this.blobShadow(1.2));
    this.enemyMat = flat(0x5a4a7a, { emissive: 0xff2a4a, emissiveIntensity: 0 });
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.95, 0), this.enemyMat);
    core.position.y = 1.5;
    const head = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5, 0), this.enemyMat);
    head.position.y = 2.75;
    const eye = new THREE.Mesh(new THREE.OctahedronGeometry(0.12), new THREE.MeshBasicMaterial({ color: 0xff3355 }));
    eye.position.set(-0.1, 2.8, 0.42);
    const eyeGlow = this.glowSprite(0xff3355, 0.9);
    eye.add(eyeGlow);
    const shards = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), this.enemyMat);
      const a = (i / 5) * Math.PI * 2;
      s.position.set(Math.cos(a) * 1.5, 1.5 + Math.sin(a * 2) * 0.3, Math.sin(a) * 1.5);
      s.scale.y = 1.8;
      shards.add(s);
    }
    body.add(core, head, eye, shards);
    return { root, body, shards, eyeGlow, knock: 0, knockV: 0, hit: 0, center: new THREE.Vector3(0, 1.6, 0) };
  }

  // ─── layout ───────────────────────────────────────────────────────────────

  /**
   * Frames the stage so its center lands on layout.focus (via an asymmetric view offset)
   * and pulls the camera back far enough that both fighters fit in the free area.
   */
  setFocus(layout) {
    const { width: w, height: h, focus, board, px } = layout;
    const vw = focus.x >= w / 2 ? 2 * focus.x : 2 * (w - focus.x);
    const vh = focus.y >= h / 2 ? 2 * focus.y : 2 * (h - focus.y);
    const ox = focus.x >= w / 2 ? 0 : vw - w;
    const oy = focus.y >= h / 2 ? 0 : vh - h;
    this.camera.aspect = vw / vh;
    this.camera.setViewOffset(vw, vh, ox, oy, w, h);
    this.camera.updateProjectionMatrix();

    const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const freeW = layout.landscape ? w - (board.x + board.w) : w;
    const freeH = layout.landscape ? h : board.y;
    const fitW = (9.5 * vh) / (2 * tanHalf * Math.max(160, freeW));
    const fitH = (5.5 * vh) / (2 * tanHalf * Math.max(120, freeH));
    const d = THREE.MathUtils.clamp(Math.max(fitW, fitH, 9.5), 9.5, 60);
    this.camBase.set(0, 2.2 + d * 0.09, d);
    this.scene.fog.near = d + 2;
    this.scene.fog.far = d + 34;
    this.particles.setScale(vh / px / (2 * tanHalf));
  }

  screenOf(v) {
    _p.copy(v).project(this.camera);
    return { x: (_p.x * 0.5 + 0.5) * this.renderer.width, y: (-_p.y * 0.5 + 0.5) * this.renderer.height };
  }

  cue(name, worldPos) {
    if (!this.onCue) return;
    const s = worldPos ? this.screenOf(worldPos) : { x: 0, y: 0 };
    this.onCue(name, s.x, s.y);
  }

  // ─── events from the puzzle ───────────────────────────────────────────────

  attack({ chain = 1, count = 4, colors = [], points = 0, blazing = false, hurrah = false }) {
    if (this.ending || !this.hero.root.visible) return;
    const shots = Math.min(6, 1 + Math.floor(count / 5) + Math.max(0, chain - 1));
    const big = chain >= 4 || count >= 10 || hurrah;
    this.hero.cast = 1;
    for (let i = 0; i < shots; i++) {
      const c = blazing ? 0xff8a2a : colors.length ? BLOB_COLORS[colors[i % colors.length]].hex : 0xffffff;
      this.launch(c, i * 0.07, big && i === 0 ? 2.2 : 1 + chain * 0.12, i === 0 ? points : 0, big);
    }
  }

  launch(color, delay, size, damage, big) {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: Tex.glow(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    sprite.scale.setScalar(0);
    this.scene.add(sprite);
    const from = new THREE.Vector3();
    this.hero.orb.getWorldPosition(from);
    const to = this.enemy.root.position.clone().add(this.enemy.center);
    to.x += (Math.random() - 0.5) * 0.6;
    to.y += (Math.random() - 0.5) * 0.6;
    const ctrl = from.clone().lerp(to, 0.5);
    ctrl.y += 1.5 + Math.random() * 1.5;
    ctrl.z += (Math.random() - 0.5) * 3;
    this.projectiles.push({ sprite, from, to, ctrl, t: -delay, dur: 0.42, size, color, damage, big });
  }

  onBlazing(active) {
    this.blazing = active;
  }

  onOverflow() {
    this.shakeAmp = Math.max(this.shakeAmp, 0.25);
    this.hero.body.rotation.z = 0.3;
  }

  /** Time's up: the enemy starts closing in while LAST HURRAH (if any) plays out. */
  onTimeUp() {
    this.menaceTarget = 1;
  }

  playEnding(kind) {
    return new Promise((resolve) => {
      this.ending = { kind, t: 0, resolve, fired: new Set(), soul: null, dustT: 0 };
    });
  }

  reset() {
    this.projectiles.forEach((p) => {
      this.scene.remove(p.sprite);
      p.sprite.material.dispose();
    });
    this.projectiles = [];
    if (this.ending?.soul) {
      this.scene.remove(this.ending.soul);
      this.ending.soul.material.dispose();
    }
    this.ending = null;
    this.blazing = false;
    this.menace = 0;
    this.menaceTarget = 0;

    const h = this.hero;
    h.root.visible = true;
    h.root.position.copy(HERO_HOME);
    h.root.rotation.set(0, HERO_YAW, 0);
    h.body.position.set(0, 0.3, 0);
    h.body.rotation.set(0, 0, 0);
    h.orbGlow.material.opacity = 1;

    const e = this.enemy;
    e.root.position.copy(ENEMY_HOME);
    e.root.rotation.set(0, ENEMY_YAW, 0);
    e.body.rotation.set(0, 0, 0);
    e.body.scale.setScalar(1);
    e.knock = 0;
    e.knockV = 0;
  }

  impact(p) {
    const e = this.enemy;
    e.knockV += p.big ? 5 : 2.2;
    e.hit = 1;
    this.flashLight.color.set(p.color);
    this.flashLight.position.copy(p.to);
    this.flashLight.intensity = p.big ? 60 : 25;
    this.shakeAmp = Math.max(this.shakeAmp, p.big ? 0.22 : 0.06);
    this.particles.emit(p.to.x, p.to.y, p.to.z, {
      count: p.big ? 40 : 14,
      color: p.color,
      speed: [2, p.big ? 9 : 5],
      size: [0.12, 0.24],
      life: [0.3, 0.7],
      gravity: -6,
      vz: 4,
    });
    if (p.damage && this.onDamage) {
      const s = this.screenOf(_a.copy(p.to).setY(p.to.y + 1.2));
      this.onDamage(s.x, s.y, p.damage, p.big);
    }
  }

  // ─── per frame ────────────────────────────────────────────────────────────

  update(dt) {
    this.time += dt;
    const t = this.time;

    this.shakeAmp *= Math.exp(-dt * 7);
    const cam = this.camera;
    cam.position.set(
      this.camBase.x + Math.sin(t * 0.23) * 0.6 + (Math.random() - 0.5) * this.shakeAmp,
      this.camBase.y + Math.sin(t * 0.31) * 0.2 + (Math.random() - 0.5) * this.shakeAmp,
      this.camBase.z,
    );
    cam.lookAt(this.lookAt);

    this.menace += (this.menaceTarget - this.menace) * damp(1.5, dt);
    if (this.ending) this.updateEnding(dt);
    else this.updateIdle(dt, t);

    const e = this.enemy;
    e.hit = Math.max(0, e.hit - dt * 5);
    e.shards.rotation.y += dt * (0.8 + e.hit * 6 + this.menace * 3);
    this.enemyMat.emissiveIntensity = e.hit * 2.2 + this.menace * 0.25;
    e.eyeGlow.scale.setScalar(0.9 + this.menace * 0.9 + Math.sin(t * 9) * 0.1 * this.menace);
    this.flashLight.intensity *= Math.exp(-dt * 10);

    this.runeRing.material.color.set(this.menace > 0.5 ? 0xff2a4a : this.blazing ? 0xff7a1a : 0x6f7dff);
    this.pillarCaps.forEach((c, i) => (c.rotation.y += dt * (1 + i * 0.1)));

    this.updateProjectiles(dt);

    if (this.blazing && Math.random() < dt * 20) {
      const a = Math.random() * Math.PI * 2;
      this.particles.emit(Math.cos(a) * 4.6, 0.4, Math.sin(a) * 4.6, {
        count: 1,
        color: Math.random() < 0.5 ? 0xff7a1a : 0xffc040,
        speed: [1, 3],
        size: [0.18, 0.36],
        life: [0.6, 1.1],
        gravity: 3,
        angle: Math.PI / 2,
        spread: 0.4,
      });
    }

    this.particles.update(dt);
  }

  updateIdle(dt, t) {
    const h = this.hero;
    h.cast = Math.max(0, h.cast - dt * 4);
    h.body.position.set(
      (Math.random() - 0.5) * 0.05 * this.menace, // trembling once time is up
      0.3 + Math.abs(Math.sin(t * 2.2)) * 0.06 + h.cast * 0.25,
      0,
    );
    h.body.rotation.z *= Math.exp(-dt * 5);
    h.orbGlow.scale.setScalar(1.1 + h.cast * 1.6 + Math.sin(t * 6) * 0.1);
    h.orbGlow.material.color.set(this.blazing ? 0xff8a2a : 0x7fd8ff);

    const e = this.enemy;
    e.knockV += (-e.knock * 60 - e.knockV * 9) * dt;
    e.knock += e.knockV * dt;
    e.root.position.x = ENEMY_HOME.x - 0.8 * this.menace;
    e.body.position.set(e.knock * 0.35, 0.35 + Math.sin(t * 1.7) * 0.12, 0);
    e.body.rotation.z = -e.knock * 0.12;
  }

  updateProjectiles(dt) {
    this.projectiles = this.projectiles.filter((p) => {
      p.t += dt;
      if (p.t < 0) return true;
      const k = Math.min(1, p.t / p.dur);
      const e1 = k * k * (3 - 2 * k);
      _a.copy(p.from).lerp(p.ctrl, e1);
      _b.copy(p.ctrl).lerp(p.to, e1);
      _a.lerp(_b, e1);
      p.sprite.position.copy(_a);
      p.sprite.scale.setScalar(p.size * (0.4 + 0.6 * Math.min(1, k * 3)));
      if (Math.random() < 0.6) {
        this.particles.emit(_a.x, _a.y, _a.z, { count: 1, color: p.color, speed: [0.2, 0.8], size: [0.12, 0.22], life: [0.15, 0.3], gravity: 0, vz: 0.5 });
      }
      if (k >= 1) {
        this.scene.remove(p.sprite);
        p.sprite.material.dispose();
        this.impact(p);
        return false;
      }
      return true;
    });
  }

  // ─── endings ──────────────────────────────────────────────────────────────

  once(name, fn) {
    if (this.ending.fired.has(name)) return;
    this.ending.fired.add(name);
    fn();
  }

  updateEnding(dt) {
    const E = this.ending;
    E.t += dt;
    if (E.kind === 'death') this.updateDeath(E, dt);
    else this.updateEscape(E, dt);
  }

  dust(x, z, n = 3, color = 0x8a7fa8) {
    this.particles.emit(x, 0.4, z, { count: n, color, speed: [0.5, 2], size: [0.2, 0.4], life: [0.3, 0.6], gravity: 1, angle: Math.PI / 2, spread: 2.5, vz: 1 });
  }

  /** Enemy charges, slams the hero; hero is knocked flat and their soul floats away. */
  updateDeath(E, dt) {
    const t = E.t;
    const h = this.hero;
    const e = this.enemy;
    const startX = ENEMY_HOME.x - 0.8;
    const strikeX = HERO_HOME.x + 1.8;

    // enemy: charge → wind-up → slam → walk back and roar
    let ex = startX;
    let lean = 0;
    let lift = 0;
    if (t < 0.45) {
      const k = easeIn(t / 0.45);
      ex = lerp(startX, strikeX, k);
      lean = 0.35 * k;
      E.dustT -= dt;
      if (E.dustT < 0) {
        E.dustT = 0.06;
        this.dust(ex + 0.6, ENEMY_HOME.z);
      }
    } else if (t < 0.65) {
      const k = easeOut((t - 0.45) / 0.2);
      ex = strikeX;
      lean = lerp(0.35, -0.45, k);
      lift = 0.5 * k;
    } else if (t < 0.76) {
      const k = (t - 0.65) / 0.11;
      ex = strikeX;
      lean = lerp(-0.45, 0.75, k);
      lift = lerp(0.5, 0, k);
    } else if (t < 1.5) {
      ex = strikeX;
      lean = lerp(0.75, 0, clamp01((t - 0.76) / 0.4));
    } else {
      const k = easeOut(clamp01((t - 1.5) / 0.9));
      ex = lerp(strikeX, startX, k);
      const roar = clamp01((t - 2.1) / 0.5);
      e.body.scale.setScalar(1 + 0.14 * Math.sin(roar * Math.PI));
    }
    e.root.position.x = ex;
    e.body.position.set(0, 0.35 + lift, 0);
    e.body.rotation.z = lean;

    if (t >= 0.74) {
      this.once('ko', () => {
        _a.copy(h.root.position).setY(1.4);
        this.shakeAmp = 0.7;
        this.flashLight.color.set(0xff3355);
        this.flashLight.position.copy(_a);
        this.flashLight.intensity = 90;
        this.particles.emit(_a.x, _a.y, _a.z, { count: 60, color: 0xffffff, speed: [3, 10], size: [0.14, 0.3], life: [0.3, 0.7], vz: 4 });
        this.particles.emit(_a.x, _a.y, _a.z, { count: 30, color: 0xff3355, speed: [2, 7], size: [0.18, 0.34], life: [0.4, 0.8], vz: 4 });
        this.cue('ko', _a);
      });
      // hero knocked back and flat
      const k = clamp01((t - 0.74) / 0.55);
      h.root.position.x = lerp(HERO_HOME.x, HERO_HOME.x - 1.9, easeOut(k));
      h.root.position.y = Math.sin(k * Math.PI) * 1.1;
      h.body.rotation.z = lerp(0, Math.PI / 2, easeOut(k));
      h.body.position.set(0, lerp(0.3, 0.05, k), 0);
      h.orbGlow.material.opacity = 1 - k;
      if (k >= 1) this.once('thud', () => this.dust(h.root.position.x, HERO_HOME.z, 16));
    }

    if (t >= 1.5) {
      if (!E.soul) {
        E.soul = this.glowSprite(0xcfe8ff, 1.1);
        E.soul.position.set(h.root.position.x, 0.6, HERO_HOME.z);
        this.scene.add(E.soul);
      }
      const k = clamp01((t - 1.5) / 1.3);
      E.soul.position.y = 0.6 + k * 3;
      E.soul.position.x = h.root.position.x + Math.sin(k * 10) * 0.25;
      E.soul.material.opacity = 1 - k;
    }

    if (t >= 3.0) this.finishEnding();
  }

  /** Hero pops a smoke bomb, turns tail and runs off; the enemy lumbers over, confused. */
  updateEscape(E, dt) {
    const t = E.t;
    const h = this.hero;
    const e = this.enemy;
    const startX = ENEMY_HOME.x - 0.8 * this.menace;

    if (t < 0.3) {
      const k = t / 0.3;
      h.body.position.set(0, 0.3 + Math.sin(k * Math.PI) * 0.5, 0);
      h.orbGlow.scale.setScalar(1.2 + k * 2);
    }
    if (t >= 0.3) {
      this.once('smoke', () => {
        _a.copy(h.root.position).setY(1);
        this.particles.emit(_a.x, _a.y, _a.z, { count: 50, color: 0x9a9ab8, speed: [0.5, 2.5], size: [0.5, 0.9], life: [0.8, 1.4], gravity: 0.8, drag: 2, vz: 2, spreadPos: 1 });
        this.particles.emit(_a.x, _a.y, _a.z, { count: 20, color: 0xffffff, speed: [2, 6], size: [0.15, 0.3], life: [0.2, 0.4] });
        this.cue('smoke', _a);
      });
      const turn = easeOut(clamp01((t - 0.3) / 0.25));
      h.root.rotation.y = lerp(HERO_YAW, -Math.PI / 2, turn);
      h.orbGlow.scale.setScalar(1.2);
    }
    if (t >= 0.55 && h.root.visible) {
      const k = clamp01((t - 0.55) / 1.05);
      h.root.position.x = HERO_HOME.x - easeIn(k) * 8;
      h.body.position.set(0, 0.3 + Math.abs(Math.sin(t * 20)) * 0.28, 0);
      h.body.rotation.z = -0.2;
      E.dustT -= dt;
      if (E.dustT < 0) {
        E.dustT = 0.07;
        this.dust(h.root.position.x + 0.3, HERO_HOME.z, 2);
      }
      if (k >= 1) {
        this.once('escaped', () => {
          _a.copy(h.root.position).setY(1);
          this.particles.emit(_a.x, _a.y, _a.z, { count: 30, color: 0xffffff, speed: [2, 6], size: [0.2, 0.4], life: [0.3, 0.6] });
          h.root.visible = false;
          this.cue('escaped', _a.set(HERO_HOME.x, 1.5, HERO_HOME.z));
        });
      }
    }

    // enemy lumbers to where the hero stood, then looks around
    const walk = easeOut(clamp01((t - 0.4) / 1.1));
    e.root.position.x = lerp(startX, HERO_HOME.x + 1.6, walk);
    e.body.position.set(0, 0.35 + Math.abs(Math.sin(t * 7)) * 0.12 * (walk < 1 ? 1 : 0), 0);
    e.body.rotation.z = 0.15 * (walk < 1 ? walk : 0);
    if (t > 1.5) {
      const look = clamp01((t - 1.5) / 1.1);
      e.root.rotation.y = ENEMY_YAW + Math.sin(look * Math.PI * 3) * 0.7 * (1 - look * 0.5);
      if (t > 1.65) this.once('confused', () => this.cue('confused', _a.copy(e.root.position).setY(3.6)));
    }

    if (t >= 2.8) this.finishEnding();
  }

  finishEnding() {
    const resolve = this.ending.resolve;
    this.ending.resolve = () => {};
    resolve();
  }
}
