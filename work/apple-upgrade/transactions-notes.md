# Apple transaction and detail interaction verification

Verified against the existing development server on port 3105. Source changes frozen on 2026-10-09; no server lifecycle changes, commits, or real mutation requests were made.

## Implemented

- Image gallery: direction-aware image entry after the new image is ready; reversible finite WAAPI animation; optional thumbnails for detail/image dialogs; selected image remains stable across live updates; keyboard arrows and gallery event isolation preserved.
- Detail disclosure/description: native disclosure expansion and reversible description height changes; pointer-only motion; immediate keyboard and reduced-motion interactions.
- Notes: finite entry/exit, focus restoration, submission deduplication, pending/saved/error feedback. Fixed an existing optimistic-update rollback bug that cleared the editor draft and error while the dialog was open.
- Product cards: favorite/cart feedback waits for the original asynchronous request; failure accurately reports rollback. More-menu Escape restores trigger focus, and selected icons use a press spring.
- Detail/image/cart/purchase panels: shared finite presentation helper clears animation transforms. Purchase dialogs have submission deduplication and complete failure feedback. Bundle price-mode changes use a shared-layout indicator.
- Purchase mobile corrections: constrained native receipt file input; decoded API error instead of raw JSON; primary confirmation uses the application blue.

## Verification

### Components and TypeScript

- Latest ImageGallery: 12 / 12 tests passed.
- Latest NoteDialog: 7 / 7 tests passed.
- Existing Dashboard favorites-sync: 19 / 19 tests passed in the preceding run; existing React act warnings remain.
- Total relevant component checks: 38 / 38. The two directly changed component suites were rerun after final corrections: 19 / 19.
- Latest web TypeScript check: passed with exit code 0.

### Browser transactions: 21 / 21 flows

Seven flows passed at each of 1440 × 1000 normal motion, 390 × 844 normal motion, and 320 × 568 reduced motion:

1. Favorite pending, successful confirmation, failed update and rollback.
2. Cart add/remove confirmation.
3. Note failure retaining draft, retry, save and close.
4. Gallery rapid reversal, thumbnails, keyboard arrows, parent-event isolation.
5. Description/disclosure rapid reversal and keyboard activation.
6. More-menu Escape/focus restoration and keyboard activation.
7. Purchase failure retaining amount, retry, completion.

All three initial server route loads and subsequent hydration reported zero page errors and zero hydration errors. Detail panel computed transform returns to `none` after entry. Reduced-motion routes and keyboard paths remain operable. These checks verify browser startup from the server-rendered route; they are not a separate isolated static-render test of every dialog.

Visible purchase controls stay within the viewport in all three sizes (`purchaseControlsOverflow: []`). Document horizontal overflow is also absent. Latest gallery and 320px purchase screenshots were visually inspected.

All writes use isolated browser fixtures. Real write requests: 0. Real model calls: 0. Model/analysis attempts: 0. The initial account and one product were read with GET only.

## Evidence

- `work/apple-upgrade/transactions.cjs`
- `work/apple-upgrade/transactions/report.json`
- `work/apple-upgrade/transactions/gallery-1440-no-preference.png`
- `work/apple-upgrade/transactions/gallery-390-no-preference.png`
- `work/apple-upgrade/transactions/gallery-320-reduce.png`
- `work/apple-upgrade/transactions/detail-{width}-{motion}.png`
- `work/apple-upgrade/transactions/purchase-error-{width}-{motion}.png`

## Scope and remaining limits

- Browser verification uses the development server; final production build and whole-system verification belong to the root run.
- PurchaseBundleEditor link-analysis/bundle persistence was initially outside the transaction suite; the follow-up below now covers that path with fixtures.
- Only NoteDialog adds a controlled exit lifecycle. Other dialogs retain their original immediate unmount on close.
- Gallery supports controls, thumbnails and keyboard navigation; no drag/swipe gesture was added.
- No external purchase, listing publication, model quota use, or live mutation is part of this UI verification.

## Changed source ownership

- `apps/web/src/app/page.tsx` — targeted detail/cart/purchase/ProductCard sections only.
- `apps/web/src/components/image-gallery.tsx`
- `apps/web/src/components/image-gallery.module.css`
- `apps/web/src/components/image-gallery.test.tsx`
- `apps/web/src/components/detail-disclosure.tsx`
- `apps/web/src/components/detail-disclosure.module.css`
- `apps/web/src/components/note-dialog.tsx`
- `apps/web/src/components/note-dialog.test.tsx`
- `apps/web/src/components/transaction-feedback.module.css`
- `apps/web/src/lib/use-transaction-presentation.ts`

## Follow-up: previously unverified bundle path

The browser script now accepts `APPLE_TRANSACTION_URL` and `APPLE_TRANSACTION_OUTPUT`. It uses anonymous product/account fixtures and intercepts all backend requests, including link-analysis POST/GET and bundle persistence. It no longer reads a real product or account to seed verification.

New development-server run: 30 / 30 flows across the same three viewport/motion settings. The added flows verify analysis pending state and completion across workbench navigation, bundle pricing-indicator rapid reversal, immediate keyboard selection, per-item and bundle amount retention, same-frame save deduplication, disabled pending close, failure retaining amount/date/note/selected members, retry success in the purchase-record list, and removal of saved members from the analysis queue.

The added keyboard hold assertion exposed the legacy shared `button:active` scale on native pricing buttons. The root fixed shared CSS to make ordinary keyboard-active controls use `transform:none`, while excluding Motion-owned elements. The assertion now passes. This follow-up changed only the verification script/report; the root owns the shared CSS correction.

Development evidence: `work/deep-apple/transactions-dev/report.json` plus bundle pending/error/success screenshots.

Final production at `http://localhost:3000`: **30 / 30 passed** after the root's final shared contrast/keyboard stylesheet deployment. Evidence: `work/deep-apple/transactions-production/report.json` and 18 screenshots. All three sizes have zero page/hydration errors, zero document/control horizontal overflow, a vertically reachable bundle primary action, zero real backend business requests, zero real writes, and zero model calls. Bundle saves are exactly two per setting (failure plus successful retry); each same-frame double click issues only one request. Analysis GET polls are intercepted and may run multiple times according to the existing poller.

Final production screenshots inspected: 390px gallery, desktop bundle pending, 320px reduced-motion bundle error with the complete primary action visible, and 390px saved purchase record. No new application-source changes were made during this follow-up. No separate static-render assertion for each dialog and no external live mutations are part of this verification.
