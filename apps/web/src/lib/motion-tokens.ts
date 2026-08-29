export const motionTokens = {
  duration: {
    instant: 0.08,
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
    elastic: 0.82,
  },
  stack: {
    secondScale: 0.97,
    thirdScale: 0.94,
    secondY: 12,
    thirdY: 24,
    secondOpacity: 0.82,
    thirdOpacity: 0.58,
  },
} as const;

export const springs = {
  snappy: { type: "spring", stiffness: 300, damping: 30 } as const,
  gentle: { type: "spring", stiffness: 120, damping: 14 } as const,
  bouncy: { type: "spring", stiffness: 400, damping: 10 } as const,
  instant: { type: "spring", stiffness: 600, damping: 35 } as const,
  release: {
    type: "spring",
    stiffness: 200,
    damping: 20,
    restDelta: 0.001,
  } as const,
};
