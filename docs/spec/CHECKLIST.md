# CloudTrace MVP — Hands-on Acceptance Checklist

Check these items against the **generated app**, not merely against a screenshot.

## First boot
- [ ] `npm install` works, and `.env.example` documents necessary values.
- [ ] `npm run db:push`, `npm run db:seed`, `npm run dev` create a functional site.
- [ ] App works with Anthropic and Microsoft env values empty.
- [ ] Seed can be rerun without duplicating historical cases.

## Cases and investigation
- [ ] Can sign in as seeded owner, analyst and viewer.
- [ ] `CT-2026-001` visibly states provider technical outage, **not hack**.
- [ ] All synthetic items visibly say simulated.
- [ ] Case filters, severity updates, status changes, notes and tasks persist across refresh.
- [ ] Event timeline sorts correctly; linked evidence has a hash and source.
- [ ] Import JSON and CSV with an upload preview and explicit validation errors.
- [ ] Hypothesis confidence and evidence relationships persist.

## Dependency correctness
- [ ] Exchange Online degradation makes downstream services **at risk**, not automatically confirmed down.
- [ ] Simulated CRM errors can establish simulated CRM impact.
- [ ] The independent Azure customer portal stays unknown/healthy when it has no relevant dependency.
- [ ] The graph handles cycles and multiple edges without freezing.

## Reporting, security and integrations
- [ ] Analysis runs with no API key and is labelled rule-based.
- [ ] Reports include evidence citations, simulation disclaimer and UTC timestamps.
- [ ] Generate report v1; change case; generate v2; v1 remains unchanged.
- [ ] Print, JSON and CSV exports actually work.
- [ ] Viewer cannot perform writes.
- [ ] IDs from a second organisation are inaccessible to a first-organisation user.
- [ ] Microsoft integration shows Not Configured absent credentials, no fake live data.
- [ ] Secrets are absent from frontend code, API responses, browser storage and logs.
- [ ] Typecheck, tests, build results are documented truthfully.
