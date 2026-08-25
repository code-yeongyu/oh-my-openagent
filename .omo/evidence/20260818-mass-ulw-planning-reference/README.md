# mass-ulw planning reference — QA evidence (2026-08-18)

## What was tested
- `node packages/omo-senpi/plugin/scripts/sync-skills.mjs` — regenerates `plugin/skills/` from `skills/`; verified `mass-ulw/references/planning.md` lands in the generated tree.
- `bun test packages/omo-senpi/src/skills-sync.test.ts` — generated-skills contract (forbidden tokens, native banner rules) over the regenerated tree including the new reference.
- `bun test packages/omo-senpi/src/components/task/mass-ulw-protocol-doc.test.ts` — unrelated protocol-doc gate, run to prove no collateral damage.
- `bun test packages/omo-senpi/plugin/scripts/native-skill-sources.test.mjs` — registry still resolves `mass-ulw` to `packages/omo-senpi/skills/mass-ulw`.
- `rg -ln "skill-contract" packages tests script` — no dangling references to the deleted contract test.

## What was observed
- sync-skills: "synced omo-senpi skills" and `plugin/skills/mass-ulw/references/planning.md` (7210 bytes) present.
- rg dangling-refs check: empty (clean).
- Test results: see qa-output.txt (captured after worktree `bun install`; first pre-install run failed with `Cannot find module '@oh-my-opencode/utils'`, an environment artifact, not a code failure).

## Why it is enough
The change set is prose (SKILL.md + new references/planning.md) plus a user-ordered test deletion. The machine gates that can regress are exactly the three suites above: skill registration, generated-skill content policy, and the protocol doc. The prose itself is deliberately unpinned per repo test discipline (never pin prose).

## What was omitted
No raw logs containing secrets were produced; all output is test runner text.
