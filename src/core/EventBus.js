// Tiny pub/sub. Gameplay emits, presentation layers (HUD, audio, battle stage) listen.
export class EventBus {
  constructor() {
    this.handlers = new Map();
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    this.handlers.get(type)?.delete(fn);
  }

  emit(type, payload) {
    this.handlers.get(type)?.forEach((fn) => fn(payload));
    this.handlers.get('*')?.forEach((fn) => fn(type, payload));
  }
}
