# CloudTrace Obsidian — approved design handoff

This package provides the **approved Obsidian visual system** for CloudTrace. It accompanies (does not replace) the original CloudTrace functional MVP. It is a **design and implementation specification**, not a finished website.

## Files

- `CLOUDTRACE_OBSIDIAN_DESIGN_SPEC.md` — complete screen-by-screen implementation-grade design specification, ~10k words. Read this first for layout, fonts, colours, status meaning, UX, accessibility and all screens.
- `cloudtrace-obsidian.css` — CSS custom properties, shared primitives, responsive and print styles. Integrate into the global stylesheet.
- `obsidian.tokens.json` — machine-readable canonical palette, type scale and geometry.
- `DESIGN_QA_CHECKLIST.md` — manual and automated UI acceptance gates.

## How to use with existing MVP

1. Put these files in the root of the existing Claude Code CloudTrace project alongside `CLAUDE.md`.
2. Ask Claude Code:

   **“Read CLAUDE.md and CLOUDTRACE_OBSIDIAN_DESIGN_SPEC.md in full. Implement the complete functional CloudTrace MVP using the approved Obsidian design system as the definitive authority on UI design, text, typography, layouts, interactions, accessibility, responsive rules and all screens. Use cloudtrace-obsidian.css and obsidian.tokens.json, do not build a generic SaaS dashboard. Keep all original security/data integrity/feature requirements. Implement, run tests, fix failures and report real results. Do not stop at a static prototype.”**

3. Verify the final UI and workflow using `DESIGN_QA_CHECKLIST.md`.

## Precedence

- Functional features / persistence / security / API / incident truthfulness: original `CLAUDE.md`.
- All visual styles / copy / UI interactions / screen layouts / responsive behaviour: `CLOUDTRACE_OBSIDIAN_DESIGN_SPEC.md`.
- The earlier style suggestions in section 4 of the original MVP are **superseded**.

## Two download choices

- **Design-only ZIP**: Use if you already uploaded the earlier MVP into Claude Code.
- **Combined complete ZIP**: Includes the original MVP files plus the Obsidian design files with the conflicting legacy visual design block explicitly replaced. Use for a new clean project.

No Microsoft or Anthropic API credentials are required for the local MVP. This is a developer specification, not evidence that a working app has already been built.
