import * as THREE from 'three';

const vertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform float uScale;
  uniform float uPerspective;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = max(1.0, floor(aSize * uScale * mix(1.0, 1.0 / max(0.001, -mv.z), uPerspective) + 0.5));
  }
`;

// Hard-edged square "pixels" – retro, and cheaper than soft sprites.
const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    gl_FragColor = vec4(vColor, vAlpha);
    #include <colorspace_fragment>
  }
`;

const tmpColor = new THREE.Color();
const rand = (a, b) => a + Math.random() * (b - a);

/** Pooled additive point particles (CPU simulated). Sizes are in world units. */
export class Particles {
  constructor(max = 2000, { perspective = false } = {}) {
    this.max = max;
    this.cursor = 0;
    this.alive = 0; // upper bound of live particles; lets idle frames skip all work
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry = g;
    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 50 }, uPerspective: { value: perspective ? 1 : 0 } },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    this.points.visible = false;
  }

  setScale(v) {
    this.material.uniforms.uScale.value = v;
  }

  /**
   * opts: { count, color, speed:[a,b], size:[a,b], life:[a,b], gravity, drag,
   *         angle (radians, direction), spread (radians), spreadPos, z, vz }
   */
  emit(x, y, z, opts = {}) {
    const {
      count = 12,
      color = 0xffffff,
      speed = [2, 6],
      size = [0.15, 0.35],
      life = [0.35, 0.7],
      gravity = -8,
      drag = 1.5,
      angle = Math.PI / 2,
      spread = Math.PI * 2,
      spreadPos = 0,
      vz = 0,
    } = opts;
    tmpColor.set(color);
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      const a = angle + (Math.random() - 0.5) * spread;
      const s = rand(speed[0], speed[1]);
      this.pos[i * 3] = x + (Math.random() - 0.5) * spreadPos;
      this.pos[i * 3 + 1] = y + (Math.random() - 0.5) * spreadPos;
      this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * spreadPos * 0.5;
      this.vel[i * 3] = Math.cos(a) * s;
      this.vel[i * 3 + 1] = Math.sin(a) * s;
      this.vel[i * 3 + 2] = vz ? rand(-vz, vz) : 0;
      this.col[i * 3] = tmpColor.r;
      this.col[i * 3 + 1] = tmpColor.g;
      this.col[i * 3 + 2] = tmpColor.b;
      this.size0[i] = rand(size[0], size[1]);
      this.size[i] = this.size0[i];
      this.life[i] = this.maxLife[i] = rand(life[0], life[1]);
      this.alpha[i] = 1;
      this.grav[i] = gravity;
      this.drag[i] = drag;
    }
    this.alive = Math.min(this.max, this.alive + count);
    this.points.visible = true;
    this.geometry.attributes.aColor.needsUpdate = true; // colors only change on emit
  }

  update(dt) {
    if (this.alive === 0) return;
    let live = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        if (this.alpha[i] !== 0) {
          this.alpha[i] = 0;
          this.size[i] = 0;
        }
        continue;
      }
      live++;
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      const damp = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= damp;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * damp + this.grav[i] * dt;
      this.vel[i * 3 + 2] *= damp;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.alpha[i] = k;
      this.size[i] = this.size0[i] * (0.4 + 0.6 * k);
    }
    this.alive = live;
    if (live === 0) this.points.visible = false; // no draw call while idle
    const a = this.geometry.attributes;
    a.position.needsUpdate = true;
    a.aSize.needsUpdate = true;
    a.aAlpha.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    this.alpha.fill(0);
    this.alive = 0;
    this.points.visible = false;
  }
}
