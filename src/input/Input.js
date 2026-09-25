const KEYMAP = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowDown: 'soft',
  KeyS: 'soft',
  ArrowUp: 'rotCW',
  KeyX: 'rotCW',
  KeyK: 'rotCW',
  KeyZ: 'rotCCW',
  KeyJ: 'rotCCW',
  Space: 'hardDrop',
  KeyW: 'hardDrop',
  Enter: 'confirm',
  Escape: 'pause',
  KeyP: 'pause',
  KeyM: 'mute',
  KeyC: 'crt',
};

/**
 * Keyboard + touch. Game code only sees abstract actions:
 *   count(action)  – presses since last frame (touch drags can produce several)
 *   held(action)   – currently held (keyboard / touch soft drop)
 *   horizontal()   – most recently pressed, still-held horizontal direction (for DAS)
 */
export class Input {
  constructor(surface, getCellPx) {
    this.getCellPx = getCellPx;
    this.heldSet = new Set();
    this.counts = new Map();
    this.horizontalStack = [];
    this.listeners = new Set();

    window.addEventListener('keydown', (e) => {
      const action = KEYMAP[e.code];
      if (!action) return;
      e.preventDefault();
      if (e.repeat) return; // we do our own auto-repeat
      this.press(action);
      this.heldSet.add(action);
      if (action === 'left' || action === 'right') {
        this.horizontalStack = this.horizontalStack.filter((a) => a !== action);
        this.horizontalStack.push(action);
      }
    });
    window.addEventListener('keyup', (e) => {
      const action = KEYMAP[e.code];
      if (!action) return;
      this.heldSet.delete(action);
      this.horizontalStack = this.horizontalStack.filter((a) => a !== action);
    });
    window.addEventListener('blur', () => {
      this.heldSet.clear();
      this.horizontalStack = [];
    });

    this.bindTouch(surface);
  }

  /** Listen to raw action presses (menus, pause, mute). */
  onPress(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  press(action, n = 1) {
    this.counts.set(action, (this.counts.get(action) || 0) + n);
    for (let i = 0; i < n; i++) this.listeners.forEach((fn) => fn(action));
  }

  count(action) {
    return this.counts.get(action) || 0;
  }

  held(action) {
    return this.heldSet.has(action) || (action === 'soft' && this.touchSoft);
  }

  horizontal() {
    const last = this.horizontalStack[this.horizontalStack.length - 1];
    return last === 'left' ? -1 : last === 'right' ? 1 : 0;
  }

  endFrame() {
    this.counts.clear();
  }

  // Touch: drag sideways = move column-by-column, tap = rotate, flick down = hard drop,
  // slow drag down = soft drop.
  bindTouch(el) {
    let t = null;
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      el.setPointerCapture?.(e.pointerId);
      t = { id: e.pointerId, x: e.clientX, y: e.clientY, time: performance.now(), steps: 0, moved: false };
    });
    el.addEventListener('pointermove', (e) => {
      if (!t || e.pointerId !== t.id) return;
      const cell = this.getCellPx();
      const dx = e.clientX - t.x;
      const dy = e.clientY - t.y;
      if (Math.hypot(dx, dy) > 10) t.moved = true;
      const target = Math.round(dx / (cell * 0.9));
      while (t.steps < target) {
        this.press('right');
        t.steps++;
      }
      while (t.steps > target) {
        this.press('left');
        t.steps--;
      }
      this.touchSoft = dy > cell * 1.2 && Math.abs(dy) > Math.abs(dx);
    });
    const end = (e) => {
      if (!t || e.pointerId !== t.id) return;
      const cell = this.getCellPx();
      const dt = performance.now() - t.time;
      const dy = e.clientY - t.y;
      const dx = e.clientX - t.x;
      if (!t.moved && dt < 350) {
        this.press('rotCW');
      } else if (dy > cell * 1.5 && dy / dt > 0.9 && Math.abs(dy) > Math.abs(dx) * 1.5) {
        this.press('hardDrop');
      }
      this.touchSoft = false;
      t = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }
}
