# CLOUDTRACE — OBSIDIAN DESIGN SYSTEM & COMPLETE INTERFACE SPECIFICATION

**Design version:** 1.0 — APPROVED DIRECTION  
**Issued:** 16 November 2026  
**Product:** CloudTrace — Cloud Incident Intelligence & Forensics  
**Audience:** Claude Code, UI engineers, frontend engineers, QA testers, product designers  
**Purpose:** Build the exact approved **Obsidian** visual direction as a fully interactive, credible, professional, enterprise-grade security operations web application. This is an implementation instruction, **not** a mood board or a request to create only screenshots.

> **Mandatory compatibility note:** This document accompanies `CLAUDE.md` / `CLOUDTRACE_MVP_FOR_CLAUDE.md` in the initial CloudTrace MVP package. The original MVP specification remains the source of truth for features, backend, persistence, evidence integrity, authorisation, API behaviour and security. **This document is authoritative for all visual design, copy, typography, layout, navigation, UI states, component behaviour and responsive rules, superseding section 4 (visual design) of the original MVP.** If requirements conflict, honour the original security/data-integrity requirement and use this document for its UI expression. No functionality is removed from the original MVP merely because it does not appear in the original four-screen design preview.

---

## 00 — THE BUILD CONTRACT: READ FIRST

Claude Code must implement a real product UI, not an AI-themed landing page, a Dribbble concept, a static screenshot, or an interactive prototype disconnected from persisted data. The prior preview was approved as the **art direction** (dark graphite, cool steel-blue, compact typography, quiet rectangular panels, precise operations interface). It was not approval to make tiny 10px body text, omit screens, hardcode fake production figures, or replace working screens with decorative charts.

### Required results

1. Every page in the sitemap below exists and is navigable by URL, keyboard, mouse and mobile touch.
2. All visible actions do something genuine: navigate, mutate authorised persistent data, validate input, open/close real inspectors, import, filter, export or clearly state why a feature is unavailable. No decorative fake buttons.
3. The layout uses the approved colour and typography tokens, with shared reusable components. No per-screen arbitrary styles.
4. There are two clearly distinct data modes: **Public historical report** and **Synthetic demo telemetry**. Live tenant data is shown only when genuinely connected and authorised. Every claim about Microsoft outage causes must have a source/provenance indication.
5. A customer workflow that is merely downstream of an unhealthy service must say **At risk**, not **Confirmed degraded**, unless the customer's own observations support confirmed degradation.
6. Desktop 1440px, laptop 1024px, tablet 768px, mobile 390px and narrow mobile 320px must all be usable without horizontal page overflow. Large tables may use explicit horizontal scroll containers.
7. All pages include useful states: populated, empty, loading, error, permission-denied, disconnected/unconfigured (where relevant), and success feedback.
8. Meet WCAG 2.2 AA expectations wherever feasible: accessible contrast, keyboard support, focus visibility, semantics, labels and reduced motion.
9. Do not invent a live connection, a data refresh, a successful export or a completed mutation. Show progress or errors accurately.
10. Build design-token CSS / Tailwind integration, reusable layout and component primitives first; then connect real data, then visual-regression and accessibility checks.

### Explicit aesthetic exclusions

- **No** gradient background hero, huge glow/blobs, glassmorphism, aurora effects, giant rounded neon cards, dark-purple AI aesthetic, stock photos, 3D shields, canvas particles or animated background meshes.
- **No** default SaaS template dashboard with four enormous KPI cards, random emoji labels, icons in coloured circles everywhere, giant section whitespace, squishy pills or oversized heading hierarchy.
- **No** inconsistent typography, light grey tiny text used for essential content, unaligned metric numbers, random shadows, giant toasts, overlapping tooltips, fake charts or inaccessible monochrome status dots.
- **No** inventing activity, health data, ROI, attack counts, Microsoft tenant access, root causes, exact live times or successful security actions.
- **No** AI-generated 'insight' formatted as a verified conclusion. Use evidence-linked language.

**Design acceptance phrase:** “Looks like a real investigation desk an SOC analyst can use for an entire shift.”

---

## 01 — BRAND & PRODUCT VOICE

**Brand:** CloudTrace  
**Product sub-label:** Security operations  
**Interface theme:** Obsidian (dark-only for MVP)  
**Brand personality:** rigorous, quiet, technical, auditable, dependable, analytically precise  
**Tagline for documentation / optional login support copy:** Understand the failure. Trace the evidence. Protect the business.

### Brand construction

- Logo at top-left: custom simple `CT` monogram in a 28×28px box with 1px mid-blue border, corner radius 5px. `CT` letters are compact, roughly 11px / 750, with no gradient or unnecessary symbol effects. Wordmark `CloudTrace` in Inter 15px / 700 with −0.3px tracking.
- Wordmark is always paired with an accessible name text label; the logo is not a button unless it takes the user to Command Overview.
- Navigation section labels: `OPERATIONS`, `INVESTIGATION`, `ADMINISTRATION` or equivalent compact uppercase semibold labels; group logically instead of running nine items into a long indistinguishable sidebar.
- No hero illustrations in the authenticated product. The platform's visual identity comes from information architecture, evidence, maps and operational controls.

### Writing rules

- Tone: concise, clinically neutral and informative. Never sensationalise security events or imply certainty beyond the evidence.
- Prefer: “Provider-reported outage”, “Suspected cause”, “Insufficient evidence”, “Potentially affected”, “Recorded at 16:20 UTC”, “Rule-based analysis”.
- Avoid: “AI has cracked the mystery”, “We stopped the hack”, “100% protected”, “Live global threat intelligence” when not implemented.
- Use sentence case for navigation/page headings/actions (e.g., `Evidence library`, `Generate report`) and uppercase only for small section labels and technical enum chips.
- Metric descriptions should state the denominator/time window/source when ambiguity exists. E.g., `Open incidents` rather than `Threats neutralised`.
- Prefer `Open investigation` over ambiguous `View`; prefer `Export JSON` over `Download` when format is important.
- Times are in **UTC by default** (`12 Nov 2026 · 16:20 UTC`, data tables `2026-11-12 16:20 UTC`). Always visible time zone label. Do not quietly localise forensic timelines.
- IDs, hashes, IP addresses, case numbers and timestamps use a monospace typeface.
- Limit dramatic severity vocabulary: SEV 1 Critical, SEV 2 High, SEV 3 Medium, SEV 4 Low. A severity is not proof of an attack.

---

## 02 — OFFICIAL DESIGN TOKENS

These are the canonical MVP colours. **Do not substitute the blue/purple gradient or border-radius values from the older MVP visual-design section.** These tokens intentionally match the approved Obsidian preview, with text contrast adjustments for real production usability.

### 02.1 Base palette

| Token | Value | Usage |
|---|---|---|
| `--ct-base` | `#0A0F16` | Application canvas / workspace background |
| `--ct-sidebar` | `#0D131C` | Fixed navigation rail |
| `--ct-topbar` | `#0E141D` | Header background |
| `--ct-surface` | `#121A25` | Cards, tables, inspectors, graph overlays |
| `--ct-surface-raised` | `#151F2B` | Table headers, hover surfaces, secondary boxes |
| `--ct-hover` | `#192331` | Hovered rows, controls and navigation |
| `--ct-selected` | `#1A293A` | Active item or selected row |
| `--ct-border` | `#263140` | Standard 1px borders and separators |
| `--ct-border-strong` | `#39485A` | Focused controls, active contextual borders |
| `--ct-text` | `#E8EDF5` | Primary text |
| `--ct-text-strong` | `#F0F4FA` | Page headings and important totals |
| `--ct-text-secondary` | `#99A8B9` | Secondary descriptions, table metadata |
| `--ct-text-tertiary` | `#8495AA` | Non-primary supporting metadata; never use for essential instructions without contrast check |
| `--ct-text-disabled` | `#69788B` | Disabled-only content / clearly nonessential decorative metadata |
| `--ct-blue` | `#79ABF0` | Selected borders, links, focus and technical accents |
| `--ct-blue-button` | `#28649F` | Filled primary action |
| `--ct-blue-button-hover` | `#3776B3` | Filled primary hover |
| `--ct-blue-tint` | `#1B2C40` | Info badge backgrounds |
| `--ct-amber` | `#E4AD68` | Warning, at-risk, degraded |
| `--ct-amber-tint` | `#34291E` | Amber state background |
| `--ct-red` | `#E17E7E` | Confirmed errors/critical incidents; never ambient decoration |
| `--ct-red-tint` | `#351E23` | Red state background |
| `--ct-green` | `#91BAA4` | Verified healthy / resolved / confirmed successful |
| `--ct-green-tint` | `#1B302A` | Healthy state background |
| `--ct-focus-ring` | `#9EC5FF` | Keyboard focus outline, min 2px |
| `--ct-overlay` | `rgba(2,7,13,.76)` | Modal and drawer backdrop |
| `--ct-chart-grid` | `#253141` | Chart gridlines |
| `--ct-chart-blue` | `#527CAB` | Neutral telemetry bars |
| `--ct-chart-amber` | `#D49B5E` | Warning event counts |

Text values must pass contrast checks against their *actual applied* surface. If a small label fails, use `--ct-text-secondary` or `--ct-text` rather than reducing opacity further.

### 02.2 Semantic mapping — severity and certainty are different concepts

**Severity badges**

| Severity | Label | Treatment |
|---|---|---|
| Critical | `SEV 1 · Critical` | Red text/tint + bordered chip; not a flashing animation |
| High | `SEV 2 · High` | Amber text/tint + bordered chip |
| Medium | `SEV 3 · Medium` | Blue/neutral or subtle amber according to risk context; keep consistent |
| Low | `SEV 4 · Low` | Neutral blue/grey bordered chip |

**Operational asset status**

| Classification | Display | Treatment |
|---|---|---|
| `CONFIRMED_AFFECTED` | `Confirmed affected` | Red tint, evidence reference required |
| `POTENTIALLY_AFFECTED` | `At risk` | Amber tint, dependency path required |
| `CONFIRMED_HEALTHY` | `Confirmed healthy` | Green tint, fresh positive observation required |
| `UNKNOWN` | `Unknown` | Neutral tint, no inferred health |
| provider-reported only | `Provider reported` | Blue info tint + source reference; do not imply customer observation |

**Case workflow status** is independent of severity and asset health: `Open`, `Investigating`, `Monitoring`, `Resolved`. Use neutral/blue for Open/Investigating, amber for Monitoring if useful, green for Resolved only when the analyst has actually marked the incident resolved. The demo historical Microsoft case is `Resolved`; the fictional authentication case is `Investigating`.

**Provenance badges** must be explicit and text-readable:

- `PUBLIC REPORT` — blue, links to an external source.
- `SIMULATED` — neutral/amber, optionally shows “Demonstration data.”
- `CUSTOMER OBSERVED` — blue/green border but never treated as verified if its own validation is missing.
- `ANALYST NOTE` — neutral.
- `AI ANALYSIS` or `RULE-BASED` — neutral info badge, not a source of evidence itself.

### 02.3 Borders, elevations and shape

- Default panels: 1px `--ct-border`, radius **6px**, no pronounced shadow.
- Large drawers/modals: radius **8px**, border 1px, minimal shadow only to separate overlays.
- Buttons/fields: radius **5px**, border 1px.
- Small tags: radius **4px**. Do not use fully round pill badges everywhere.
- Avoid gradients unless a minuscule nonessential gradient materially improves chart legibility; flat fills are the standard.
- Elevation levels: base, bordered surface, modal/drawer; do **not** invent five additional glossy elevation schemes.

---

## 03 — TYPOGRAPHY SYSTEM

### Font families

- **Primary:** `Inter`, preferably a variable font; fallback `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `Arial`, sans-serif.
- **Technical:** `IBM Plex Mono`; fallback `SFMono-Regular`, `Consolas`, `Liberation Mono`, monospace.
- **Do not use** Poppins, Montserrat, Space Grotesk, Orbitron, display fonts or fashion-magazine serif typography within the product.
- Load fonts optimally (e.g. `next/font/google` at build or a self-hosted licensed/available font package); preserve system fallbacks if remote fetching unavailable. Do not ship or expose font binary assets in downloadable deliverables.

### Typographic scale (CSS pixel sizes, desktop)

| Role | Size / line | Weight | Tracking | Use |
|---|---|---|---|---|
| Product wordmark | 15 / 22 | 700 | −0.3px | CloudTrace topbar |
| Page title | 24 / 30 | 650–700 | −0.6px | One per page |
| Secondary page title | 19 / 26 | 650 | −0.3px | Detail/overlay header |
| Section title | 14 / 21 | 650 | −0.1px | Panel groups and sections |
| Panel title | 13 / 20 | 650 | 0px | Card/table/graph header |
| Core body | **13 / 20** | 400 | 0px | Most operational text |
| Primary body where spacious | 14 / 21 | 400 | 0px | Explanations, intro, forms |
| Form control text | 13 / 19 | 450–500 | 0px | Input, button, select |
| Table row primary | 12.5–13 / 19 | 450–500 | 0px | Asset, evidence, incident tables |
| Supporting metadata | 12 / 18 | 400 | 0px | Source/time/status explanation |
| Small label | **11 / 16** | 600–700 | +0.7px if uppercase | Column headers, eyebrow labels |
| KPI numeral | 26 / 31 | 650 | −0.5px; tabular nums | Derived incident metrics |
| Case ID / timestamp | 11.5–12.5 / 18 | 450–500 | 0px | `IBM Plex Mono` |
| Tiny nonessential graph ticks | 11 / 15 | 450 | 0px | Axis/legends only |

**Hard rule:** The approved preview used intentionally miniaturised text to fit a compact preview viewport. **The real application must use the sizes above**. Never shrink all content to 9–10px to mimic the preview literally. If a table is dense, reduce cell padding before sacrificing readability. Use true tabular-number alignment (`font-variant-numeric: tabular-nums`) on KPIs, counts, times and percentages.

### Text hierarchy examples

- Eyebrow: `INCIDENT / PROVIDER OUTAGE` 11px, 650, all caps, blue.
- H1: `Microsoft 365 / Exchange Online` 24px, 650, primary.
- Subtitle: `Historical provider incident · 12–13 Nov 2026 · Public reports + simulated customer data` 12px, secondary.
- Panel: `Investigation timeline` 13px, 650.
- Item: `Provider update recorded` 13px, 500; timestamp `2026-11-12 16:20 UTC` in mono.
- Footnote: `Provider-reported event; not independently verified from Microsoft infrastructure logs.` 12px, secondary.

### Long content

- Allow paragraphs to wrap (no forced truncation on important evidence). Use ellipsis only on secondary list-row text with an accessible full-value tooltip or inspector.
- Incident description reading width max 70–85 characters; evidence/log body uses full-width monospaced code viewer with horizontal scroll and line wrapping toggle.
- Never rely on all caps for normal body content. Avoid huge marketing copy inside the app.

---

## 04 — SPACING, GRID & DIMENSIONS

### Base spacing scale

`2, 4, 6, 8, 12, 16, 20, 24, 28, 32, 40, 48, 64px`.

- Main page gap between groups: 24px.
- Section title to content: 12px.
- Panel padding: 16px standard; 20px for prominent summary cards; compact data rows 10–12px vertical.
- Grid gap: 12px for sibling panels; 16px between major columns/rows.
- Form gap: 16px; label to field 6px; inline help below field 6px.
- Navigation rows: 36–40px high, icon size 16px, label 13px, left/right padding 10px.
- Metric tile min-height 96px, with enough room for label, number and context.

### Desktop shell — primary 1440px design target

- Entire viewport app background `--ct-base`, desktop min-height 100dvh.
- Persistent **sidebar 216px** wide (approved visual preview uses about 188px within the embedded demo; real app may need 216px for 9 modules). Left fixed/sticky, full available height, internal sidebar scroll if viewport short.
- Topbar **58px** high, full width, `--ct-topbar`, 1px bottom border.
- Main content area: `padding: 28px 32px 36px`, max useful content width **1640px** (center content only on extremely wide screens; keep sidebar full height).
- H1 header block top gap 16px from breadcrumb. Titlebar actions on right; collapse to separate action row when space constrained.
- Main overview: four metric cards with equal heights, 12px gutters. Analysis body split **~62/38** for timeline/activity versus investigation assessment/impact (min right width 310px). Use CSS Grid, not absolute positioning.
- Table row minimum 44px (typical 48–52px); 13px type and 12–16px horizontal padding.
- Inspector drawer width **380–440px**, max 40vw on wide desktop; scroll internally. Escape closes unless unsaved changes require confirmation.
- Header location: left app logo and product label; right environment/source indicator, global search, UTC clock optional, organisation label, user menu. On smaller desktop, hide the clock before hiding important actions.

### Page anatomy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ CT CloudTrace · Security operations             Search   DEMO   Org   User  │
├──────────────────┬──────────────────────────────────────────────────────────┤
│ OPERATIONS       │ Breadcrumb / current area                               │
│ Command overview │                                                          │
│ Incidents        │ INCIDENT / PROVIDER OUTAGE                               │
│                  │ Microsoft 365 / Exchange Online     [Action] [Action]    │
│ INVESTIGATION    │ 12–13 Nov · provenance + severity + lifecycle badges     │
│ Investigation lab│                                                          │
│ Asset graph      │ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐         │
│ Evidence vault   │ │ Metric  │ │ Metric  │ │ Metric  │ │ Metric  │         │
│ Reports          │ └─────────┘ └─────────┘ └─────────┘ └─────────┘         │
│                  │                                                          │
│ ADMINISTRATION   │ ┌──────────────────────────┬───────────────────────────┐ │
│ Integrations     │ │ Timeline / incident     │ Hypotheses / assessment   │ │
│ Activity & audit │ │ visualisation           │ Provenance + confidence  │ │
│ Settings         │ └──────────────────────────┴───────────────────────────┘ │
└──────────────────┴──────────────────────────────────────────────────────────┘
```

This is layout guidance, not permission to hardcode a diagram in the app.

### Screen density and composition

- Keep most chart and diagram graphics inside bounded bordered cards. Prefer data-rich small multiples to giant empty canvases.
- Analytical charts use thin gridlines, semantic legends, axis labels and tooltips. Every non-decorative chart has a corresponding textual summary or accessible table.
- Avoid full-page cards nested inside cards. Use at most two visible layers of nesting; inline subtle summaries may use a tinted background.
- Page content should have a clear top-level heading, immediate status context, and one obvious primary action.
- Use sticky table headers for long data tables when practical, but don't trap scrolling or create multiple nested scrollbars.

---

## 05 — APP SHELL AND INFORMATION ARCHITECTURE

### 05.1 Required navigation & route contract

| Navigation group | Label | Route | Default view |
|---|---|---|---|
| OPERATIONS | Command overview | `/overview` | KPIs, recent cases, quality signals |
| OPERATIONS | Incidents | `/incidents` | Filterable incident table |
| INVESTIGATION | Investigation lab | `/investigations` | Select an incident or resume last authorised case |
| INVESTIGATION | Asset graph | `/assets` | Graph/list toggle and asset inventory |
| INVESTIGATION | Evidence vault | `/evidence` | Provenance-aware evidence index |
| INVESTIGATION | Reports | `/reports` | Report snapshot library |
| ADMINISTRATION | Integrations | `/integrations` | Source health/permissions |
| ADMINISTRATION | Activity & audit | `/activity` | Audit event table |
| ADMINISTRATION | Settings | `/settings` | Organisation, users, profile |

**Incident deep-link:** `/incidents/[id]`, where tab segments or a URL query preserve selected investigation tab (`?tab=timeline`, etc.). **Investigation deep-link:** `/investigations/[id]`, which defaults to `overview`. One shared incident detail component is preferred rather than creating disconnected duplicate screens; row clicks and navigation must resolve to a real case. The exact path choice may differ if the original API/Next.js implementation already sets it, but **consistent deep linking and browser history are non-negotiable**.

**Report routes:** `/reports/[id]` and authenticated `/reports/[id]/print` if supported. **Auth:** `/login`. **Not found:** route and contextual 404.

### 05.2 Sidebar

- Group labels, icons and active backgrounds. Highlight the active route with subtle `--ct-selected` fill and **2px blue left indicator**; use `aria-current=page` on active link.
- Single-level left nav; do not introduce complex nested accordions just for decoration. Investigation tabs appear within incident detail content.
- Counts may appear next to `Incidents` only if computed from persisted records and clearly scoped. No arbitrary `04` badge without data.
- Sidebar footer: subdued workspace status and current data mode (`DEMO WORKSPACE · No live tenant connected` until configured). Small source-status dot requires adjacent text.
- On hovering, row changes background to `--ct-hover`, within 120–150ms. Pressed states subtle, no bounce.
- Role-based hidden capabilities may hide navigation entries only when fully denied, but never rely on hiding alone for authorisation.

### 05.3 Topbar

From left to right: logo, wordmark, separator, `Security operations`; optional bread crumb if space permits; global search; organisation indicator; `DEMO` or truthful connected source indicator; profile menu. The topbar is always visually quiet.

**Global search:** keyboard shortcut `/` or `Ctrl/Cmd+K` if conflict-free. Searches incidents, case IDs, assets and evidence within authorised organisation. Results grouped with type and icon; keyboard up/down/Enter/Escape. If feature not implemented, do not show it as active control; remove until actually built.

**Environment source:** use label `Demo · local data` when all content local/synthetic; when Microsoft connector is configured but never synced show `Microsoft 365 · Ready (not synced)`; successful sync should display `Microsoft 365 · Last sync 16:35 UTC` (actual recorded time, not a sample). A partial connection does not mean the entire platform is live.

### 05.4 Page skeleton

Breadcrumb → eyebrow → page title → support line → status chips / actions → analytical body → contextual footer notices. Aim to keep page titles concise and under ~42 characters when possible; longer incident titles may wrap over two lines instead of shrinking below 20px.

### 05.5 Navigation interaction details

- All nav clicks use actual Next.js links/router navigation, with active selection, preserved browser history and meaningful loading state.
- Use breadcrumb links, not plain decorative strings, for ancestors.
- Global scroll should be main content area; sidebar independently scrolls only as needed. Avoid horizontal body scrolling.
- On incident switch, update case data, breadcrumbs, URL and tab counts from the selected case; don't accidentally show evidence from the previous incident.
- Back/forward navigation must restore filters/tab or derive them from URL parameters.

---

## 06 — REUSABLE COMPONENT LIBRARY (IMPLEMENT AS REAL SHARED CODE)

Recommended component naming (adapt to project structure without losing the contract):

| Component | Appearance & behaviour | Important states |
|---|---|---|
| `AppShell` | Dark full-height shell, 58px header, 216px nav, constrained main | responsive, drawer-open |
| `SidebarNavigation` | Icon + sentence-case label; blue selected indicator | hover, active, disabled, focus |
| `Topbar` | Brand, source indicator, search, org/profile | demo, ready, synced, error |
| `PageHeader` | Breadcrumb, eyebrow, H1, subtitle, right actions | wrapping, mobile stacking |
| `Panel` | Flat graphite card, 1px border, 6px corners | header, empty, loading, error |
| `MetricCard` | Label / 26px number / context; clickable only if navigational | no data, zero, trend tooltip |
| `StatusBadge` | Compact, text-plus-colour semantic chip, 4px radius | severity, lifecycle, provenance, certainty |
| `Button` | Primary fill blue; secondary border; ghost inline; danger restricted | hover, pressed, disabled, loading, success/fail |
| `TextField` | 38–40px tall, tinted raised field, visible border and label | normal, focus, error, readonly, disabled |
| `SelectField` | Native-accessible/ARIA select; real option values | keyboard, focus, disabled |
| `DateTimeField` | Labelled UTC / timezone; ISO-safe form | invalid, empty, populated |
| `Textarea` | 88px min-height; focused outline; helpful max chars | error, readonly |
| `SearchField` | Search icon; clear action; debounce | searching, results, no results |
| `FilterBar` | Toolbar with search, filters, reset, result count | dirty, default, pending |
| `DataTable` | Compact aligned rows; sortable headers; pagination | loading, no rows, error, filtered-empty |
| `Timeline` | Mono UTC timestamp column; event + provenance + evidence links | filtered, conflicting, no events |
| `EvidenceInspector` | Right drawer with immutable details/hash/source and annotations | null selection, load, error, access deny |
| `DependencyGraph` | Edge/node network + status legend + inspector | pan, zoom, reset, cycle warning, missing nodes |
| `AnalysisPanel` | Evidence-led summary with source references | rule-based, AI, unconfigured, error |
| `HypothesisCard` | Statement, confidence, support/contradiction, editable state | open, supported, rejected |
| `TaskRow` | Short action, priority, owner, due date, state | overdue, completed, empty |
| `ImportWizard` | File → preview → validation → confirm → results | invalid CSV, 5MB limit, cancel |
| `ReportPreview` | Readable structured document; non-editable snapshots | draft, generated, historical version |
| `SourceHealthCard` | Connector name, permissions, true status, last sync | disconnected, ready, syncing, error |
| `Toast` | Compact corner feedback, never permanent obstruction | success, error, warning |
| `ConfirmDialog` | Serious confirmation with clear consequence and cancel focus | destructive, dirty form |
| `EmptyState` | Small line icon, one informative sentence, one real CTA | user has no rights, no data |
| `Skeleton` | Quiet block placeholders matching eventual shape | loading, reduced-motion |
| `ErrorState` | Compact error panel + retry only if retry is safe | forbidden, timeout, unavailable |

### 06.1 Buttons

| Variant | Colours | Usage |
|---|---|---|
| Primary | `#28649F` background, white text, 1px `#397BBF` border | Exactly one primary call-to-action per functional region |
| Secondary | `#182331` background, `#D5E2F1` text, `#39485A` border | Normal actions |
| Ghost | Transparent, secondary text | Secondary utilities, row actions |
| Danger | Dark red-tinted surface/red text/border | Destructive irreversible action only |

- Height: standard 36px; compact 30px; minimum touch target about 44px on touch/mobile via hit-area expansion.
- No icon-only button without accessible label/tooltip. Icons 15–17px.
- Loading: disable repeat submission, replace label with `Saving…` / `Importing…` / `Generating…`, preserve button width; show result toast or inline feedback.
- Disabled state must be visually apparent and accompanied by an explanation for important limitations (permission, not configured, no input).
- Use `ConfirmDialog` for delete, report regeneration if it overwrites an editable draft, and destructive actions; not for normal navigation.

### 06.2 Forms and validation

- Every input has a visible label and correct programmatic relationship. Placeholder is example text, never the only label.
- Required indicator `*` with a textual explanation, but don't mark optional fields as required.
- Inline error under the field in accessible alert text; error border is not the sole signal.
- Preserve input data after validation errors. Cancel closes after confirming loss of dirty state.
- Date/time and observed/ingested timestamps show UTC explicitly and validate ISO timestamp offsets.
- Segmented controls for simple graph/list and UTC/local if implemented; radio or select for 3+ options. No fancy switches for significant permission changes.

### 06.3 Status badges and metadata

- 4px corners, 11px minimum text, medium weight, 4px vertical × 7px horizontal internal padding, 1px border.
- Every badge uses text; never render `red dot only` for severity.
- Combine severity and certainty separately. Example: `[SEV 2 · High] [Resolved] [PUBLIC REPORT + SIMULATED]`.
- If status is `Unknown`, don't make it green because the system hasn't observed errors.

### 06.4 Tables

- Headers: 11px uppercase/semibold with slight tracking, 44px high.
- Body: 12.5–13px, left-aligned labels, numeric columns right-aligned and tabular.
- Alternate row colour is not required; use thin separators and subtle hover fill. Selected row gets a blue-tinted background and visible left indicator.
- Sort icon shown on sortable header; announce sort order to screen readers. Clicking toggles asc→desc→none where supported.
- Empty table vs filtered-empty must have different copy.
- Show 20/50/100 page-size choices if backed by bounded pagination; never try to render tens of thousands of DOM rows.
- Row actions `Open` and accessible menu actions; default row click navigates to detail only if interactive content remains navigable by keyboard.
- On mobile, use mobile cards for primary incident/evidence listings or explicit table scroll with a persistent `Scroll horizontally to view details` hint; do not remove essential facts.

### 06.5 Charts

- Use restrained blue bars/lines. Amber highlights anomalous intervals or elevated errors only if data supports the classification. Red reserved for confirmed critical/error states.
- Axis labels in IBM Plex Mono 11px; gridlines `#253141`; proper legends and tooltips with UTC times and counts.
- Hover chart points show date/time, series, numeric count, data source and if synthetic.
- Use zero values as zeros, not `No data`; genuine unknown/unconnected displays `No signal data available` instead of a fabricated flat series.
- Charts should not animate continuously; initial appearance <= 180ms, disabled when reduced-motion.
- Charts need textual fallback/equivalent table or accessible summary.

### 06.6 Dependency graph

- Node: rectangle, 6px radius, 1px border, dark fill, two-line max label, provider/type secondary line. Minimum width 150px, readable text 12–13px.
- Layout left-to-right (provider on left → downstream consumers on right) **or** top-to-bottom for a small graph. Include directional arrows. Explicitly label edge semantics in legend: `Consumer depends on provider`.
- Edge colour neutral steel blue; amber highlighting on potentially impacted path; red outline only on evidence-confirmed asset; green outline only on positive health evidence.
- Node click opens a right inspector; graph click should not arbitrarily create a dependency. Editing requires explicit controlled add/remove interaction.
- Toolbar: Fit view, Zoom in, Zoom out, Reset, Graph/List, incident overlay selection. All actions keyboard accessible.
- A cycle warning is a non-blocking amber callout. Graph traversal must never loop indefinitely.
- Under 768px, prefer **graph/list mode toggle with list as default**; let a scrollable graph be an opt-in full-screen panel.

### 06.7 Evidence timeline and inspector

- Timeline has a fixed-width mono time column, subtle vertical event spine or row separators, concise event title, one-line explanation, source-provenance badge, evidence ID link, and click-through inspector.
- Inspector must show `Evidence ID`, `Observed at`, `Ingested at`, `Source`, `Source event ID`, `Provenance`, `SHA-256`, `Linked asset`, `Linked case`, `Raw / normalised content`, `Analyst annotations`, and optional outbound `External source` link.
- Show full SHA in monospace and `Copy hash` button; truncation in compact list must have accessible expansion.
- Provider-reported content is clearly distinguished from fictional customer events. Never display copied sample log lines as proprietary Microsoft internal logs.
- If evidence is a manually authored note, show attribution to actor and timestamp, not as direct provider evidence.
- Evidence row is immutable where the original MVP demands; annotations are separate auditable updates, not silent alteration of original bytes.

### 06.8 Modals, drawers, popovers and notifications

- Drawer: 400px desktop, max 100vw mobile; side right; sticky drawer header + internal content scroll + optional footer actions; focus trap and Esc close.
- Modal: 480–640px width for forms, 840px max for import preview, centered at desktop and full-height/bottom-sheet at mobile if necessary.
- Dropdown: 6px radius, dark surface with visible border, constrained to viewport, keyboard navigation and item focus.
- Toast: bottom-right desktop, bottom-centered mobile; brief success; error allows enough time or user dismissal; no more than 3 stacked. Toast never replaces inline validation.
- Loading skeleton: shape and density of final content, no shimmering bright stripes. Honour reduced-motion.
- Forbidden state: “You have read-only access to this workspace.” with no fake edit affordances.

---

## 07 — SCREEN SPECIFICATIONS (ALL PAGES, STATES AND INTERACTIONS)

All routes below must have normal browser deep links, a loading state and a permission/empty state as applicable. Screens use the shared shell unless auth/print/fullscreen graph requires a justified variant. **Do not build only the four views shown in the initial preview.** The initial preview demonstrated typography, colour and panel grammar; the full MVP requires every module in the original build specification.

### S00 — Authentication / login (`/login`)

**Purpose:** Valid demo organisation login with no misleading sign-up marketing.

**Layout:** Full-viewport `#0A0F16`, a narrow centered form panel 400px max, logo and wordmark above, compact tagline, no illustration. Form panel `#121A25`, 1px border, 8px radius, 24px padding. Auth content horizontally centered but text left-aligned.

**Content:** `Sign in to CloudTrace` title; `Use your authorised workspace credentials.` subtitle; Email; Password (show/hide, keyboard accessible); `Sign in` primary; non-sensitive line `Local demonstration environment` if true. Optional demo-account help must avoid exposing production credentials or creating an auth bypass.

**States:** untouched, invalid email, wrong credentials (generic safe error), submit loading, expired session, server unavailable, success redirect. Password never logged or sent to analytics.

### S01 — Command overview (`/overview`)

**Purpose:** Rapid organisation-level understanding of open investigations and evidence quality.

**Header:** Eyebrow `OPERATIONS / WORKSPACE`; H1 `Command overview`; subtitle `Security and service incidents across your workspace` with honest data-source badge.

**Section order (desktop):**

1. **Persistent demo/source advisory** if seeded data: `This workspace contains public historical reports and simulated organisation telemetry. No live Microsoft tenant is connected.` Neutral bordered inline banner, not a noisy full-width red error.
2. Four metric cards: `Open incidents`, `Investigating`, `Confirmed affected assets`, `At-risk dependencies` — computed from authorised persisted records, scoped by organisation. Clicking navigates to the appropriate filtered view.
3. Two-column area: 62% `Incident activity` chart (event counts over selected period, with real or sample-labelled source) and 38% `Evidence quality` (coverage indicator with explainable calculation; unknown if none).
4. `Priority incidents` table, with `Case ID`, `Title`, `Type`, `Severity`, `Status`, `Updated UTC`, `Owner`, `Open`. Compact 5–10 rows with `View all incidents` link.
5. Bottom: `Recent audit activity` (5 entries) and `Current connections` (local plus optional Microsoft status).

**Primary action:** `Create incident` only for Analyst/Owner. Viewer sees normal view with no fake call to action.

**States:** no incidents (prompt to create), one case only (no fake trend), disconnected source, chart no data, evidence quality not computable, API failure. Use real source labels in tooltips.

### S02 — Incident index (`/incidents`)

**Purpose:** Locate, filter, sort, create, and open cases.

**Header:** Eyebrow `OPERATIONS / CASE MANAGEMENT`; H1 `Incidents`; subtitle `Investigate service disruption, suspicious activity and configuration failures.` Actions `Create incident` (Analyst+).

**Toolbar:** search by case number/title, severity multi-select, lifecycle status, type, date range optional, owner optional; `Reset filters`; result count; view preference table (default), cards on phone. Encode filter state in URL where practical.

**Desktop table columns:** Case ID (mono), title (max 2 lines), Type, Severity, Status, Owner, Last updated UTC, Evidence count, action `Open`. Table top can display count as `2 incidents` not fake `04`.

**Row click:** Open actual case. Hover background `#192331`; status and severity remain separate coloured badges.

**Creation flow:** `New incident` modal/dedicated page; name, description, type, severity, start UTC, affected asset selection, owner. Field validation; creates server record; success goes directly to detail and records audit entry. Cannot submit duplicate action while saving. Viewer blocked server-side.

**States:** list loaded, 0 records, filters produce 0 results, creating, failed, viewer restrictions, pagination. Historical seed must display as resolved technical provider outage, not active cyberattack.

### S03 — Incident detail / Investigation lab (`/investigations/[id]` or equivalent)

**This is the primary product experience.** A single case-specific frame containing header, tabs, evidence badges and stable inspection affordances.

**Header example using actual seed:**

- Breadcrumb: `Incidents / CT-2026-001`
- Eyebrow: `INCIDENT / PROVIDER OUTAGE`
- H1: `Microsoft 365 / Exchange Online — Historical Provider Outage` (allow wrap, no forced acronym replacement)
- Subtitle: `12–13 Nov 2026 · Public reports + simulated customer telemetry`
- Chips: `[SEV 2 · High] [Resolved] [PUBLIC REPORT + SIMULATED] [CT-2026-001]`
- Right actions: `Analyze evidence` (Analyst+), `Generate report` (Analyst+), `More` (edit case details, copy link). Read-only users have no functional mutation actions.
- Persistent modest source-integrity banner: `Microsoft's incident is treated as a reported technical disruption; simulated company logs are labelled separately. Internal provider root cause is not independently verified.`
- Two-line metadata strip: Incident type, owner, last updated UTC, evidence count, source mode.

**Seven real tabs:** `Overview`, `Timeline`, `Evidence`, `Dependency impact`, `Hypotheses`, `Response tasks`, `Report`. Tabs must be keyboard-operable, use a 2px selected bottom border, preserve selected tab in URL and not reset on unrelated data changes. On mobile, horizontally scroll tabs with visible scroll affordance.

#### S03-A — Overview tab

- Four case-specific metric cards: `Linked evidence`, `Correlated events`, `Confirmed affected`, `Potentially at risk`. These are derived from this case, not the whole organisation.
- `Signal activity` chart left (~62%) and `Investigation assessment` panel right (~38%) when telemetry exists. If only public updates exist, a timeline/event density chart may be used with a true date range and source type; do **not** fabricate continuous network telemetry.
- `Investigation assessment`: `Leading hypothesis` (clearly provisional), classification, supporting/contradicting evidence IDs, evidence coverage, analysis mode with last-run time.
- Lower left: `Latest timeline entries` (chronological, up to 6), lower right: `Dependency impact` mini-graph/list + action `Inspect full map`.
- `Open issues / tasks` compact panel if tasks exist. No giant AI chat block as the hero.
- When unanalysed, show `No analysis yet` and `Analyze evidence` with role-sensitive CTA. On analyser failure, offer rule-based fallback and show actual mode.

#### S03-B — Timeline tab

- Full-width event timeline/table with top sticky filter toolbar: date range, source provenance, category, asset, confidence and sort direction (observed UTC or ingested UTC explicitly).
- Each event: fixed mono UTC timestamp, event title, one-line detail, origin, provenance, evidence IDs, category.
- Event click opens EvidenceInspector on right, preserving the list scroll and URL if practical.
- Render conflicting observations without hiding one; an amber `Conflicting observations` warning links both items. `Related` does not mean `Caused by`.
- Provide `Export timeline CSV` only if backend export is functional. Empty, no-match, error, loading states.

#### S03-C — Evidence tab

- Case-scoped evidence table/cards with filters `Provenance`, `Source`, `Asset`, `Observed UTC`, `Hash/ID`.
- Buttons `Add evidence` and `Import CSV/JSON` for Analyst/Owner. Visible evidence-count badge uses real count.
- Row fields: evidence ID (mono), title, observed UTC, ingested UTC, source, provenance, linked asset, annotation count; click right inspector.
- Inspector exposes complete source and hash details, plus analyst annotations edit if role permits.
- `PUBLIC REPORT`, `SIMULATED`, `CUSTOMER OBSERVED` are visually distinct. Raw synthetic content is never presented as actual Microsoft-internal logs.

#### S03-D — Dependency impact tab

- Full-width interactive map with compact filter/legend toolbar, `Graph / List`, `Fit view`, `Show only impacted`, overlay legend.
- Graph nodes show asset name, provider, impact status; edges go provider → consumer visually although stored relationship is consumer `DEPENDS_ON` provider. Legend explains semantics.
- Right evidence-linked asset inspector includes the evidence for a confirmed failure or the path reasoning for `At risk`.
- Example independent Azure-hosted portal remains `Unknown` or `Confirmed healthy` only if positive data proves it; never automatically mark it affected by Exchange outage.
- Click `View evidence` to jump to the matching evidence record, not a dead-end popover.

#### S03-E — Hypotheses tab

- Main column: analyst hypothesis cards sorted by state/confidence/last changed. Side summary panel: `Supported`, `Unresolved`, `Rejected` counts (actual data).
- Card: statement, confidence chip, lifecycle status, owner, added/updated UTC, supporting and contradicting evidence IDs as clickable chips, analyst note.
- `New hypothesis` opens modal with statement, confidence (Low/Medium/High), linked evidence chooser, counterevidence, optional note. Save persists and writes audit.
- Editing status to `Supported` requires supporting evidence; show clear validation. No automated AI promotion to confirmed root cause.
- AI suggestions, when available, show `AI SUGGESTION · NOT REVIEWED` until human confirms. Rule-based suggestions labelled accordingly.

#### S03-F — Response tasks tab

- Table/board toggle (table default; do not force a Kanban interface). Columns `Task`, `Priority`, `Owner`, `Due UTC`, `Status`, `Linked evidence`, `Actions`.
- `Create task` opens labelled modal. Task fields: title, description, assignee, priority, due timestamp, status, evidence IDs. Change state with documented audit log.
- Overdue tasks use amber/red textual status with date context, never alarming animations.
- Nothing executes containment, disables accounts or changes cloud systems from a task action. Buttons are workflow bookkeeping only.
- Empty state `No response tasks recorded. Add the first manual follow-up.`

#### S03-G — Report tab

- Two-panel layout: left latest report preview (if present), right report metadata/version history and action. If none, a neutral `No report generated` panel with a real `Generate report` action for Analyst+.
- A generated report is an **immutable versioned snapshot**. `Generate new version` must create v2 without altering v1. Show `Generated by`, UTC timestamp, version and case ID.
- Buttons `View report`, `Print / save as PDF`, `Export JSON`, `Export timeline CSV` only where truly implemented. PDF uses browser print if backend PDF generator absent; label honestly.
- Report preview content: Incident scope; executive summary; evidence-supported facts; provider-reported facts; unknowns; event timeline; affected/at-risk assets; hypothesis state; response tasks; recommendations; sources/evidence appendix; limitations including simulations.

### S04 — Asset graph and inventory (`/assets`)

**Purpose:** Maintain the company's service catalogue and evidence-linked relationships.

**Header:** `Asset graph`; subtitle `Map services, providers, ownership and dependency paths.` Actions `Add asset`, `Add dependency` for Analyst+.

**Body:** Toggle `Graph` / `Inventory`. Graph as default desktop; inventory list may be default mobile. Graph canvas bounded inside a large bordered panel with proper navigation; inspector is adjacent/right. Use high-contrast small square nodes; keep widths consistent. Include provider filter, criticality, name search, incident overlay selector and `Reset view`.

**Inventory columns:** Asset name, Provider, Category, Criticality, Owner, Dependencies, Impact state (only with selected incident overlay), Last updated. Graph-to-row and row-to-node links preserve selection.

**Add asset flow:** Name, Provider (`MICROSOFT_365`, `AZURE`, `AWS`, `GCP`, `INTERNAL`, `OTHER`), Type, Owner, Criticality, description. Persist; validation; audit.

**Add dependency flow:** Consumer asset, Provider asset, type `DEPENDS_ON`, reason/notes optional; preview arrow direction, forbid self-dependency; show cycle notice if a loop results; save/audit. Delete edge requires confirmation.

**Error/no-data:** `No assets mapped yet`, with `Add asset` if permitted. If selected incident overlay has no evidence, statuses remain `Unknown`.

### S05 — Evidence vault (`/evidence`)

**Purpose:** Cross-incident evidence archive and import control centre.

**Header:** `Evidence vault`; subtitle `Preserved observations and references with traceable provenance.` Actions `Import evidence`, `Add record` for authorised users.

**Body:** Search field, incident filter, provenance filter, asset filter, date range, CSV/JSON import entry point; table with evidence IDs and hashes/anchors. Show aggregate count derived from data; no simulated recent-ingestion counts invented for dashboard polish.

**Import wizard:**

1. Select target incident (required if not already inside case).
2. Choose CSV/JSON local file (max **5 MiB**). Drag/drop plus accessible browse button.
3. Parse preview in a bounded table; display total/valid/invalid rows, row-level validation messages, UTC timestamp checks, provenance distribution, duplicate candidates.
4. Choose atomic import (default) or explicit partial-accept option if backend supports it. Never silently drop failed rows.
5. Confirm actual save, show a persistent import result summary including accepted/rejected/deduplicated counts and audit reference.

**Empty/error:** Distinguish no evidence ever vs filter matched none. Invalid file does not create evidence; allow download of example format/validation errors if implemented.

### S06 — Reports index and report viewer (`/reports`, `/reports/[id]`)

**Index:** `Incident reports`; subtitle `Versioned investigation snapshots, ready for review and export.` Table columns Case, Report title, Version, Generated UTC, Generated by, Source mode, Action. Filter by case and date. No static fake history. Reports must be backed by actual immutable snapshots.

**Viewer:** Dedicated report chrome narrower than analytics canvas (max 900–980px) for readability, optional right contents rail. Header actions `Print / save as PDF`, `Export JSON`, `Back to reports`. Section headings 14–18px, main body 13–14px, citations/references in mono. Print stylesheet switches to white page, dark ink, removes app shell, retains warnings and evidence ID labels, avoids splitting table rows where practical. Explain print destination rather than claiming server-generated PDF.

**Report state:** Version history visible, immutable version number, export failures handled. Viewer can read/export but not generate new report.

### S07 — Integrations (`/integrations`)

**Purpose:** Show truthful source health and configure optional read-only data access.

**Header:** `Integrations`; subtitle `Manage which authorised sources CloudTrace can analyse.`

**Cards:**

- `Local investigation engine` — label `Active · local`; what it supports (seeded incidents, imports, reports, rules); not a network link.
- `Microsoft 365 service health` — `Not configured`, `Ready`, `Syncing`, `Connected`, or `Error`. Show last successful sync time and permission `ServiceHealth.Read.All` only when consented. CTA `View setup` when not configured; `Sync now` only when credentials and permission are actually configured and user Owner.
- `Claude analysis` — `Not configured` or `Connected` based on verified server state. `Rule-based analysis available without an API key.` No frontend key entry or exposure.
- `Microsoft Sentinel`, `Azure Monitor`, `AWS CloudWatch` — future-stage cards if shown: `Planned · not connected`; **no clickable fake Connect buttons**.

**Setup details:** Tenant ID/client ID steps, server-side secret management explanation, least privilege and consent. Never expose secret in DOM, responses, logs or screenshot.

**Empty state:** Local mode works, and the UI explains what remains functional without integrations.

### S08 — Activity & audit (`/activity`)

**Purpose:** Reconstruct who performed a privileged action and when.

**Header:** `Activity & audit`; subtitle `Review changes, imports, analysis and report generation.`

**Toolbar:** UTC date filter, actor, action class, entity/case ID, search, export if supported. Table: UTC, actor, action, entity, summary, source category; row inspector for safe structured metadata.

**UX:** Explicit `Append-only record` explanation. No edits/deletes, no raw tokens in UI. Viewers may not access full audit log if original permission model restricts it; show access-denied with guidance rather than an empty table.

**States:** no records, filtered no match, load error, permission denied. Sort most recent by default but preserve original timestamps.

### S09 — Settings (`/settings`)

**Tabs:** `General`, `Members & roles`, `My profile`, optionally `Preferences` (UTC first).

**General:** Workspace name, slug/ID (read-only), data mode summary, local database info; `Save changes` Owner only. Any unsafe destructive action belongs behind explicit warnings, not casual settings toggles.

**Members & roles:** List users with email, role and status, role explanation (`Owner`, `Analyst`, `Viewer`), create development-only demo user path only if backend supports it. Server enforces permissions. Do not expose credentials.

**My profile:** Display name, email, role, security/session info; editable names if original MVP supports it. Date/time preference must not change evidence canonical timestamps.

**Preferences:** Density (Compact/Comfortable) can be a future extension but default Obsidian is fixed. Do not ship a light theme in MVP; no decorative dark-mode switch toggling to an incomplete theme.

### S10 — Auxiliary and system screens

1. **Global 404:** Brand, `Page not found`, explanation and `Return to overview` link.
2. **Access denied / 403:** `You do not have permission to perform this action.` Include read-only context and a meaningful safe back link.
3. **Session expired:** Login re-entry preserving safe `returnTo` route; never silently show stale data as current.
4. **Application error / data fetch failure:** Small error panel explaining that data could not load, `Retry` if safe, technical request ID where available (no secrets).
5. **No selected investigation:** Neutral icon, `Select an incident to start investigating`, actual incident list/dropdown and link to incidents.
6. **Full-screen graph (optional):** Reuse map rendering and toolbars, never a totally different theme.
7. **Print-only report:** White, high-contrast accessible print stylesheet; remove navigation and non-report controls.

---

## 08 — DETAILED INTERACTION CONTRACT / USER JOURNEYS

### Journey 1: Historical Microsoft outage analysis

1. Owner/Analyst signs in to seeded organisation and lands at overview.
2. Demo banner explains public historical sources and simulated organisation telemetry.
3. User selects case `CT-2026-001`; case has `Resolved`, `Provider outage`, and provenance label. It **must not** be described as a confirmed hack.
4. `Overview` shows real seeded evidence count and any computed impact, no invented live chart if not present.
5. User opens `Timeline`; public provider updates and synthetic CRM/support errors are visibly different. Clicking evidence ID opens inspector with full reference and source type.
6. User switches to `Dependency impact`; confirmed affected synthetic CRM is distinct from at-risk service and the unrelated Azure portal.
7. User creates a hypothesis and selects actual supporting/counterevidence. Save confirms persistence and audit event.
8. User generates report, inspects v1, prints to PDF or exports JSON, returns to case, changes a note, generates v2, verifies v1 remains unchanged.
9. Browser refresh preserves all saved changes and selected deep-linked tab.

### Journey 2: Synthetic suspicious sign-in investigation

1. User opens `CT-2026-002` (100% synthetic security case).
2. Timeline and evidence inspector show documentation-only IP addresses, normalised UTC times and failed/successful events.
3. Investigator proposes possible account abuse but labels it `SECURITY_SUSPECTED`, not `Confirmed compromise` absent evidence.
4. Analyst adds manual response task for legitimate-activity verification and MFA review; no action changes actual Microsoft identity systems.
5. Report retains synthetic-data disclaimer and links every factual event to evidence IDs.

### Journey 3: CSV import, validation and evidence integrity

1. Analyst opens evidence vault → `Import evidence`.
2. Chooses incident and selects JSON/CSV.
3. Invalid timestamps/provenance show line-number errors; cannot silently insert rejected data.
4. Previews duplicate hashes and atomic-vs-partial choice if supported.
5. Confirms; counts refresh, inspector shows SHA-256, audit log shows import; reload persists.
6. Viewer attempting same operation receives proper 403 from server.

### Journey 4: Microsoft connector not configured

1. User opens Integrations.
2. Microsoft 365 card says `Not configured`. No live events, no fake last sync, no pretend connection.
3. User can see authorisation requirements and setup instructions; local investigation path remains functional.
4. If credentials/consent are configured, `Sync now` shows progress, proper errors/retries and an actual sync timestamp only on success.

---

## 09 — EXACT MICROCOPY LIBRARY

Use the following where the UI needs consistent phrasing. These are product labels, not hardcoded incident data.

| Element | Approved copy |
|---|---|
| Overview H1 | `Command overview` |
| Incidents H1 | `Incidents` |
| Investigation H1 fallback | `Select an investigation` |
| Asset graph H1 | `Asset graph` |
| Evidence H1 | `Evidence vault` |
| Reports H1 | `Incident reports` |
| Integrations H1 | `Integrations` |
| Audit H1 | `Activity & audit` |
| Settings H1 | `Settings` |
| Primary case action | `Analyze evidence` |
| Report action | `Generate report` |
| Report print | `Print / save as PDF` |
| Import CTA | `Import CSV/JSON` |
| Evidence inspect | `Inspect evidence` |
| Confirmed state | `Confirmed affected` |
| Derived state | `At risk — dependency path` |
| Unknown state | `Unknown — no sufficient observations` |
| Case mode label | `PUBLIC REPORT + SIMULATED` |
| Synthetic security case | `SIMULATED SECURITY EXERCISE` |
| Rule mode | `Rule-based analysis` |
| AI mode | `Claude analysis` (only if actually used) |
| AI uncertain | `Hypothesis — not verified` |
| Empty incidents | `No incidents recorded. Create a case to start an investigation.` |
| Empty evidence | `No evidence linked to this incident.` |
| Filter empty | `No results match these filters.` |
| No hypothesis | `No hypotheses recorded. Add one with supporting evidence.` |
| No tasks | `No response tasks recorded.` |
| No reports | `No report snapshots have been generated.` |
| Integration not configured | `Not configured — local analysis remains available.` |
| No data chart | `No observations available for this time range.` |
| Analysis missing | `No analysis has been run for this incident.` |
| Error load | `This information could not be loaded. Try again.` |
| Viewer limitation | `Your role allows viewing, not editing.` |
| Source integrity warning | `Provider-reported details are not independently verified from internal provider telemetry.` |
| Synthetic warning | `Simulated company events. Not observed Microsoft tenant activity.` |
| Save success | `Changes saved.` |
| Import success | `Evidence imported. Review the accepted and rejected row counts.` |
| Export error | `Export failed. Your report data was not changed.` |

**Copy quality test:** In every critical screen, can a reviewer distinguish 1) what is observed, 2) what is inferred, 3) what is only publicly reported, and 4) what is simulated? If not, the screen fails.

---

## 10 — RESPONSIVE BREAKPOINT RULES

Use actual responsive layouts, not a scaled desktop screenshot. Avoid hiding essential content on small screens.

| Viewport | Navigation | Content columns | Behaviour |
|---|---|---|---|
| >=1440px | Fixed 216px expanded sidebar | 4 metrics; 62/38 main area | Full data tables and inspector |
| 1200–1439px | Fixed 208–216px sidebar | 4 metrics if space; 60/40 panels | Tighten gaps to 12–16px |
| 1024–1199px | Collapsible 60–64px icon rail; tooltips | 2–4 metric columns according to content; primary + secondary may stack | Preserve accessible icon names; drawer inspector |
| 768–1023px | 60px icon rail or top-triggered overlay | 2 metrics per row; main panels stacked | Graph/list toggle, horizontal tab scroll |
| 480–767px | Hidden sidebar, overlay drawer via menu button | 2 metrics, one column analysis panels | Search opens focused overlay; mobile card rows |
| 320–479px | Drawer nav, slim topbar | 1–2 metrics (2 only when cards remain readable), all main panels one column | Form fields full-width; buttons wrap, no clipped headings |

**Mobile header:** menu button (44px accessible target), compact logo, source badge (`Demo`) and profile menu; hide product sub-label if needed. Menu drawer covers up to 300px or 88vw, focus-trapped, closes after route selection or Escape.

**Mobile incident detail:** header stacks, status chips wrap, action row horizontally scrolls only if necessary, tabs scroll with visible edge shadows/indicators, no text overflow. Use a bottom-sheet/full-screen inspector rather than a 400px side panel that covers all content.

**Mobile graphs:** list default, graph optional with pan/zoom controls and obvious help. Never rely solely on pinch gestures.

**Mobile tables:** convert primary incident/evidence/task lists to accessible cards with case/ID/title/status/time/action; advanced audit/import preview tables may horizontally scroll inside a bordered container. Keep sticky context or headings.

**Touch:** no critical hover-only interactions; no sub-44px touch targets without expanded hit areas; drag/drop always has browse-button alternative; dropdowns and modals usable by touch.

**Viewport validation:** 320×740, 390×844, 768×1024, 1024×768, 1280×800, 1440×900, 1920×1080. Verify page zoom at 200%, and text-only zoom without controls overlapping.

---

## 11 — INTERACTION MOTION & FEEDBACK

- Standard hover/focus transitions: `120–150ms ease-out` for background/border/opacity. Small panel reveal `160–180ms`. No spring physics or large page slide-in animations.
- Route changes: prefer immediate page rendering or skeleton rather than fade-to-black.
- Timeline/graph active selection: subtle border/fill change, no pulsing, bouncing or glow.
- Modal: short 160ms opacity/translate-y 4px, disabled if `prefers-reduced-motion: reduce`.
- Never animate severity flashing or red pulse continuously; avoid performance-heavy chart entrance effects.
- Loading is explicit; no fabricated progress percentages. Use measured success and failure signals.
- Optimistic UI only when rollback/error messages are carefully handled; critical evidence writes can wait for confirmed server response.

---

## 12 — ACCESSIBILITY AND INCLUSIVE DESIGN

**Target:** WCAG 2.2 AA in normal workflows. This is a requirement for a serious enterprise product, not a secondary enhancement.

- Contrast: 4.5:1 body text; 3:1 large text and essential non-text UI indicators; confirm real rendered combinations in tests. Use stronger secondary colour if a colour-on-surface combination fails. Do not use `#69788B` for essential body text.
- Visible focus ring: 2px `#9EC5FF` with at least 2px offset where practical; never rely exclusively on browser-default low-contrast dotted focus.
- Landmarks: banner, navigation, main, optional complementary aside; one H1 per page; descending heading hierarchy.
- Screen reader: meaningful aria-labels for icons, graph nodes and chart summaries; `aria-live=polite` for status notices, alerts for validation errors; don't announce every animation.
- Keyboard: Tab/Shift+Tab across actions, Enter/Space activation, Arrow keys for tabs/lists when implemented with ARIA patterns, Escape closes menus/drawers, focus returns to triggering button.
- Form validation: label, required, error message, `aria-describedby` and `aria-invalid` semantics.
- Modal dialog: proper role, accessible name, focus trap and restoration. Warn when unsaved changes would be lost.
- Icons never communicate severity alone. Colourblind-safe text and shape/border differentiation.
- Charts include data table or accessible text equivalent; graph supports list view with same relationships and statuses.
- Small-text minimum: 11px only for nonessential axes and mini labels, 12–14px for normal content; no 8–10px operational labels as in tiny mockup.
- Reduced motion: transitions disabled/minimised; no forced graph animation.
- Avoid trapping keyboard focus in virtualised tables or graph canvases.

---

## 13 — DATA, SECURITY AND CLAIMS PRESENTATION RULES

These visuals encode important truth constraints from the base MVP. They are mandatory, not optional stylistic niceties.

1. An incident `PUBLIC_REPORTED` source is **not** customer telemetry. Use source label + source URL + source date (if known).
2. `SYNTHETIC` evidence is visually labelled in the timeline, inspector, graph status explanation, report and charts. A global warning alone is insufficient when individual rows may be exported or captured in screenshots.
3. A provider-reported root cause is labelled `Provider-reported explanation`, not `CloudTrace verified root cause`.
4. `SECURITY_SUSPECTED` must not render as confirmed compromise. User-approved analyst adjudication and actual evidence matter.
5. Analysis engine names are accurate: `Rule-based analysis` when no Claude API; `Claude analysis` only when Anthropic returned a validated response.
6. No secret or token in debug panel, tooltip, audit history, logs, HTML or JSON responses.
7. Organisation switcher lists only memberships of authorised user; route-level data must not leak cross-tenant objects via search or drawers.
8. Viewer read-only controls are explicitly disabled/absent with explanation, but server must still enforce access.
9. API errors distinguish invalid input, permission, missing record and service failure safely; don't disclose whether a foreign tenant incident exists.
10. Numbers, percentages, charts and timestamps come from persisted data or are explicitly marked as static example/demo content. Never invent impressive performance metrics.
11. If connector status cannot be verified, show `Unknown` or `Not configured`, not a green live badge.
12. Graph at-risk status means *possible downstream effect*. Never colour every connected node red by association.
13. Audit logs are append-only; there is no visible delete/edit button for existing audit records.
14. Report provenance/simulation caveats survive HTML print, PDF-print and structured exports.
15. Permission, import failure, analysis failure and empty-state styles are first-class components, not broken-looking fallback HTML.

---

## 14 — DESIGN TOKEN IMPLEMENTATION AND FILE STRUCTURE

### Suggested code organisation

```
src/
  app/
    (auth)/login/page.tsx
    (app)/layout.tsx
    (app)/overview/page.tsx
    (app)/incidents/page.tsx
    (app)/incidents/[id]/page.tsx
    (app)/investigations/page.tsx
    (app)/investigations/[id]/page.tsx
    (app)/assets/page.tsx
    (app)/evidence/page.tsx
    (app)/reports/page.tsx
    (app)/reports/[id]/page.tsx
    (app)/integrations/page.tsx
    (app)/activity/page.tsx
    (app)/settings/page.tsx
  components/
    shell/           AppShell, Topbar, SidebarNavigation, PageHeader
    primitives/      Button, Badge, Panel, EmptyState, Skeleton, Dialog
    incidents/       IncidentTable, IncidentHeader, IncidentMetrics
    investigations/  Timeline, AnalysisPanel, Hypotheses, Tasks, Tabs
    evidence/        EvidenceTable, EvidenceInspector, ImportWizard
    dependencies/    DependencyGraph, GraphToolbar, AssetInspector
    reports/         ReportViewer, VersionHistory, ExportActions
    integrations/    SourceHealthCard
  styles/
    cloudtrace-obsidian.css
  lib/
    ui/              text-label mappings, date-format, status palette
```

The layout structure may adapt to the established repository, but the design tokens and components must be **centralised**. Do not fork UI kits or embed giant CSS blocks in each page.

### CSS custom properties

Ship the included `cloudtrace-obsidian.css` file as the canonical design token implementation. Map its semantic variables into the current Tailwind/shadcn setup without conflicting duplicate token sets. Some pre-existing shadcn elements may use `rounded-xl` or gradients; override them to these tokens across the application. If using `next/font`, map loaded fonts to the variables in CSS.

### Design presets

- Only one approved theme: `Obsidian`. No unnecessary preferences carousel, visual-style toggle or rainbow custom themes.
- Default density: `Compact professional`, not cramped. Maintain 12–14px readable text.
- No platform-wide dark/light toggles until a separately approved complete light design exists.
- Use appropriate skeleton sizes matching final typography and panel geometry.

---

## 15 — SCREEN-BY-SCREEN DESIGN QA CHECKLIST

**Authentication**

- [ ] Dark centered sign-in without stock art or decorative gradients.
- [ ] Labels and errors are readable; no auth credentials leak.
- [ ] Keyboard and password visibility toggle function.

**App shell**

- [ ] All nine navigation routes exist in correct groups.
- [ ] Brand/header/sidebar geometry are consistent across screens.
- [ ] Demo/connected labels reflect actual configured state.
- [ ] Search works if displayed, and keyboard focus is visible.
- [ ] No sidebar/topbar overlaps at narrow widths.

**Overview**

- [ ] Four KPIs are derived from the persisted organisation data.
- [ ] Event chart contains real or explicitly simulated observations, not arbitrary illustration.
- [ ] Evidence quality metric is explainable or withheld when unknown.
- [ ] Incident rows/links open their actual cases.

**Incidents and investigation lab**

- [ ] Correct seed case ID `CT-2026-001`; historical event is a provider technical outage, not a hack.
- [ ] Seven tabs work with URL history and real content.
- [ ] Provenance labels are visible in the timeline, evidence, graph, report.
- [ ] `Analyze evidence` works offline and displays rule-based mode when Claude not connected.
- [ ] Hypothesis, notes and tasks writes are saved and audited.
- [ ] Evidence inspector has hash/source/timestamps and functional copy/link actions.
- [ ] Derived at-risk ≠ confirmed affected; graphs show reasoning paths.
- [ ] Reports produce immutable version history with real export/print actions.

**Assets, evidence, integrations, audit and settings**

- [ ] Asset graph interactions work; list fallback on mobile.
- [ ] Asset/edge creation is validated and persisted.
- [ ] Import wizard previews/validates real CSV/JSON and never silently drops rows.
- [ ] Integration cards never fake being connected.
- [ ] Audit log shows real append-only activity with safe metadata.
- [ ] Role restrictions visible and server enforced.

**Visual craft**

- [ ] Inter / IBM Plex Mono hierarchy matches typography table.
- [ ] Base/surface/sidebar colours match exact canonical tokens.
- [ ] Buttons have clear primary/secondary hierarchy and functional hover/focus/disabled.
- [ ] 1px borders, 4–8px corners, no glass or decorative glows.
- [ ] Rows aligned; digits tabular; text wrapping and long hashes handled.
- [ ] No icon more visually dominant than the information it represents.

**Responsive/accessibility**

- [ ] Tested 320, 390, 768, 1024, 1440 and 1920px width.
- [ ] Tested 200% zoom, keyboard-only navigation and reduced-motion.
- [ ] Colours are contrast-compliant and statuses have text labels.
- [ ] Screen-reader names exist for icon buttons, tabs, modals and graph controls.
- [ ] Import, create, edit, filter, export and report actions remain usable on phone.

---

## 16 — ACCEPTANCE TEST PLAN FOR CLAUDE CODE

**Automated test expectations:**

1. Snapshot/component tests for `StatusBadge`, `MetricCard`, `PageHeader`, `DataTable`, `EvidenceInspector`, `SourceHealthCard` and `EmptyState` (or equivalent meaningful unit tests).
2. E2E smoke paths: login → overview → incidents → case → timeline → evidence inspector → graph → report; incident creation; CSV import validation; viewer read-only restriction.
3. E2E layout test at `390×844` and `1440×900` verifies no horizontal body overflow, no inaccessible primary CTA and nav drawer closes/opens.
4. Accessibility tests for labels, names, focus, dialog semantics and keyboard navigation; use `axe-core` or equivalent where practical.
5. Verify no screenshots show invented live Microsoft telemetry, fictitious attack attribution or unexplained green health state.
6. Verify no dead controls: every interactive-looking element maps to implemented behavior or is clearly disabled with a reason. An unimplemented future card uses `Planned`, not a link.
7. Verify only design tokens determine surfaces, text, borders, status colours and typography. Avoid one-off inline colours except data visualisation/chart palettes.
8. Record truthful pass/fail output for typecheck, lint, unit, E2E (if available) and production build.

### Visual acceptance rubric (score each 0–5; target ≥4 every category)

| Category | Pass definition |
|---|---|
| Enterprise credibility | Looks like quiet operational tooling, not a landing page or AI-demo template |
| Information hierarchy | Important incident/evidence context read before decorative or secondary elements |
| Typography | Consistent Inter/IBM Plex Mono sizes; no 9px operational body text |
| Layout discipline | Predictable grids, gutters, border system, aligned panels and tables |
| Status semantics | Severity, lifecycle, impact and provenance impossible to confuse |
| Functionality | No dead buttons, filters, tabs, imports or report actions |
| Responsiveness | Desktop, tablet and mobile all genuinely navigable |
| Accessibility | Keyboard, contrast, focus, labels, text alternatives |
| Forensic defensibility | Each factual claim traceable to correct evidence source; uncertainty is visible |
| Performance | No runaway canvas redraws, excess animation or giant unreadable tables |

### Final implementation instruction

> Implement the full original CloudTrace MVP and **this approved Obsidian design system together**. Read both specifications in full. For visual design and copy use `CLOUDTRACE_OBSIDIAN_DESIGN_SPEC.md` and included CSS/JSON tokens, which supersede earlier styling proposals. For functionality, persistence, investigation rules, security and factual case study use `CLAUDE.md`. Start by implementing the shared app shell and tokens, then functional screens with real persisted data and integrations as specified. Run tests, fix failures and provide actual local run commands. Do not stop when the dashboard looks attractive; completion requires all working pages and workflows.

---

## 17 — FUTURE ITERATION POLICY

This file freezes the **approved Obsidian v1 direction**. A later visual iteration may add a polished custom symbol, additional chart treatments, compact/comfortable density or a larger command centre, but **only** after the existing system is functional and the variant is explicitly approved. Do not redesign CloudTrace into a different style mid-implementation. Change design tokens at the source, do not perform random per-page cosmetic patches.

**End of design specification.**
