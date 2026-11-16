# Implementation notes

This file records what was built, the engineering decisions taken where the specification left room, how it was verified, and what remains future work. Specifications: `CLAUDE.md` (function, security, data integrity) and `docs/spec/CLOUDTRACE_OBSIDIAN_DESIGN_SPEC.md` (UI).

## Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 15.5 (App Router, maintained 15.x line), React 19.2, TypeScript `strict` |
| Styling | Tailwind CSS 4 + the canonical `cloudtrace-obsidian.css` tokens (imported as a CSS layer so utilities can adjust layout); Inter (variable) and IBM Plex Mono self-hosted via Fontsource (no runtime font fetching) |
| Data | Prisma 6.19 + SQLite (`prisma/dev.db`) |
| Auth | next-auth 4 Credentials provider, bcrypt (cost 12), JWT session (8 h), server-side membership lookup on every request |
| Validation | Zod 3.25 on every mutating input and imported row |
| Graph / charts | `@xyflow/react` 12, Recharts 3 |
| Optional AI | Official `@anthropic-ai/sdk` (`messages.parse` + `zodOutputFormat`), server-only |
| Tests | Vitest 3 (unit + integration), Playwright 1.63 + axe-core (E2E) |

## Architecture

- `src/lib/services/*` — the only data-access layer. Every function takes the server-verified `AuthContext`, checks the role (`requireRole`) and filters every query by `organizationId`. Foreign IDs return **404** (indistinguishable from missing); viewer writes return **403**.
- `src/app/api/**` — thin REST route handlers (all endpoints in CLAUDE.md §7, plus a few supporting ones) wrapped by `withAuth`: session → role → same-origin check for writes → uniform JSON errors `{ error: { code, message, details } }`.
- Server components (pages) call the same services directly; client components mutate through the API and then `router.refresh()`.
- Pure, unit-tested engines: `lib/blast-radius`, `lib/correlation`, `lib/evidence` (normalise / import validation), `lib/analysis/rule-based`, `lib/reports/build` + `csv`.
- `lib/investigation/load.ts` holds org-scoped loaders shared by services and the seed, so the seed's initial analysis/report uses exactly the production code path.

## Decisions taken where the spec left room

- **Enums stored as validated strings** (SQLite), with the canonical lists in `lib/domain/enums.ts`. Easier PostgreSQL migration; still needs a migration review.
- **Evidence references** `EV-0001` are sequential per organisation (`refNumber`), shown everywhere instead of raw CUIDs. Case numbers are `CT-<year>-NNN` per organisation, allocated in a transaction with retry on conflict.
- **Evidence → asset health**: an optional `assetStatus` (`HEALTHY|DEGRADED|DOWN`) on evidence records what that record asserts about its linked asset. Analysts can also record an asset status on the incident (`IncidentAsset.observedStatus`), which **must** cite evidence from the same incident. Both feed the blast-radius engine. Plain import rows without `assetStatus` never change asset health.
- **SHA-256**: computed over a canonical JSON array (schema tag, observedAt ISO UTC, title, category, provenance, sourceName, sourceEventId, assetName, contentText, sourceUri). It proves the stored record is unchanged since ingestion; it is **not** a chain of custody. Imports also store the raw file's SHA-256.
- **De-duplication**: same `(organisation, sourceName, sourceEventId)`, or an identical canonical hash within the same incident, is skipped and reported as a duplicate (never silently dropped). Equal messages with different timestamps/sources are not de-duplicated.
- **Import modes**: `ATOMIC` (default) rejects the whole file if any row is invalid; `PARTIAL` stores valid rows and reports rejected ones. Every attempt (including rejections) creates an `ImportJob` and an audit entry. The wizard previews with `dryRun=true` first.
- **Blast radius — assessment point**: the engine takes an optional `asOf`. The Dependency tab defaults to **Incident impact** (as of the latest failure observation) and can switch to **Latest observations**. This keeps a resolved incident's impact visible (CRM *confirmed affected*) while the latest view shows recovery (CRM *confirmed healthy*, flagged as conflicting with the earlier failure, both records retained). Healthy requires a customer/simulated observation within 24 h of the assessment time; provider restoration notices alone never make an asset healthy. Provider notices mark only the provider's service (*Provider reported*). Traversal is BFS over reverse edges with visited sets; cycles are detected with an iterative Tarjan SCC and shown as a warning.
- **Status workflow**: OPEN → INVESTIGATING → MONITORING → RESOLVED, plus INVESTIGATING → RESOLVED, MONITORING → INVESTIGATING and re-open RESOLVED → INVESTIGATING. Re-opening clears `resolvedAt`.
- **Classification**: analysis can only *suggest* `PROVIDER_TECHNICAL | SECURITY_SUSPECTED | CONFIGURATION | UNDETERMINED`. Setting `CONFIRMED_SECURITY` is a human action that requires a written evidence-review justification, stored in the audit log.
- **Reports** embed copies of every cited evidence record, the latest stored analysis (or a rule-based one computed at generation time), and a content SHA-256. There is no update path, so v1 never changes when v2 is generated. Print uses browser print-to-PDF on a shell-free route (`/reports/[id]/print`). Exports (JSON, timeline CSV, print) are audited.
- **CSV safety**: every cell is quoted; cells starting with `= + - @ TAB CR` are prefixed with `'` (formula-injection protection); download names are sanitised.
- **Claude analysis**: evidence is sent as at most 80 chronological abstracts (600-character excerpts) inside an `<evidence>` block that the system prompt marks as untrusted data. The response is schema-validated; claims citing unknown evidence refs are removed and counted in the limitations. Refusal, truncation, auth/network errors and parse failures fall back to rule-based output with `errorStatus` recorded. The server-side `fallbacks` beta parameter is **not** used, because `CLAUDE_MODEL` is user-configurable and the deterministic engine already provides the fallback.
- **Microsoft Graph connector**: client-credentials token cached in memory until shortly before expiry (never logged or stored); 15 s timeouts; at most 5 pages; one `Retry-After`-bounded retry on 429; only `@odata.nextLink` URLs on graph.microsoft.com are followed. Issues are upserted by provider ID and only updated when `lastModifiedDateTime` is newer. On failure the status becomes `ERROR` and existing data is kept. The connector serves exactly one workspace (`MS_CONNECTOR_ORGANIZATION_SLUG`). Sync is owner-only. Tested with a mocked Graph; **not tested against a real tenant**.
- **Workspace switching**: an httpOnly `ct_org` cookie selects the active organisation and is honoured only if the user is a member. The switcher appears only for users with more than one membership (no seeded user has two).
- **Session expiry**: API 401s send the browser to `/login?…&expired=1`, which keeps a safe same-origin `returnTo`.

## Security controls implemented

Server-side auth and org scoping on every route; bcrypt hashes only; rate limiting (sign-in per email and per IP, analyze, import, sync — in-memory); Zod validation everywhere; 5 MiB / 5,000-row import limits with filename sanitisation; evidence rendered only as plain text (`react/no-danger` lint rule is an error; E2E confirms imported `<script>` stays inert); no server-side URL fetching from evidence (external links open only on user click); same-origin check on state-changing API requests (plus next-auth CSRF for sign-in and `SameSite=Lax` cookies); CSP and security headers; audit metadata redacted (secret keys and configured secret values); secrets read only in server modules (`server-only`) — a scan of the built client bundles found no secret values or variable names; no browser storage use (only a non-secret `ct_last_case` cookie for "resume last case").

## Verification (final run)

| Check | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm run lint` | Pass (0 problems) |
| `npm run test` | **57 passed** (33 unit, 24 integration) |
| `npm run build` | Pass |
| `npm run test:e2e` | **11 passed** (Chromium) |
| `npm run db:seed` twice | Second run creates nothing |

Integration tests cover: cross-organisation reads/writes/references by direct ID (404), viewer 403 on 15 write paths, owner-only operations, last-owner protection, seed idempotency and factual labelling, status workflow + audit actor/timestamp, confirmed-security justification, CSV import + duplicate skipping, atomic rejection with no partial writes, partial mode, fixtures as duplicates, oversized files, event-time ordering, blast radius on seeded data (independent Azure portal unknown, at risk vs confirmed, provider-reported flag, conflict in latest view), Supported-requires-evidence, self-edge rejection and cycle reporting, rule-based analysis without a key, Claude fallback when unreachable, immutable report versions, report-requires-evidence, Microsoft connector not-configured / ready / dedupe / error-preserves-data / wrong-workspace / no secrets in audit.

E2E covers: unauthenticated redirect and API 401; wrong password; viewer read-only UI plus server 403s from the browser; cross-org URL → 404 page; the full CT-2026-001 journey (search → case → timeline order → evidence inspector → dependency list states → hypothesis validation and persistence after reload → rule-based analysis → report v2 with v1 unchanged → JSON/CSV exports → print view); create incident → status change → refresh → filter → audit; import wizard (invalid rows block atomic import, valid import, script content inert); no horizontal overflow at 390 / 768 / 1440 px plus the mobile nav drawer; axe WCAG 2 A/AA scan with no serious or critical violations on 7 key screens (React Flow canvas excluded; the list view is its accessible alternative). Every E2E test also fails on any uncaught page error, including React hydration errors.

`npm run db:reset` was not run end-to-end in the build environment: Prisma blocks `db push --force-reset` when it detects an AI agent unless the user explicitly consents. The script is a thin wrapper with dev-only guards; run it yourself.

## Notable fixes during verification

- **Client navigations that never committed.** On the investigation workspace (a slower server render), changing only the search params (`?tab=…`, `?evidence=…`) sometimes fetched the RSC payload but never committed the navigation. Removing the route-group `(app)/loading.tsx` Suspense boundary fixed it (12/12 navigations after, versus mostly failing before). Loading feedback now comes from transition state (tabs show “Loading …”), buttons' own busy states, and the error boundary. Link auto-prefetch is also disabled app-wide (`prefetch={false}`), since every page is dynamic and authenticated.
- An absolutely-positioned screen-reader `<caption>` escaped table scroll containers and caused horizontal page overflow at 768 px. Table wrappers are now the containing block.
- The blast-radius engine was quadratic on long chains (2,000-node cycle took 2.9 s); it now uses name maps, parent pointers and index-based queues.

## Known limitations and future work

- **Production readiness**: SQLite, in-memory rate limits and env-var secrets are for local or portfolio use. A real deployment needs PostgreSQL (with migrations), a shared rate-limit store, managed secrets, account onboarding/recovery and MFA, backup/retention policies, nonce-based CSP (currently `script-src 'self' 'unsafe-inline'` because of Next.js inline bootstrap scripts), and a security review.
- **Loading skeletons**: no route-level skeleton (see above). Server-rendered pages appear when ready; client actions show explicit busy states.
- **Graph editing**: dependencies are added through a form with a direction preview, not by drawing on the canvas (deliberate, per spec). Large graphs use a simple layered layout.
- **Evidence search** uses SQL `LIKE` (case-insensitive for ASCII in SQLite). Full-text search is future work.
- **Organisation switcher** is implemented but only appears for multi-workspace users; seed data keeps organisations disjoint to keep isolation tests clean.
- **Integrations not implemented** (shown as “Planned · not connected”): Microsoft Sentinel, Entra sign-in logs, Azure Monitor, AWS CloudWatch/CloudTrail.
- **Claude analysis was not exercised against the live API** (no key in the build environment). The fallback path is covered by tests.
- **Visual regression** screenshots are in `docs/screenshots/`; there is no automated pixel-diff suite.
