# CloudTrace Obsidian — UI acceptance checklist

Use this *after implementation*. A correct screenshot alone is not a pass.

## Visual identity
- [ ] `#0A0F16` app canvas, `#0D131C` sidebar, `#121A25` panels, `#263140` borders.
- [ ] Inter body/headings, IBM Plex Mono for evidence IDs, hashes, timestamps and IP addresses.
- [ ] Professionally restrained 4–8px corners and no glow/glass/marketing hero.
- [ ] Core body 13–14px (not 9–10px); all statuses readable and meaningfully labelled.
- [ ] Primary action always obvious; no competing giant call-to-action buttons.

## Navigation and screens
- [ ] Login; Command overview; Incidents; Investigation lab; Asset graph; Evidence vault; Reports; Integrations; Activity & audit; Settings.
- [ ] Investigation tabs: Overview, Timeline, Evidence, Dependency impact, Hypotheses, Response tasks, Report.
- [ ] Breadcrumbs, sidebar links and deep links navigate with back/forward history.
- [ ] Loading, empty, filtered-empty, error, forbidden and success states all designed.

## Forensic truthfulness
- [ ] `CT-2026-001` historical Microsoft outage described as technical/provider disruption, not a confirmed hack.
- [ ] Public report and synthetic customer observations are distinguishable in every relevant view and export.
- [ ] At-risk dependency and confirmed affected asset never share misleading status labels.
- [ ] Provider-reported root causes are not portrayed as independently verified.
- [ ] Claude AI labels only display if optional API actually used; fallback says `Rule-based analysis`.

## Real interactions
- [ ] Filters/search/sort work with authorised persisted records.
- [ ] Create incident, hypotheses and tasks work and survive refresh.
- [ ] Evidence import preview, validation, results and inspector work.
- [ ] Graph pan/zoom/node inspection and list fallback work; cycles don't freeze the app.
- [ ] Generate report / version history / print / JSON / CSV export work as labelled.
- [ ] Integrations show honest NOT CONFIGURED/READY/SYNC/ERROR states; no fake Connect button.
- [ ] Viewer cannot mutate server-side data.

## Responsive and accessibility
- [ ] 320×740, 390×844, 768×1024, 1024×768, 1440×900, 1920×1080 checked.
- [ ] No horizontal body overflow (table overflow deliberately scoped to table container).
- [ ] Touch nav drawer and mobile tabs/graph fallback work.
- [ ] 200% browser zoom, keyboard-only, focus return, labelled dialogs and form errors pass.
- [ ] Contrast of text, controls and status badges checked; text labels accompany colours.
- [ ] Reduced motion works; chart data have text equivalents.

## Delivery evidence
- [ ] Screenshot capture for overview, incident details, evidence inspector, graph, report, integrations and mobile.
- [ ] Tests and build output recorded truthfully; fail notes and remaining issues documented.
- [ ] No decorative controls that cannot perform advertised actions.
