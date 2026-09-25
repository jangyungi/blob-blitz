import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/**
 * One WebGL context, several scene layers composited in order.
 *   layer 0: BattleStage (full screen, perspective) – future 3D battle lives here
 *   layer 1: BoardView   (scissored to the board rect, orthographic)
 * Each layer clears depth only, so later layers draw over earlier ones.
 */
export class Renderer {
  constructor(canvas) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.gl.autoClear = false;
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.NeutralToneMapping;
    this.gl.toneMappingExposure = 1.0;
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.gl.setClearColor(0x05060f, 1);

    const pmrem = new THREE.PMREMGenerator(this.gl);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.width = 1;
    this.height = 1;
  }

  get pixelRatio() {
    return this.gl.getPixelRatio();
  }

  setSize(w, h) {
    this.width = w;
    this.height = h;
    this.gl.setSize(w, h, false);
  }

  /** layers: [{ scene, camera, rect? }], rect in CSS px with a top-left origin. */
  render(layers) {
    const gl = this.gl;
    gl.setScissorTest(false);
    gl.setViewport(0, 0, this.width, this.height);
    gl.clear();
    for (const { scene, camera, rect } of layers) {
      if (rect) {
        const y = this.height - rect.y - rect.h;
        gl.setViewport(rect.x, y, rect.w, rect.h);
        gl.setScissor(rect.x, y, rect.w, rect.h);
        gl.setScissorTest(true);
      } else {
        gl.setViewport(0, 0, this.width, this.height);
        gl.setScissorTest(false);
      }
      gl.clearDepth();
      gl.render(scene, camera);
    }
  }
}
