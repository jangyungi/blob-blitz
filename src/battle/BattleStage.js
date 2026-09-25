import * as THREE from 'three';
import { BLOB_COLORS } from '../config.js';
import { Tex } from '../render/textures.js';
import { Particles } from '../render/Particles.js';

/**
 * Full-screen 3D layer behind the puzzle board.
 *
 * This is the hook for the future battle presentation. The puzzle never talks to it
 * directly: main.js forwards bus events into `attack()` / `onBlazing()` / etc.
 * Replace the primitive hero/enemy with GLTF characters and keep this public surface:
 *
 *   setFocus(layout)          – where on screen the action should be framed
 *   update(dt)
 *   attack({ chain, count, colors, points, blazing, hurrah })
 *   onBlazing(active) / onOverflow() / reset()
 *   onDamage = (screenX, screenY, amount, big) => {}   (set by main.js for damage numbers)
 */
export class BattleStage {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.scene.environment = renderer.envMap;
    this.scene.environmentIntensity = 0.35;
    this.scene.fog = new THREE.Fog(0x140c2a, 14, 42);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
    this.camBase = new THREE.Vector3(0, 3.1, 10.5);
    this.lookAt = new THREE.Vector3(0, 1.3, 0);
    this.time = 0;
    this.shakeAmp = 0;
    this.projectiles = [];
    this.bursts = [];
    this.blazing = false;
    this.onDamage = null;

    this.buildWorld();
    this.hero = this.buildHero();
    this.hero.root.position.set(-2.6, 0, 0.4);
    this.hero.root.rotation.y = 0.5;
    this.enemy = this.buildEnemy();
    this.enemy.root.position.set(2.7, 0, -0.4);
    this.enemy.root.rotation.y = -0.4;
    this.scene.add(this.hero.root, this.enemy.root);

    this.particles = new Particles(1500, { perspective: true });
    this.scene.add(this.particles.points);
  }

  // ─── world ────────────────────────────────────────────────────────────────

  buildWorld() {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(90, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { uTop: { value: new THREE.Color(0x0b0d2e) }, uMid: { value: new THREE.Color(0x3a1d5c) }, uBottom: { value: new THREE.Color(0xff6a7a) } },
        vertexShader: `varying vec3 vPos; void main(){ vPos = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `
          uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uBottom; varying vec3 vPos;
          void main(){
            float h = vPos.y;
            vec3 c = mix(uMid, uTop, smoothstep(0.05, 0.6, h));
            c = mix(uBottom, c, smoothstep(-0.12, 0.12, h));
            gl_FragColor = vec4(c, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    );
    this.scene.add(sky);

    // stars
    const starGeo = new THREE.BufferGeometry();
    const pts = [];
    for (let i = 0; i < 500; i++) {
      const v = new THREE.Vector3().randomDirection();
      if (v.y < 0.08) v.y = Math.abs(v.y) + 0.08;
      pts.push(v.multiplyScalar(80));
    }
    starGeo.setFromPoints(pts);
    this.scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.35, fog: false, transparent: true, opacity: 0.8 })));

    const hemi = new THREE.HemisphereLight(0x9db2ff, 0x3a1830, 1.1);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffd7c2, 2.2);
    sun.position.set(-6, 10, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -8;
    sun.shadow.camera.right = 8;
    sun.shadow.camera.top = 8;
    sun.shadow.camera.bottom = -8;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);
    this.flashLight = new THREE.PointLight(0xffffff, 0, 12, 1.5);
    this.flashLight.position.set(2.7, 1.8, 0.5);
    this.scene.add(this.flashLight);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(120, 64),
      new THREE.MeshStandardMaterial({ color: 0x1a1433, roughness: 0.9, metalness: 0.1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const arena = new THREE.Mesh(
      new THREE.CylinderGeometry(5.2, 5.5, 0.3, 64),
      new THREE.MeshStandardMaterial({ color: 0x2a2150, roughness: 0.6, metalness: 0.2 }),
    );
    arena.position.y = 0.15;
    arena.receiveShadow = true;
    this.scene.add(arena);

    this.runeRing = new THREE.Mesh(
      new THREE.TorusGeometry(4.6, 0.05, 8, 96),
      new THREE.MeshBasicMaterial({ color: 0x6f7dff }),
    );
    this.runeRing.rotation.x = -Math.PI / 2;
    this.runeRing.position.y = 0.31;
    this.scene.add(this.runeRing);

    // pillars with glowing caps
    this.pillarCaps = [];
    for (let i = 0; i < 8; i++) {
      const a = Math.PI * (1.02 + (i / 7) * 0.96); // back half-circle only
      const r = 7.5 + (i % 2) * 1.5;
      const h = 2.5 + (i % 3) * 1.2;
      const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.45, h, 6),
        new THREE.MeshStandardMaterial({ color: 0x2b2448, roughness: 0.8 }),
      );
      pillar.position.set(Math.cos(a) * r * 1.3, h / 2, Math.sin(a) * r - 1);
      pillar.castShadow = true;
      this.scene.add(pillar);
      const cap = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.35),
        new THREE.MeshBasicMaterial({ color: BLOB_COLORS[i % 4].hex }),
      );
      cap.position.set(pillar.position.x, h + 0.6, pillar.position.z);
      this.scene.add(cap);
      this.pillarCaps.push(cap);
    }
  }

  buildHero() {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const robe = new THREE.Mesh(
      new THREE.ConeGeometry(0.62, 1.4, 20),
      new THREE.MeshStandardMaterial({ color: 0x3b4bd8, roughness: 0.5 }),
    );
    robe.position.y = 0.7;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.36, 24, 16), new THREE.MeshStandardMaterial({ color: 0xffe0c8, roughness: 0.6 }));
    head.position.y = 1.62;
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.46, 0.9, 20), new THREE.MeshStandardMaterial({ color: 0x28208a, roughness: 0.5 }));
    hat.position.y = 2.18;
    hat.rotation.z = -0.2;
    const brim = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.06, 8, 24), hat.material);
    brim.rotation.x = Math.PI / 2;
    brim.position.y = 1.82;
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 2.1, 8), new THREE.MeshStandardMaterial({ color: 0x7a4a2a }));
    staff.position.set(0.62, 1.05, 0.1);
    staff.rotation.z = -0.12;
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), new THREE.MeshBasicMaterial({ color: 0x9fe8ff }));
    orb.position.set(0.74, 2.14, 0.1);
    const orbGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: Tex.glow(), color: 0x7fd8ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    orbGlow.scale.setScalar(1.2);
    orb.add(orbGlow);
    body.add(robe, head, hat, brim, staff, orb);
    body.traverse((o) => o.isMesh && (o.castShadow = true));
    return { root, body, orb, orbGlow, cast: 0 };
  }

  buildEnemy() {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    this.enemyMat = new THREE.MeshStandardMaterial({ color: 0x5a4a7a, roughness: 0.55, metalness: 0.2, emissive: 0xff2a4a, emissiveIntensity: 0 });
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.95, 0), this.enemyMat);
    core.position.y = 1.5;
    const head = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5, 0), this.enemyMat);
    head.position.y = 2.75;
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff3355 }));
    eye.position.set(-0.1, 2.8, 0.42);
    const eyeGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: Tex.glow(), color: 0xff3355, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    eyeGlow.scale.setScalar(0.9);
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
    body.traverse((o) => o.isMesh && (o.castShadow = true));
    return { root, body, shards, core, knock: 0, knockV: 0, hit: 0, center: new THREE.Vector3(0, 1.6, 0) };
  }

  // ─── layout ───────────────────────────────────────────────────────────────

  /**
   * Frames the stage so its center lands on layout.focus (via an asymmetric view offset)
   * and pulls the camera back far enough that both fighters fit in the free area.
   */
  setFocus(layout) {
    const { width: w, height: h, focus, board } = layout;
    const vw = focus.x >= w / 2 ? 2 * focus.x : 2 * (w - focus.x);
    const vh = focus.y >= h / 2 ? 2 * focus.y : 2 * (h - focus.y);
    const ox = focus.x >= w / 2 ? 0 : vw - w;
    const oy = focus.y >= h / 2 ? 0 : vh - h;
    this.camera.aspect = vw / vh;
    this.camera.fov = 38;
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
    this.particles.setScale((vh * this.renderer.pixelRatio) / (2 * tanHalf));
  }

  // ─── events from the puzzle ───────────────────────────────────────────────

  attack({ chain = 1, count = 4, colors = [], points = 0, blazing = false, hurrah = false }) {
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

  reset() {
    this.projectiles.forEach((p) => this.scene.remove(p.sprite));
    this.projectiles = [];
    this.blazing = false;
  }

  impact(p) {
    const e = this.enemy;
    e.knockV += p.big ? 5 : 2.2;
    e.hit = 1;
    this.flashLight.color.set(p.color);
    this.flashLight.intensity = p.big ? 60 : 25;
    this.shakeAmp = Math.max(this.shakeAmp, p.big ? 0.22 : 0.06);
    this.particles.emit(p.to.x, p.to.y, p.to.z, {
      count: p.big ? 60 : 22,
      color: p.color,
      speed: [2, p.big ? 9 : 5],
      size: [0.08, 0.2],
      life: [0.3, 0.7],
      gravity: -6,
      vz: 4,
    });
    if (p.damage && this.onDamage) {
      const s = p.to.clone().add(new THREE.Vector3(0, 1.2, 0)).project(this.camera);
      const layoutW = this.renderer.width;
      const layoutH = this.renderer.height;
      this.onDamage((s.x * 0.5 + 0.5) * layoutW, (-s.y * 0.5 + 0.5) * layoutH, p.damage, p.big);
    }
  }

  // ─── per frame ────────────────────────────────────────────────────────────

  update(dt) {
    this.time += dt;
    const t = this.time;

    // camera sway + shake
    this.shakeAmp *= Math.exp(-dt * 7);
    const cam = this.camera;
    cam.position.set(
      this.camBase.x + Math.sin(t * 0.23) * 0.6 + (Math.random() - 0.5) * this.shakeAmp,
      this.camBase.y + Math.sin(t * 0.31) * 0.2 + (Math.random() - 0.5) * this.shakeAmp,
      this.camBase.z,
    );
    cam.lookAt(this.lookAt);

    // hero
    const h = this.hero;
    h.cast = Math.max(0, h.cast - dt * 4);
    h.body.position.y = 0.3 + Math.abs(Math.sin(t * 2.2)) * 0.06 + h.cast * 0.25;
    h.body.rotation.z *= Math.exp(-dt * 5);
    h.orbGlow.scale.setScalar(1.1 + h.cast * 1.6 + Math.sin(t * 6) * 0.1);
    h.orbGlow.material.color.set(this.blazing ? 0xff8a2a : 0x7fd8ff);

    // enemy: bob + spring knockback
    const e = this.enemy;
    e.knockV += (-e.knock * 60 - e.knockV * 9) * dt;
    e.knock += e.knockV * dt;
    e.hit = Math.max(0, e.hit - dt * 5);
    e.body.position.set(e.knock * 0.35, 0.35 + Math.sin(t * 1.7) * 0.12, 0);
    e.body.rotation.z = -e.knock * 0.12;
    e.shards.rotation.y += dt * (0.8 + e.hit * 6);
    this.enemyMat.emissiveIntensity = e.hit * 2.2;
    this.flashLight.intensity *= Math.exp(-dt * 10);

    this.runeRing.material.color.set(this.blazing ? 0xff7a1a : 0x6f7dff);
    this.pillarCaps.forEach((c, i) => {
      c.rotation.y += dt * (1 + i * 0.1);
      c.position.y += Math.sin(t * 2 + i) * 0.002;
    });

    // projectiles along a quadratic bezier
    this.projectiles = this.projectiles.filter((p) => {
      p.t += dt;
      if (p.t < 0) return true;
      const k = Math.min(1, p.t / p.dur);
      const e1 = k * k * (3 - 2 * k);
      const a = p.from.clone().lerp(p.ctrl, e1);
      const b = p.ctrl.clone().lerp(p.to, e1);
      const pos = a.lerp(b, e1);
      p.sprite.position.copy(pos);
      p.sprite.scale.setScalar(p.size * (0.4 + 0.6 * Math.min(1, k * 3)));
      this.particles.emit(pos.x, pos.y, pos.z, { count: 2, color: p.color, speed: [0.2, 0.8], size: [0.1, 0.22], life: [0.15, 0.3], gravity: 0, vz: 0.5 });
      if (k >= 1) {
        this.scene.remove(p.sprite);
        p.sprite.material.dispose();
        this.impact(p);
        return false;
      }
      return true;
    });

    if (this.blazing && Math.random() < dt * 30) {
      const a = Math.random() * Math.PI * 2;
      this.particles.emit(Math.cos(a) * 4.6, 0.4, Math.sin(a) * 4.6, {
        count: 1,
        color: Math.random() < 0.5 ? 0xff7a1a : 0xffc040,
        speed: [1, 3],
        size: [0.15, 0.35],
        life: [0.6, 1.1],
        gravity: 3,
        angle: Math.PI / 2,
        spread: 0.4,
      });
    }

    this.particles.update(dt);
  }
}
