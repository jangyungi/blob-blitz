import * as THREE from 'three';

/**
 * One WebGL context, several scene layers composited in order.
 *   layer 0: BattleStage (full screen, perspective) – future 3D battle lives here
 *   layer 1: BoardView   (scissored to the board rect, orthographic)
 * Each layer clears depth only, so later layers draw over earlier ones.
 *
 * Retro + cheap: the canvas backing store is a whole-device-pixel fraction of the screen and CSS upscales it
 * with `image-rendering: pixelated`. No MSAA, no shadow maps, no environment maps, so even a
 * low-end phone only shades a few hundred thousand pixels per frame.
 */
export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'low-power',
      stencil: false,
    });
    this.gl.setPixelRatio(1);
    this.gl.autoClear = false;
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.NoToneMapping;
    this.gl.setClearColor(0x05060f, 1);
    this.width = 1; // CSS px
    this.height = 1;
    this.vw = 1; // rendered px
    this.vh = 1;
  }

  /** Uses layout.virtual (integer rendered pixels) for the backing store, CSS px for display. */
  setSize(layout) {
    const { virtual, px } = layout;
    this.width = virtual.w * px; // CSS px
    this.height = virtual.h * px;
    this.vw = virtual.w;
    this.vh = virtual.h;
    this.gl.setSize(virtual.w, virtual.h, false);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
  }

  /** layers: [{ scene, camera, rect? }], rect in rendered pixels with a top-left origin. */
  render(layers) {
    const gl = this.gl;
    const { vw, vh } = this;
    gl.setScissorTest(false);
    gl.setViewport(0, 0, vw, vh);
    gl.clear();
    for (const { scene, camera, rect } of layers) {
      if (rect) {
        const y = vh - rect.y - rect.h;
        gl.setViewport(rect.x, y, rect.w, rect.h);
        gl.setScissor(rect.x, y, rect.w, rect.h);
        gl.setScissorTest(true);
      } else {
        gl.setViewport(0, 0, vw, vh);
        gl.setScissorTest(false);
      }
      gl.clearDepth();
      gl.render(scene, camera);
    }
  }
}
