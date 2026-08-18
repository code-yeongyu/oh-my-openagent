# Task 15 evidence: dream persona asset

## Commands run
- `bun test packages/memory-core/src/reflection/assets` -> 6 pass, 0 fail (see test.txt). RED phase confirmed first: both dream tests failed while the asset was absent.
- `bunx tsc --noEmit` in packages/memory-core: zero errors in reflection/assets. Remaining errors are all in concurrent in-flight files owned by other todos (src/facts/queue*, src/locks/domains.test.ts, src/people/format.test.ts) and pre-date this change.
- Full `bun test packages/memory-core`: 7 failures, all in those same concurrent in-flight areas (locks domains, identity layout, compile cache, facts queue). None touch reflection/assets.

## Files changed
- packages/memory-core/src/reflection/assets/dream-persona.md (new asset)
- packages/memory-core/src/reflection/assets/assets.ts (loadDreamPersona export; re-exported via existing reflection/index.ts barrel, no barrel edit needed)
- packages/memory-core/src/reflection/assets/assets.test.ts (loader/export test + one source-vs-packaged equality assertion, per test-discipline two-copy rule)
- packages/omo-senpi/plugin/extensions/dream-persona.md (packaged copy, mirrors how reflection-persona.md ships; build-extension.mjs wiring left to todo 25/22 owners, drift guarded by the equality test)

## Test discipline
The persona wording is pure prose with no machine consumer (validateCompletion never parses persona text). Per .omo/rules/test-discipline.md, NO prose-pin tests were written: no phrase-presence, no heading pins, no trailer-shape assertions. Tests cover only machine-consumed seams: the asset resolves and loads through assets.ts non-empty with parsed sections, and the two shipped copies are byte-identical. The wording ships on review + this QA-by-read.

## QA-by-read of the persona prose
Verified against the binding sources:
- Skills-usage ledger shape described exactly as skills-usage.ts writes it: `{ "<skill-id>": { count, lastUsedAt } }`, `{}` when absent, exposed as SKILLS_USAGE_PATH (IC-12).
- DREAM_STATE_PATH and DREAM_POLICY_PATH described per IC-12, including `{ version: 1, people: { enabled, max_entries, max_entry_chars } }` and the mandatory skip-whole-people-phase-when-disabled rule plus limit enforcement.
- Skill audit: unused >= 90d -> deprecate CANDIDATE in report only; contradicted-by-evidence -> update in place; op menu update > extend > deprecate > split > create > none; "when unsure, none" conservatism (letta rule, guardrail "NO one skill update per session quota" respected: no quota mentioned).
- Consolidation duties: cross-file dedupe, tier rebalance (hot external -> system/, stale system/ -> reference/), notes/facts/ older than 6 months summarized into ARCHIVE.md.
- People phase: deduction "detective" cites premises; induction "psychologist" states pattern + confidence and NEVER writes cards; contradictions flagged `status: open`, never resolved (guardrail: no automatic contradiction resolution); card refresh folds stable markers, full rebuild only on explicit user request; prose human.md -> card conversion on first encounter.
- Structure/tone matches reflection-persona.md (frontmatter, phase layout, commit contract with Generated-By/Agent-ID trailers scoped `(dream)`, output format, critical reminders). No em/en dashes, no AI filler.

## Ambiguity resolved
IC-2 says background writers stamp `Omo-Writer: dream`, but the shipped reflection persona has the child stamp `Generated-By: agent memory` + `Agent-ID`. Prior art was followed (identical trailer block, `(dream)` scope). If IC-2's Omo-Writer stamping is meant to be persona-driven rather than parent-side, todo 12/22 owners should adjust both personas together.
