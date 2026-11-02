# Grounding: guideline source, ideal state, gap ledger

Run this before the brief for a new screen or flow, a redesign ("this looks bad", "make it better", "rework the design system"), and any design-system creation or rework. It replaces taste guesses with a written bar: what a good interface does for its users, and every place the work falls short of it. A small change skips the run and reads the ledger in `DESIGN.md` section 9 when one exists.

The output is `DESIGN.md` section 9 (`design-system-architecture.md` gives the template), or the change description when the project has no `DESIGN.md`.

## 1. Guideline source, read in full

Pick the authoritative sources for the platform and the domain: the platform's guidelines (Apple Human Interface Guidelines, Material 3, Fluent 2), WCAG 2.2, and the project's own `DESIGN.md`. Read every page. If a source is too large for one context (the Apple HIG runs to hundreds of pages), split it across parallel readers with `/mass-ulw`, or with parallel subagents where it is unavailable. Each reader returns the principles from its pages with their URLs. A skimmed or sampled source counts as unread.

## 2. Universal principles

Drop the platform idioms: named materials, system icon sets, platform control chrome, and vendor elevation and motion names. Keep what holds for any interface: hierarchy, feedback, consistency, error prevention and recovery, input effort, density, legibility, and accessibility. Tie each principle to a persona and a journey step. Name who uses the product and what they are trying to get done. Then name the step where the principle decides the experience: first visit, daily use, recovery from an error, or a return after time away.

## 3. Ideal state

For each journey step, write what the product does at its best: what the user sees first, the one action, the feedback after it, and the way back from a mistake. Write it so a reviewer can check it on a screenshot: "the run's status and its one next action are the first thing on the screen" is checkable; "clean and intuitive" is not.

## 4. Gap ledger

Capture the surface under work through `/visual-qa` (on a new screen, the first draft, built after the brief; the ledger then grows as the draft is checked) (every state at 390 and 1440, both themes) and list every difference from the ideal state. Do not rank the small ones away. Then read the rule sources in full and add every violation of each: `SKILL.md`'s build rules and draft guard (plus `check-draft-guard.ts` output), the `/visual-qa` checklist, every reference this request routed to, and the WCAG 2.2 AA items in `SKILL.md` Verify. Capture a screenshot for each row and keep the ledger in a durable record (the `/ulw-loop` ledger when it runs) so no finding lives only in context. One row per gap:

| ID | Screen / state | Gap | Principle or rule broken | Evidence | Fix | Proof | Status |
|---|---|---|---|---|---|---|---|
| G1 | Settings / save | Save button widens from 96 to 128 px when its spinner appears | State-stable controls | `before/settings-save-loading.png` | Spinner overlays the hidden label in a fixed-width slot | Width probe equal across idle/loading/done; `/visual-qa` before/after pair | open |

## 5. Close the ledger

Plan the fixes before the first edit (`/ulw-plan` for a large ledger): each row names its fix and, in advance, the `/visual-qa` item or probe that will prove it. Then execute without stopping to ask between rows: independent rows run in parallel (`/mass-ulw`, `/ulw-execute`), each fix is a scoped pass (`SKILL.md` Verify), and a large ledger ships as several PRs grouped by screen or rule. A row closes only with its before/after pair and the passing proof, and the pairs go in the PR body. Report progress often as closed/total ledger rows, naming what closed since the last report.
