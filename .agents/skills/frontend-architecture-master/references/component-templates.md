# Component Templates Reference

## Hero Section

```tsx
// organisms/Hero/Hero.tsx
'use client'
import { motion } from 'framer-motion'
import { fadeUp, staggerContainer } from '@/lib/motion'

interface HeroProps {
  headline: string
  subheading: string
  ctaLabel: string
  ctaHref: string
  imageSrc?: string
}

export function Hero({ headline, subheading, ctaLabel, ctaHref, imageSrc }: HeroProps) {
  return (
    <section className="relative isolate min-h-[90vh] flex items-center px-6 py-24">
      <motion.div
        className="mx-auto max-w-4xl text-center"
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
      >
        <motion.h1 variants={fadeUp}
          className="text-5xl md:text-7xl font-bold tracking-tight text-balance"
        >
          {headline}
        </motion.h1>
        <motion.p variants={fadeUp}
          className="mt-6 text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto"
        >
          {subheading}
        </motion.p>
        <motion.div variants={fadeUp} className="mt-10 flex gap-4 justify-center">
          <a href={ctaHref}
             className="inline-flex items-center gap-2 rounded-full bg-primary px-8 py-3
                        text-primary-foreground font-semibold hover:bg-primary/90
                        transition-colors focus-visible:outline focus-visible:outline-2
                        focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {ctaLabel}
          </a>
        </motion.div>
      </motion.div>
    </section>
  )
}
```

---

## Navigation

```tsx
// organisms/Nav/Nav.tsx
'use client'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useUIStore } from '@/store/ui.store'

export function Nav() {
  const { isNavOpen, setNavOpen } = useUIStore()

  return (
    <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-border">
      <nav className="mx-auto max-w-7xl px-6 h-16 flex items-center justify-between">
        <a href="/" className="font-bold text-xl">Logo</a>

        {/* Desktop */}
        <ul className="hidden md:flex gap-8 text-sm font-medium">
          {NAV_LINKS.map(({ href, label }) => (
            <li key={href}>
              <a href={href} className="text-muted-foreground hover:text-foreground transition-colors">
                {label}
              </a>
            </li>
          ))}
        </ul>

        {/* Mobile toggle */}
        <button
          aria-label={isNavOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={isNavOpen}
          className="md:hidden p-2 rounded-md"
          onClick={() => setNavOpen(!isNavOpen)}
        >
          {/* Hamburger icon */}
        </button>
      </nav>

      {/* Mobile menu */}
      <AnimatePresence>
        {isNavOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="md:hidden border-t border-border overflow-hidden"
          >
            <ul className="px-6 py-4 flex flex-col gap-4">
              {NAV_LINKS.map(({ href, label }) => (
                <li key={href}>
                  <a href={href} onClick={() => setNavOpen(false)}>{label}</a>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  )
}
```

---

## Card Grid

```tsx
// organisms/CardGrid/CardGrid.tsx
'use client'
import { motion } from 'framer-motion'
import { staggerContainer, scaleIn } from '@/lib/motion'

interface CardData { id: string; title: string; description: string; tag: string }

export function CardGrid({ cards }: { cards: CardData[] }) {
  return (
    <motion.ul
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"
      variants={staggerContainer}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '-80px' }}
    >
      {cards.map((card) => (
        <motion.li key={card.id} variants={scaleIn}>
          <article className="h-full rounded-2xl border border-border bg-card p-6
                              flex flex-col gap-3 hover:shadow-lg transition-shadow">
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">
              {card.tag}
            </span>
            <h3 className="text-lg font-semibold">{card.title}</h3>
            <p className="text-sm text-muted-foreground flex-1">{card.description}</p>
          </article>
        </motion.li>
      ))}
    </motion.ul>
  )
}
```

---

## Modal / Dialog

```tsx
// molecules/Modal/Modal.tsx
'use client'
import { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { createPortal } from 'react-dom'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}

export function Modal({ isOpen, onClose, title, children }: ModalProps) {
  const closeRef = useRef<HTMLButtonElement>(null)

  // Focus trap + restore on close
  useEffect(() => {
    if (isOpen) {
      closeRef.current?.focus()
      document.body.style.overflow = 'hidden'
    }
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="fixed inset-0 bg-black/60 z-40"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog" aria-modal="true" aria-labelledby="modal-title"
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.94 }}
            transition={{ duration: 0.2 }}
          >
            <div className="bg-background rounded-2xl shadow-2xl max-w-lg w-full p-8">
              <div className="flex justify-between items-start mb-6">
                <h2 id="modal-title" className="text-xl font-semibold">{title}</h2>
                <button ref={closeRef} onClick={onClose} aria-label="Close modal"
                        className="p-1 rounded-md hover:bg-muted">✕</button>
              </div>
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  )
}
```

---

## Form (React Hook Form + Zod)

```tsx
// molecules/ContactForm/ContactForm.tsx
'use client'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

const schema = z.object({
  name:    z.string().min(2, 'Name must be at least 2 characters').max(80),
  email:   z.string().email('Please enter a valid email'),
  message: z.string().min(10, 'Message too short').max(2000),
})
type FormData = z.infer<typeof schema>

export function ContactForm() {
  const { register, handleSubmit, formState: { errors, isSubmitting }, reset } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const onSubmit = async (data: FormData) => {
    await fetch('/api/contact', { method: 'POST', body: JSON.stringify(data) })
    reset()
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1">
        <label htmlFor="name" className="text-sm font-medium">Name</label>
        <input id="name" {...register('name')}
               className="rounded-lg border border-input px-4 py-2.5 text-sm
                          focus:outline-none focus:ring-2 focus:ring-primary"
               aria-describedby={errors.name ? 'name-error' : undefined}
               aria-invalid={!!errors.name} />
        {errors.name && (
          <p id="name-error" role="alert" className="text-xs text-destructive">
            {errors.name.message}
          </p>
        )}
      </div>
      {/* Repeat pattern for email, message */}
      <button type="submit" disabled={isSubmitting}
              className="rounded-full bg-primary text-primary-foreground px-8 py-3
                         font-semibold disabled:opacity-50 transition-opacity">
        {isSubmitting ? 'Sending…' : 'Send message'}
      </button>
    </form>
  )
}
```
