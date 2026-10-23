# UI Skill Groups

Canonical map for frontend work in this repo. Prefer **local** `.agents/skills/*` first. Load **antislop** on every UI pass.

Install / refresh Emil pack (project-local, non-interactive):

```bash
npx skills@latest add emilkowalski/skills --all --copy
```

Lockfile: `skills-lock.json`.

## Pipeline (load in order)

| Stage | Intent | Primary | Local paths |
| --- | --- | --- | --- |
| **1. UI/UX Brain** | Hierarchy, a11y, product UX | UI UX Pro Max | `C:\Users\wangxr\.codex\skills\ui-ux-pro-max\` · also `interface-design` |
| **2. Visual Direction** | Complete visual presence, hierarchy, anti-template | Anthropic frontend-design + apple-design + Emil | `.agents/skills/frontend-design` · `.agents/skills/apple-design` · `.agents/skills/emil-design-eng` |
| **3. Component Inspiration** | Patterns / interactions | 21st.dev | `.agents/skills/21st-ui-explore` · `21st-ui-build` · `21st-ui-review` · `21st-cli-use` · `21st-ai` · `21st-design-sync` |
| **4. Motion** | Purposeful motion only | Emil + motion + Frontend Architecture Master | `.agents/skills/animate` · `animation-vocabulary` · `find-animation-opportunities` · `improve-animations` · `review-animations` · `frontend-architecture-master` · repo `apps/web/src/lib/motion-tokens.ts` |
| **5. Foundation** | Primitives & tokens | shadcn/ui | `.agents/skills/shadcn` · `design-system/tokusatsu-market-intelligence/MASTER.md` |

## Always-on local filters

## Image2 UI rules

Installed source: `zhu-guli326/image2_UI`, revision `462d6bd1ea8d9b3b0f1156df8ab7f4432da34d03`.
Read `.agents/skills/image-to-ui-skill/SKILL.md` for screenshot fidelity, real controls, safe areas, 44 px touch targets and rendered verification. The current system keeps its existing design tokens and product imagery. The user's AI quota restriction takes precedence over optional raster generation or new external runtime calls. `PROVENANCE.json` records the installation and omitted repository cache files.

| Skill | Path | Role |
| --- | --- | --- |
| **antislop** | `.agents/skills/antislop` | Kill badge spam, glow, generic SaaS cards |
| **antislop-layoutmobile** | `.agents/skills/antislop-layoutmobile` | Reject desktop-squeezed phone layouts |
| **mobile-design** | `.agents/skills/mobile-design` | Touch-first, thumb zones, platform norms |
| **responsive-design** | `.agents/skills/responsive-design` | Container queries, fluid type, breakpoints |
| **ui-typography** | `.agents/skills/ui-typography` | Type hierarchy, punctuation, CSS baseline |
| **axiom-typography-ref** | `.agents/skills/axiom-typography-ref` | HIG / SF Symbols optical references |

## Emil Kowalski pack (installed)

| Skill | Path |
| --- | --- |
| apple-design | `.agents/skills/apple-design` |
| emil-design-eng | `.agents/skills/emil-design-eng` |
| animate / animate-expo | `.agents/skills/animate`, `animate-expo` |
| animation-vocabulary | `.agents/skills/animation-vocabulary` |
| find / improve / review animations | `.agents/skills/find-animation-opportunities`, `improve-animations`, `review-animations` |
| ask-sonner, pick-ui-library, prototype, write-swift | matching folders under `.agents/skills/` |

## Discovery decision-card load order

1. This file → pick groups
2. UI/UX Brain → 2-second scan hierarchy
3. Visual Direction: `frontend-design` + `apple-design` + `emil-design-eng`
4. antislop (+ layoutmobile on phone)
5. mobile-design / responsive-design / ui-typography
6. Motion tokens only if motion changes
7. 21st / shadcn for inspiration — adapt, don’t paste aesthetics

### Field mapping (decision card)

| Order | Field | UI |
| --- | --- | --- |
| 1 | Identity | Title + subtitle + ≤3 tags |
| 2 | Quantity | 数量 |
| 3 | Total price | 总价 (hero mono) |
| 4 | Unit price | 单价 |
| 5 | Opportunity | One-line judgment (China ref and/or procurement) |
| 6 | Source / time | Footer meta (`平台 · 相对时间`) |

Media overlays stay minimal: source chip, image count, auction countdown only. Primary actions: 收藏 / 查看详情 / 更多. Mobile discovery is full-viewport (`100dvh`) under the bottom nav.

Design intensity is **ENERGY 3 / RHYTHM 3 / MOTION 3**: use an expressive but operational Apple/Liquid-Glass treatment with unmistakable spatial hierarchy, varied content-driven composition and interruptible physical feedback. Motion must explain origin, navigation or state; avoid decorative looping, neon glow, exaggerated bounce and interaction delay.

## Out of scope for UI polish

`ai-sdk`, `env-secrets-manager`, `xianyu-market-intelligence` — product/infra, not design stages.

## 当前整站动效补充

执行整站编辑式改版时，同时读取 docs/UI_MOTION_RULES.md；六类滚动模式按内容选择，保持真实状态、键盘替代与 reduced motion。
