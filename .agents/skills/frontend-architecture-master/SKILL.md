---
name: frontend-architecture-master
description: >
  Building highly scalable frontend architectures with expert-level UI/UX and animations.
  Use this skill whenever the user asks for React or Next.js components, Tailwind CSS styling,
  WebGL or Three.js 3D experiences, GSAP or Framer Motion animations, animated landing pages,
  interactive dashboards, design systems, component libraries, or any complex frontend build.
  Trigger even for phrases like "build me a UI", "make an animated component", "create a page",
  "design a dashboard", "I want something that looks premium", or "I need a frontend for X".
  Every output must be unique, human-feeling, XSS-safe, and production-grade.
  This skill covers two sequential phases: (1) Architecture & Motion Choreography (.md plan),
  then (2) Implementation in modular .tsx/.ts/.css files with Zustand state and Framer Motion.
---

<!-- SKILL: frontend-architecture-master — DO NOT EDIT DESCRIPTION BLOCK ABOVE -->

# Frontend Architecture Master

Exceptional frontend engineering merges scalable systems with fluid, performant motion.
Every design produced by this skill must feel **alive, intentional, and distinctly human** —
never generic, never templated, never "AI-ish."

---

## Phase 1 — Architecture & Motion Choreography

Before writing a single line of code, produce a structured plan as a `.md` file covering all four axes below.

### 1. Component Hierarchy & Data Architecture

- Map out the **component tree** (Atomic Design: atoms → molecules → organisms → templates → pages)
- Identify which components are **Server Components** vs **Client Components** (Next.js App Router)
- Define **data fetching strategy**: `fetch` with caching, React Query/SWR, or server actions
- Plan **Zustand store slices**: one slice per domain concern (e.g., `useUIStore`, `useUserStore`, `useAnimationStore`)
- Specify **TypeScript interfaces/types** for all props and store shapes up front

### 2. Responsive, Utility-First Styling Strategy

- Use **Tailwind CSS** as the primary styling layer — no arbitrary inline styles unless unavoidable
- Define a **design token vocabulary** (`colors`, `spacing`, `typography`, `shadows`, `radii`) as Tailwind config extensions
- Mobile-first breakpoints: `sm` → `md` → `lg` → `xl` → `2xl`
- Use `clsx` + `tailwind-merge` (`cn()`) for conditional class composition
- Identify any **global CSS** needs (custom scrollbars, font-face, keyframes not achievable in Tailwind)

### 3. Animation Choreography

Think of animations as **choreography**, not decoration. Plan:

- **Spatial relationships**: which elements enter from where, exit to where, and why
- **Timing & stagger logic**: define `delay`, `duration`, and `ease` families for each interaction class
- **Hardware-accelerated properties only**: `transform`, `opacity`, `filter` — never `width`, `height`, `top`, `left`
- **Reduced motion**: always wrap motion in `useReducedMotion()` checks or `@media (prefers-reduced-motion)`

#### Tech Stack Selection for Motion

| Use Case | Tool |
|---|---|
| React component transitions, layout animations, drag | **Framer Motion** |
| Complex scroll-driven sequences, timelines, SVG paths | **GSAP + ScrollTrigger** |
| 3D scenes, WebGL shaders, particle systems | **Three.js + React Three Fiber (@react-three/fiber)** |
| Simple CSS-only micro-interactions | **Tailwind + CSS custom keyframes** |

For most UI builds, **Framer Motion** is the default. Reach for GSAP only when orchestrating multi-element timelines or scroll sequences. Mix both only when each is clearly the best fit for its section.

### 4. Security Architecture

Every build must address security up front:
- **XSS prevention**: never use `dangerouslySetInnerHTML` unless sanitized with `DOMPurify`
- **Input sanitization**: use `zod` for runtime schema validation on all user inputs
- **CSP awareness**: avoid inline scripts; rely on bundled modules
- **No raw URL interpolation**: always validate/encode dynamic URL segments

---

## Phase 2 — Implementation

Translate the Phase 1 plan into production-quality, fully typed code.

### File Output Convention

```
src/
├── components/
│   ├── [ComponentName]/
│   │   ├── index.tsx
│   │   ├── [ComponentName].tsx
│   │   ├── [ComponentName].types.ts
│   │   └── [ComponentName].module.css
├── store/
│   └── [domain].store.ts
├── lib/
│   ├── sanitize.ts
│   └── motion.ts
└── styles/
    └── globals.css
```

### Coding Standards

**TypeScript**
- Strict mode always (`"strict": true` in tsconfig)
- Prefer `interface` for component props, `type` for unions/intersections
- No `any` — use `unknown` and narrow with type guards

**Zustand**
```ts
import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

interface UIState {
  isNavOpen: boolean
  setNavOpen: (open: boolean) => void
}

export const useUIStore = create<UIState>()(
  devtools((set) => ({
    isNavOpen: false,
    setNavOpen: (open) => set({ isNavOpen: open }),
  }))
)
```

**Framer Motion**
```tsx
export const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
}

const { prefersReducedMotion } = useReducedMotion()
```

**Sanitization pattern**
```ts
import DOMPurify from 'dompurify'
import { z } from 'zod'

export const sanitizeHtml = (raw: string) =>
  DOMPurify.sanitize(raw, { ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a'] })

export const UserInputSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  email: z.string().email(),
})
```

---

## Design Philosophy

Every design must be **unique and human-feeling**. Concretely:

- **Avoid symmetry traps**: not everything needs to be perfectly centred. Use intentional asymmetry, overlapping layers, and generous whitespace
- **Typography as hierarchy**: vary weights and sizes dramatically
- **Colour with restraint**: one dominant hue, one accent, one neutral family
- **Motion with meaning**: every animation must serve a user-comprehension or delight goal
- **Humanized copy in placeholder content**: never write "Lorem ipsum"

---

## Reference Files

- `references/animation-patterns.md` — Reusable Framer Motion + GSAP patterns, easing curves, stagger recipes
- `references/component-templates.md` — Boilerplate for common organisms (Hero, Nav, Card Grid, Modal, Form)
- `references/security-checklist.md` — XSS, CSP, input validation checklist to run before delivery

---

> **CRITICAL GUARDRAIL: ZERO-GUESSING POLICY**
> You are strictly forbidden from guessing, assuming, or hallucinating code architecture, variable names, or logic. If the user asks for a fix, an adjustment, or a review, and has not provided the relevant source file (either via upload, text, or connected repository), you MUST stop immediately. Your only response should be to ask the user to provide the specific file(s) needed before you suggest any code changes.
