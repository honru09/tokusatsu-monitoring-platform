# Security Checklist

Run through every item before delivering any frontend component or page.

---

## XSS Prevention

- [ ] **No `dangerouslySetInnerHTML`** without DOMPurify sanitisation
  ```ts
  import DOMPurify from 'isomorphic-dompurify'
  <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(userContent) }} />
  ```
- [ ] All user-supplied strings rendered as **text nodes**, not HTML
- [ ] No string interpolation into `href`, `src`, or `style` attributes from user input
- [ ] Dynamic `href` values validated against allowlist scheme (`https://` only)
- [ ] External links include `rel="noopener noreferrer"`

## Input Validation

- [ ] All form inputs validated with **Zod schemas** at the component layer
- [ ] Server actions / API routes have **independent Zod validation** (never trust client)
- [ ] File upload inputs restrict MIME type and file size
  ```ts
  import { z } from 'zod'
  export const ContactSchema = z.object({
    name:    z.string().min(2).max(80).trim(),
    email:   z.string().email(),
    message: z.string().min(10).max(2000).trim(),
  })
  ```

## State Management (Zustand)

- [ ] Sensitive data (tokens, PII) **never** stored in Zustand or localStorage without encryption
- [ ] Zustand `persist` middleware only used for non-sensitive UI preferences
- [ ] Store resets on logout (`useAuthStore.getState().reset()`)

## Content Security Policy

- [ ] No inline `<script>` blocks
- [ ] No `eval()` or `new Function()`
- [ ] External scripts loaded only from trusted, version-pinned CDN paths
- [ ] `next.config.js` sets security headers:
  ```ts
  headers: [
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  ]
  ```

## URL & Route Safety

- [ ] Dynamic route segments sanitised before use in DB queries or API calls
- [ ] Redirects use an allowlist — never redirect to a user-supplied URL directly
- [ ] `searchParams` values treated as untrusted; validated before use

## Dependencies

- [ ] Run `npm audit` — no high/critical vulnerabilities
- [ ] `DOMPurify` (or `isomorphic-dompurify` for SSR), `zod` listed as production dependencies
- [ ] No `innerHTML` patterns in third-party UI library usage
- [ ] `npm audit fix` applied; remaining issues documented with justification
