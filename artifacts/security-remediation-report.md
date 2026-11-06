# Security remediation report

Assistant-run verification on 2026-11-06. This is not a student submission. Nothing in this branch was merged or deployed, and no live password was rotated.

Pull request: https://github.com/honru09/tokusatsu-monitoring-platform/pull/1

The starting default branch was `959982a3f550aa658a87ce33179bbc59827e66e9` (2026-10-30), the same commit named in the older assessment. Those findings were rechecked. They were not stale.

## Residual audit

`pnpm audit` on Node.js 24.19.0 and pnpm 11.19.0.

| Pass | Advisories | Critical | High | Moderate | Low |
| --- | ---: | ---: | ---: | ---: | ---: |
| Before any lockfile change | 75 | 6 | 30 | 35 | 4 |
| After same-major patches | 10 | 2 | 1 | 7 | 0 |
| After the coordinated upgrades on this branch | 1 | 0 | 0 | 1 | 0 |

The one remaining advisory is moderate GHSA-style `minimatch` 9.0.9, patched only in `>=11.0.1`. Newest `@crawlee/core` and `@crawlee/cheerio` are 3.18.2, and both declare `minimatch: ^9.0.0`. Newest 9.x is 9.0.9, which the advisory still covers. Crawlee calls `minimatch(url, glob, { nocase: true })` and `new Minimatch(glob, { nocase: true })` from CommonJS. Forcing 11 would sit outside that declared range. A 9-pattern sample matched between 9.0.9 and 11.0.5, which is not enough to claim the glob semantics stay the same for every enqueue and sitemap filter. No override was added.

Reach: `workers/crawlers` does not call `enqueueLinks` or pass a sitemap glob. The package is still installed because `@crawlee/core` always depends on it. The advisory is CPU exhaustion on a malicious glob, not remote code execution. There is no patched release inside `^9.0.0`, so there is no bounded version pin that clears it without leaving Crawlee's contract.

## What the code now does

- Login rejects the two passwords published in `20261025170000_manager_login_credentials` and swapped in `20261025200000_swap_manager_login_codes`. A password that is not one of those values still logs in, including on an account whose login code is still one of the published codes. `scripts/manager-credentials.mjs revoke-published` clears a verifier only when it still matches a published password.
- Those two migration files are unchanged. Their SHA-256 checksums, which are the checksums Prisma stores, are `41b2ed6267683b959ca5afa3ca5746200f964e436bc404be2c06e550a71bd5b6` and `1ef742757cc0b2a3a08ff0801ee474653eea63fece25080edc7f1e65a49947a2`. `git diff` against `959982a3f550aa658a87ce33179bbc59827e66e9` for those files is empty.
- AES-GCM decryption in the credential vault and the push payload path requires a 16-byte tag. Node.js 24.19.0 still accepts a 4-byte tag unless `authTagLength` is set. A full tag with one flipped bit is rejected.
- Restore and deploy scripts require a private `DATABASE_URL`. `scripts/restore-on-host.cjs` rewrites only the hostname and port to `127.0.0.1:55432` and redacts postgres URLs in its output. A synthetic URL whose password is not a real credential was pointed at port 1; that password did not appear in the output.
- The worker still receives `DATABASE_URL` and no longer receives session, push, browser-session, or tunnel secrets it does not read.
- Direct upgrades, not out-of-range overrides: Vitest 4.1.12 (tinypool 1.x is gone from the lockfile), NestJS 12.3.3 (declares multer 2.5.0; the multer override was removed), `ai` 7.0.163 and `@ai-sdk/openai-compatible` 3.0.85, Firecrawl 4.52.0 with its declared axios 1.20.0, Crawlee 3.18.2 with its declared `stream-json` ~3.7.0, and Zod 4.6.7. Firecrawl's own dependency is `zod: ^3.25.28 || ^4.6.6`; `firecrawl>zod` is set to 4.6.7 so the resolver takes the patched side of that range. The axios override that had forced 1.21.0 over Firecrawl's pin was removed. Audit no longer reports axios.
- Overrides that remain are inside a range the parent already declares: sharp 0.35.5 on Next's `^0.34.3 || ^0.35.5`, proxy-addr 2.0.8, body-parser 2.4.0, qs 6.17.1, undici 7.30.2, follow-redirects 1.16.2, adm-zip 0.6.1, source-map-js 1.2.2, postcss-selector-parser 6.1.5, brace-expansion 2.1.7, and Vite 7.3.7. Vitest 4 allows Vite 6, 7, or 8; 7.3.7 is the patched 7.3 release already covered by the web build.

## Tested controls and designed controls

Tested in this environment:

- Login rejection of the published passwords, and login success for a rotated password, in `apps/api/src/auth/auth.service.test.ts` (part of the API suite below).
- Migration file checksums and a clean diff against the base commit.
- Synthetic host restore and URL redaction. No production database was contacted.
- Vault and push round trip, truncated tag, and tampered tag.
- Compose v2.40.3 rendered the base file plus `infrastructure/docker-compose.security.yml` with a temporary synthetic env file that was deleted afterward. Rendered result: Redis has `requirepass`, no published ports, `no-new-privileges`, and only the `data` network; `data` is `internal: true`; API and worker are on `app` and `data`; web and gateway are on `app`; Postgres is on `data` and still publishes its host port.
- Rootless Podman 4.9.3 (`rootless=true`) pulled `redis:7.4-alpine` and ran it with `--requirepass`, `--security-opt=no-new-privileges`, and no published port on an internal network. Authenticated `PING` returned `PONG`. Unauthenticated `PING` returned `NOAUTH Authentication required.` A second container on that network authenticated and got `PONG`. A container on a different network failed with `Name does not resolve` (exit 1).
- Disposable Postgres 17, rootless Podman, published only on `127.0.0.1:55433`, database name `resale_test`, synthetic password. `prisma migrate deploy` applied all 70 migrations, including the unchanged manager-credential migrations. The 26 integration tests then passed when each file ran alone. The Zhipu file stubs `global fetch` in every case and does not call the real provider. All 5 of those tests passed.
- Official Compose v2.40.3, pointed at a rootless Podman socket (`podman system service`), started only `postgres` and `redis` from the base file plus the security overlay, with a temporary synthetic env file that was deleted. Postgres answered `pg_isready`. Redis had no host port. `podman network inspect` reported `tokusatsu-monitor_data` `internal: true`. Unsetting `REDISCLI_AUTH` made `PING` return `NOAUTH Authentication required.`; with that variable set, `PING` returned `PONG`. Containers and volumes were removed with `compose down -v`.

Designed, not started:

- API, worker, and web images were not built or started. That would compile the application inside image builds and is outside this close-out. podman-compose 1.0.6 still cannot parse `!override`. `fuse-overlayfs` remained unconfigured after apt; rootless Podman used the overlay driver it already had. The default compose file and the GCP scripts still do not load the overlay, so this check does not change production.

## Verification commands

Node.js 24.19.0 and pnpm 11.19.0.

| Command | Result |
| --- | --- |
| `node --test scripts/manager-credentials.test.mjs scripts/security-remediation.test.mjs apps/operations-gateway/test/credential-vault.test.mjs` | exit 0, 11 passed, 0 skipped |
| `pnpm --filter @tokusatsu/api typecheck` | exit 0 |
| `pnpm --filter @tokusatsu/api test` | exit 0, 51 files passed, 3 skipped; 559 tests passed, 26 skipped |
| `pnpm --filter @tokusatsu/api build` | exit 0 |
| `pnpm --filter @tokusatsu/shared build && pnpm --filter @tokusatsu/db build && pnpm --filter @tokusatsu/product-dictionary build && pnpm --filter @tokusatsu/matching build && pnpm --filter @tokusatsu/classification build && pnpm --filter @tokusatsu/product-intelligence build` | exit 0 |
| `pnpm --filter @tokusatsu/crawlers typecheck` | exit 0 |
| `pnpm --filter @tokusatsu/crawlers test` | exit 0, 39 files, 465 passed, 0 skipped |
| `pnpm --filter @tokusatsu/shared test` | exit 0, 8 files, 80 passed |
| `pnpm --filter @tokusatsu/product-dictionary test` | exit 0, 1 file, 5 passed |
| `pnpm --filter @tokusatsu/matching test` | exit 0, 1 file, 4 passed |
| `pnpm --filter @tokusatsu/classification test` | exit 0, 1 file, 7 passed |
| `pnpm --filter @tokusatsu/product-intelligence test` | exit 0, 1 file, 5 passed |
| `pnpm --filter @tokusatsu/web typecheck` | exit 0 |
| `pnpm --filter @tokusatsu/web test` | exit 0, 77 files, 468 passed, 0 skipped |
| `pnpm --filter @tokusatsu/web build` | exit 0, Next.js 15.5.29, compiled and generated 7 pages |
| `pnpm --filter @tokusatsu/crawlers build` | exit 0, `tsc -p tsconfig.json` |
| `pnpm audit` | 1 advisory: moderate minimatch 9.0.9. Critical 0, high 0, low 0 |
| `pnpm --filter @tokusatsu/db exec prisma migrate deploy` against disposable `resale_test` | exit 0, 70 migrations applied |
| `pnpm exec vitest run src/ai/zhipu.integration.test.ts --fileParallelism=false` | exit 0, 5 passed. Fetch is stubbed; no provider call |
| `pnpm exec vitest run src/resale/resale.integration.test.ts --fileParallelism=false` | exit 0, 9 passed |
| `pnpm exec vitest run src/resale/resale-operations.integration.test.ts --fileParallelism=false` | exit 0, 12 passed |

`pnpm --filter @tokusatsu/api test` without `RESALE_TEST_DATABASE_URL` still skips those 26 tests (3 files). With the variable set, one Vitest invocation runs the resale files at the same time and they fail on foreign keys because they share one database (16 failed, 10 passed in that combined run). Run the three files separately, or with `--fileParallelism=false`. No paid provider was contacted. The disposable Postgres container was removed after the run.

## Owner-only steps

These are operational. This run did not do them.

1. Before starting the new API, set a new password for any manager account that still uses a published bootstrap password: `DATABASE_URL=... MANAGER_LOGIN_CODE=... MANAGER_NEW_PASSWORD=... node scripts/manager-credentials.mjs rotate`. The new password must be at least 10 characters and must not be a published bootstrap password or the login code. Accounts that already use some other password keep working.
2. Optional after that: `DATABASE_URL=... node scripts/manager-credentials.mjs revoke-published`.
3. If a database still uses the published placeholder password, set a new `POSTGRES_PASSWORD` and `DATABASE_URL` before restore or `deploy/gcp-auto-migrate.sh`.
4. Git history still contains the old migration verifiers. Rewriting it was not done.
5. Enable `infrastructure/docker-compose.security.yml` only when you want Redis authentication and the internal data network, after setting a URL-safe `REDIS_PASSWORD` and checking a disposable environment with Compose v2. Do not expect podman-compose 1.0.6 to parse it. The default deploy path does not load the file.

## Commits

Branch `cursor/security-remediation-9e17`.

- https://github.com/honru09/tokusatsu-monitoring-platform/commit/06c43b061ece294dbfaad75e8420f18c517acf4b fix(crypto): require 16-byte AES-GCM authentication tags
- https://github.com/honru09/tokusatsu-monitoring-platform/commit/a5e072845f639fab9868916bbd50694237fbccef fix(auth): reject published manager bootstrap passwords
- https://github.com/honru09/tokusatsu-monitoring-platform/commit/1db9546c549204cc108da3e4a9e514e68b8afd8b fix(ops): remove published database fallbacks and keep Redis auth opt-in
- https://github.com/honru09/tokusatsu-monitoring-platform/commit/1eeccef6d1ddfccb7070210999d330a74d0fe521 fix(deps): patch compatible audit findings in the lockfile
- https://github.com/honru09/tokusatsu-monitoring-platform/commit/4b32f75633d744139f3f05286a5313343aab1976 docs: record the security remediation verification
- https://github.com/honru09/tokusatsu-monitoring-platform/commit/a4e9ffc6c5925dca8e90f4e44e9ff139c55bc68a docs: link the remediation report to the pull request
- https://github.com/honru09/tokusatsu-monitoring-platform/commit/6700d1c907d3e4edf15fa3c44982af2e843b5113 fix(deps): move Vitest, Nest, Zod, and Crawlee onto patched releases
- https://github.com/honru09/tokusatsu-monitoring-platform/commit/f735044af03ad53752ca92d4c757a3a2423736a9 test(ops): check migration checksums and synthetic restore
- https://github.com/honru09/tokusatsu-monitoring-platform/commit/a03a2934ceb77f2aeb6d703f3e4f4d3e9f4f570b docs: record the final audit, tests, and runtime checks
- https://github.com/honru09/tokusatsu-monitoring-platform/commit/85c3da0ed40b080c17772ab99ef1c8a3c091fce4 docs: add the final report commit URL
- https://github.com/honru09/tokusatsu-monitoring-platform/commit/2b004f462ee8287d88aebec67356762b329405a0 docs: list the report-link commit
