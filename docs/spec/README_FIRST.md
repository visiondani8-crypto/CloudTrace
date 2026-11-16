# CloudTrace — Complete Functional MVP + Approved Obsidian Design

This package is the complete handoff to Claude Code for a **working** CloudTrace app with the approved dark Obsidian UI. This is not the finished application.

## Start here

1. Extract this ZIP into a new Claude Code project folder. Keep `fixtures/`.
2. Open Claude Code in that folder.
3. Send exactly this request:

> Read CLAUDE.md and CLOUDTRACE_OBSIDIAN_DESIGN_SPEC.md completely before implementing. Build all functional CloudTrace MVP screens and workflows, following the Obsidian design spec as the authoritative UI reference. Use cloudtrace-obsidian.css and obsidian.tokens.json as design tokens. Implement persistent local database, authentication, incident workflows, evidence ingestion and inspector, timeline, dependency graph, hypotheses, manual response tasks, reports and exports, local rule-based analysis and optional integrations. Use fixtures, enforce role and organisation permissions, run tests and a production build, fix failures and document any remaining issues. Do not stop after building the dashboard or at a static design mockup.

4. Use `DESIGN_QA_CHECKLIST.md` and `CHECKLIST.md` to review the resulting application.

**Read first:**
- `CLAUDE.md`: functionality, architecture, database, APIs, auth and incident integrity.
- `CLOUDTRACE_OBSIDIAN_DESIGN_SPEC.md`: **approved UI**; exact colours, typography, all screens, components and interactions.
- `cloudtrace-obsidian.css` and `obsidian.tokens.json`: source-of-truth design tokens.

No paid API or Microsoft tenant is needed for a working local demo. All synthetic data must stay clearly labelled.
