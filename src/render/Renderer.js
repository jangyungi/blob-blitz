import * as THREE from 'three';

/**
 * One WebGL context, several scene layers composited in order.
 *   layer 0: BattleStage (full screen, perspective) – future 3D battle lives here
 *   layer 1: BoardView   (scissored to the board rect, orthographic)
 * Each layer clears depth only, so later layers draw over earlier ones.
 *
 * Retro + cheap: the canvas backing store is 1/pixelSize of its CSS size and CSS upscales it
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
    this.width = 1; // CSS px (a multiple of pixelSize)
    this.height = 1;
    this.pixelSize = 3; // CSS px per rendered pixel
  }

  /** width/height in CSS px, already snapped to multiples of pixelSize. */
  setSize(width, height, pixelSize) {
    this.width = width;
    this.height = height;
    this.pixelSize = pixelSize;
    this.gl.setSize(width / pixelSize, height / pixelSize, false);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
  }

  /** layers: [{ scene, camera, rect? }], rect in CSS px (snapped) with a top-left origin. */
  render(layers) {
    const gl = this.gl;
    const px = this.pixelSize;
    const vw = this.width / px;
    const vh = this.height / px;
    gl.setScissorTest(false);
    gl.setViewport(0, 0, vw, vh);
    gl.clear();
    for (const { scene, camera, rect } of layers) {
      if (rect) {
        const x = rect.x / px;
        const w = rect.w / px;
        const h = rect.h / px;
        const y = vh - rect.y / px - h;
        gl.setViewport(x, y, w, h);
        gl.setScissor(x, y, w, h);
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
