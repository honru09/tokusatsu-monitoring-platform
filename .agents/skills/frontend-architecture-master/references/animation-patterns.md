# Animation Patterns Reference

## Easing Curves

```ts
// lib/motion.ts — canonical easing values
export const ease = {
  out:    [0.22, 1, 0.36, 1],      // smooth deceleration (most UI transitions)
  in:     [0.64, 0, 0.78, 0],      // quick start, slow exit (exits/dismissals)
  inOut:  [0.83, 0, 0.17, 1],      // symmetrical, dramatic
  spring: { type: 'spring', stiffness: 300, damping: 30 },
  bouncy: { type: 'spring', stiffness: 400, damping: 20 },
}
```

---

## Reusable Framer Motion Variants

### Fade Up (standard entrance)
```ts
export const fadeUp = {
  hidden:  { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: ease.out } },
}
```

### Staggered Container
```ts
export const staggerContainer = {
  hidden:  {},
  visible: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
}
// Use on the parent <motion.ul> / <motion.div>
// Children automatically pick up fadeUp or scaleIn
```

### Scale In (cards, modals)
```ts
export const scaleIn = {
  hidden:  { opacity: 0, scale: 0.94 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.4, ease: ease.out } },
}
```

### Slide from Left / Right
```ts
export const slideFromLeft  = { hidden: { opacity: 0, x: -40 }, visible: { opacity: 1, x: 0 } }
export const slideFromRight = { hidden: { opacity: 0, x:  40 }, visible: { opacity: 1, x: 0 } }
```

### Page Transition (Next.js App Router)
```tsx
// app/template.tsx — wraps every page
'use client'
import { motion } from 'framer-motion'

export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={  { opacity: 0, y: -8 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  )
}
```

### Hover Lift (buttons, cards)
```tsx
<motion.div whileHover={{ y: -4, boxShadow: '0 12px 32px rgba(0,0,0,0.12)' }}
            whileTap={  { scale: 0.97 }}
            transition={{ duration: 0.2 }}>
```

---

## GSAP Patterns

### ScrollTrigger — Reveal on scroll
```ts
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
gsap.registerPlugin(ScrollTrigger)

gsap.from('.reveal-card', {
  opacity: 0, y: 48, stagger: 0.1, duration: 0.7, ease: 'power3.out',
  scrollTrigger: {
    trigger: '.reveal-card',
    start: 'top 80%',
    toggleActions: 'play none none reverse',
  },
})
```

### Horizontal scroll section
```ts
gsap.to('.track', {
  x: () => -(document.querySelector('.track')!.scrollWidth - window.innerWidth),
  ease: 'none',
  scrollTrigger: {
    trigger: '.pin-container',
    pin: true,
    scrub: 1,
    end: () => `+=${document.querySelector('.track')!.scrollWidth}`,
  },
})
```

---

## Reduced Motion

Always wrap motion in this check:
```tsx
import { useReducedMotion } from 'framer-motion'

export function AnimatedCard({ children }: { children: React.ReactNode }) {
  const prefersReduced = useReducedMotion()
  return (
    <motion.div
      variants={prefersReduced ? {} : scaleIn}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '-80px' }}
    >
      {children}
    </motion.div>
  )
}
```
