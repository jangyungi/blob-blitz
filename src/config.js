// All gameplay tunables live here so balancing never requires touching logic.
export const CONFIG = {
  cols: 6,
  visibleRows: 12,
  totalRows: 13, // row 12 (0-based) is the hidden spawn row, like the 13th row in classic falling-blob games
  spawnX: 2, // also the "death" column: blocking (spawnX, visibleRows-1) triggers OVERFLOW
  numColors: 4,
  gameTime: 60,

  control: {
    fallInterval: 0.6, // seconds per cell at the start of a round
    fallIntervalEnd: 0.3, // ...and when the clock runs out
    softDropInterval: 0.028,
    lockDelay: 0.3,
    softLockDelay: 0.06,
    maxLockResets: 10,
    das: 0.12, // delayed auto shift
    arr: 0.035, // auto repeat rate
  },

  anim: {
    gravity: 110, // cells / s^2 for settling blobs
    hardDropSpeed: 38, // initial downward speed after a hard drop
    flash: 0.13,
    burst: 0.13,
    blastStagger: 0.07,
  },

  score: {
    base: 10,
    // indexed by chain number (1-based); clamps to the last entry
    chainPower: [0, 1, 4, 8, 14, 22, 32, 44, 58, 74, 92, 112, 134, 158, 184, 212],
    // indexed by group size; clamps to the last entry
    groupBonus: [0, 0, 0, 0, 0, 2, 3, 4, 5, 6, 7, 10],
    // indexed by number of distinct colors popped in a single step
    colorBonus: [0, 0, 3, 6, 12, 24],
    blastCell: 20, // per blob destroyed by a bomb / star
    prismCell: 30, // per blob destroyed by a prism
    speedBonus: 150, // x (speed level - 1)
    hurrahMul: 2, // score multiplier during LAST HURRAH
    softDropCell: 1,
  },

  specials: {
    bombAt: 5, // group size that leaves a BOMB blob behind
    starAt: 6, // group size that leaves a STAR blob behind
    prismGroupAt: 8, // group size that grants a PRISM piece
    prismChainAt: 4, // chain length that grants a PRISM piece
    bombRadius: 2, // manhattan radius
    multChance: 0.08,
    timeChance: 0.07,
    timeBonus: 5,
    maxMult: 8,
  },

  speed: {
    window: 3.0, // seconds allowed between clears to keep the speed chain alive
    blazingAt: 5, // speed level that ignites BLAZING
    blazingTime: 8,
    blazingMul: 2,
  },

  overflow: {
    timePenalty: 3,
    crushFromRow: 6, // everything at or above this row is crushed
  },
};

export const BLOB_COLORS = [
  { name: 'red', hex: 0xff3d5e, css: '#ff3d5e' },
  { name: 'green', hex: 0x35e07c, css: '#35e07c' },
  { name: 'blue', hex: 0x3d8bff, css: '#3d8bff' },
  { name: 'yellow', hex: 0xffcf33, css: '#ffcf33' },
  { name: 'purple', hex: 0xb65cff, css: '#b65cff' },
];

export const GARBAGE_COLOR = { hex: 0x9aa3b8, css: '#9aa3b8' };
