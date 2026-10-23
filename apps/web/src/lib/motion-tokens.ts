export const motionTokens = {
  duration: {
    instant: 0.08,
    press: 0.12,
    feedback: 0.18,
    disclosure: 0.22,
    sheet: 0.26,
    spatial: 0.42,
    fast: 0.18,
    normal: 0.35,
    slow: 0.6,
    crawl: 1,
  },
  easing: {
    smooth: [0.22, 1, 0.36, 1] as const,
    sharp: [0.4, 0, 0.2, 1] as const,
    bounce: [0.34, 1.56, 0.64, 1] as const,
    linear: [0, 0, 1, 1] as const,
  },
  distance: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 48,
  },
  scale: {
    subtle: 0.98,
    press: 0.95,
    pop: 1.04,
  },
  gesture: {
    actionDistance: 110,
    detailDistance: 100,
    flickDistance: 38,
    velocity: 650,
    axisDominance: 1.12,
    feedbackDistance: 84,
    exitDistance: 720,
    elastic: 0.46,
  },
  stack: {
    secondScale: 0.985,
    thirdScale: 0.97,
    secondY: 10,
    thirdY: 18,
    secondOpacity: 0.9,
    thirdOpacity: 0.72,
  },
} as const;

export const springs = {
  appleSpatial: { type: "spring", stiffness: 360, damping: 34, mass: 0.85 } as const,
  appleSelection: { type: "spring", stiffness: 420, damping: 30, mass: 0.75 } as const,
  applePress: { type: "spring", stiffness: 620, damping: 32, mass: 0.55 } as const,
  /** Critically damped — Apple default for reposition / UI settle */
  snappy: { type: "spring", stiffness: 380, damping: 34, mass: 0.85 } as const,
  gentle: { type: "spring", stiffness: 180, damping: 24, mass: 1 } as const,
  /** Momentum-only: use after a flick, not for chrome fades */
  bouncy: { type: "spring", stiffness: 400, damping: 18, mass: 0.9 } as const,
  instant: { type: "spring", stiffness: 620, damping: 38, mass: 0.7 } as const,
  release: {
    type: "spring",
    stiffness: 260,
    damping: 28,
    mass: 0.9,
    restDelta: 0.001,
  } as const,
};
