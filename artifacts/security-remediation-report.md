# Security remediation report

Assistant-run verification on 2026-11-06. This is not a student submission and nothing here was deployed.

The current default branch was `959982a3f550aa658a87ce33179bbc59827e66e9` (2026-10-30), the same commit named in the older assessment. The findings were rechecked against that tree and against a fresh `pnpm audit`. They were not stale.

## Code fixes

- Manager login now rejects the two passwords published in `packages/db/prisma/migrations/20261025170000_manager_login_credentials` and swapped in `20261025200000_swap_manager_login_codes`. A later password that is not one of those values still logs in. `scripts/manager-credentials.mjs` can rotate a password, or clear a verifier that still matches a published password. It reads secrets from the environment and does not print them.
- AES-GCM decryption in `apps/operations-gateway/credential-vault.mjs` and `apps/api/src/push/push-crypto.ts` now requires a 16-byte authentication tag. On Node.js 24.19.0, a 4-byte tag is still accepted unless `authTagLength` is set. A full tag with one flipped bit is rejected. Existing vault files and push payloads use 16-byte tags and still decrypt.
- `scripts/restore-seeds.cjs`, `scripts/setup-spot-auto-healer.sh`, and `deploy/gcp-auto-migrate.sh` no longer fall back to the published database password. `POSTGRES_PASSWORD` has to be supplied for the GCP installer, and host-side restore rewrites only the hostname and port to `127.0.0.1:55432`.
- The worker service in `infrastructure/docker-compose.yml` still receives `DATABASE_URL` from `env_file`, and now overrides session, push, browser-session, and tunnel secrets it does not read. Redis in that file is unchanged, so a running stack does not lose its queue on the next start.
- Compatible dependency patches are in `pnpm-workspace.yaml`, `apps/web/package.json`, and `pnpm-lock.yaml`. Direct app change: Next.js 15.5.21 to 15.5.29. Overrides cover sharp 0.35.5, proxy-addr 2.0.8, undici 7.30.2, axios 1.21.0, adm-zip 0.6.1, multer 2.5.0, body-parser 2.4.0, follow-redirects 1.16.2, qs 6.17.1, brace-expansion 2.1.7, vite 7.3.7, source-map-js 1.2.2, and postcss-selector-parser 6.1.5. `pnpm install` also recorded `undici@7.30.2` under `minimumReleaseAgeExclude`.

## Historical exposure, not rewritten

Applied Prisma migrations were not edited. Their checksums stay valid. A fresh database that replays history still receives the published manager verifiers. Git history still contains them. This change does not rewrite published history, force-push, or rotate a live password.

The published database placeholder may still be the live Postgres password wherever the old installer was used. This branch does not connect to production and does not change that password.

## Owner actions

1. Before starting the new API, set a new manager password for each affected account:
   `DATABASE_URL=... MANAGER_LOGIN_CODE=... MANAGER_NEW_PASSWORD=... node scripts/manager-credentials.mjs rotate`
   The new password must be at least 10 characters and must not be a published bootstrap password or the login code. Do this before the new API is running if those accounts still use the published passwords. After this code is deployed, those passwords stop working. A password that was already changed to something else keeps working.
2. Optional, after rotation: `DATABASE_URL=... node scripts/manager-credentials.mjs revoke-published`. It only clears verifiers that still match a published password.
3. If any environment still uses the published database placeholder, set a new `POSTGRES_PASSWORD` and matching `DATABASE_URL` before restore or `deploy/gcp-auto-migrate.sh`.
4. History cleanup of the old migrations is a separate owner decision. It was not done here.
5. Redis authentication, an internal data network, and `no-new-privileges` are only in `infrastructure/docker-compose.security.yml`. Default compose, `pnpm compose:up`, and the GCP scripts do not load it. Enable it only after setting a URL-safe `REDIS_PASSWORD` and checking a disposable environment. The overlay does not add a read-only root or drop all capabilities on Postgres, Redis, the API, or the worker. Those settings can stop those processes, and the operations gateway already has them in the base file.

## Dependency audit

`pnpm audit` on Node.js 24.19.0 / pnpm 11.19.0.

Before the lockfile update: 75 advisories (6 critical, 30 high, 35 moderate, 4 low) across 617 dependencies. That matches the older count, because this branch had not moved.

After the update: 10 advisories (2 critical, 1 high, 7 moderate, 0 low).

| Package | Installed | Severity left | Why it remains | Reach |
| --- | --- | --- | --- | --- |
| tinypool | 1.1.1 | 2 critical | Fix is 2.1.2+. Vitest 3.2.6 depends on 1.x. | Dev dependency of Vitest. Not imported by the API or worker entrypoints. The image build copies the workspace `node_modules`, so the package is present on disk. |
| vitest, @vitest/mocker | 3.2.6 | 3 moderate | Fix is Vitest 4.1.12+. | Test runner only. |
| zod | 3.25.76 | 1 high | Latest 3.x is still affected. Fix is Zod 4.6.6+. The AI SDK and Firecrawl pin Zod 3. | Transitive. App source does not import Zod. Used when the AI SDK or Firecrawl validates data. |
| stream-json | 1.9.1 | 3 moderate | Fix starts at 3.4.1. Crawlee 3.18.1 depends on 1.9.1. | Worker crawl path, via Crawlee. |
| minimatch | 9.0.9 | 1 moderate | Fix is 11.0.1. Crawlee depends on 9.0.9. brace-expansion under it was patched to 2.1.7. | Worker crawl path, via Crawlee. |

Patched and reachable in production: Next.js image optimization advisories (web app), sharp (optional Next image library), undici (AI SDK HTTP client), express `body-parser` / `qs` / `proxy-addr` (API HTTP stack; `main.ts` does not set `trust proxy`), multer (loaded by Nest's Express adapter; no multipart route was found in app source), axios and follow-redirects (Firecrawl client in the worker; Firecrawl pinned axios 1.18.0 and the override moves it to 1.21.0), adm-zip (Crawlee header-generator), brace-expansion (Crawlee minimatch). Vite, source-map-js, and postcss-selector-parser are dev or build tools and were patched inside the same major.

## Verification

Node.js 24.19.0 and pnpm 11.19.0 unless noted. Docker was not installed, so the compose overlay was not started.

| Command | Result |
| --- | --- |
| `node --test scripts/manager-credentials.test.mjs scripts/security-remediation.test.mjs apps/operations-gateway/test/credential-vault.test.mjs` | exit 0, 9 passed |
| `pnpm --filter @tokusatsu/db generate && pnpm --filter @tokusatsu/shared build && pnpm --filter @tokusatsu/db build` | exit 0 |
| `pnpm --filter @tokusatsu/api typecheck` | exit 0 |
| `pnpm --filter @tokusatsu/api test` | exit 0, 559 passed, 26 skipped (database integration tests) |
| `pnpm --filter @tokusatsu/api build` | exit 0 |
| `pnpm --filter @tokusatsu/web typecheck` | exit 0 |
| `pnpm --filter @tokusatsu/web build` | exit 0, Next.js 15.5.29, compiled and generated 7 pages |
| `pnpm audit` | 10 remaining advisories, listed above |
| `bash -n deploy/gcp-auto-migrate.sh` and `bash -n scripts/setup-spot-auto-healer.sh` | exit 0. The embedded remote installer also passed `bash -n`. |
| Compose YAML load of the base file and the opt-in overlay | passed. Redis in the base file has no `requirepass`. The overlay puts Redis on an internal `data` network. |

A direct Node.js 24.19.0 check, outside the app, still accepted a 4-byte GCM tag and rejected that same tag when `authTagLength` was 16. The vault and push tests cover a successful round trip, a truncated tag, and a tampered tag.

## Pull request

https://github.com/honru09/tokusatsu-monitoring-platform/pull/1

Not merged and not deployed.

## Commits

Branch `cursor/security-remediation-9e17`, based on `959982a3f550aa658a87ce33179bbc59827e66e9`.

- `06c43b0` fix(crypto): require 16-byte AES-GCM authentication tags
- `a5e0728` fix(auth): reject published manager bootstrap passwords
- `1db9546` fix(ops): remove published database fallbacks and keep Redis auth opt-in
- `1eeccef` fix(deps): patch compatible audit findings in the lockfile

## Deployment

No merge and no production deploy. Do not treat this branch as live. Apply the owner steps above with the normal release path when you choose to ship it. The security compose file stays inactive until you add it explicitly.
