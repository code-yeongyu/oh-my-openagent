# mass-ulw split-first parallel-quick doctrine — QA evidence (2026-08-18)

## What was tested
- `node packages/omo-senpi/plugin/scripts/sync-skills.mjs` — regenerated tree ships the edited planning.md.
- `bun test` on skills-sync, mass-ulw-protocol-doc, native-skill-sources — the three machine gates.
- rg checks: "Split first, route second", "Do not split when", "SURVIVES splitting" present in planning.md.

## What was observed
- 19 pass / 0 fail (see qa-output.txt). Only planning.md modified.

## Why it is enough
Prose-only change to one reference file; the three suites are the only machine consumers of skill content and registration. No prose-pinning tests per repo test discipline.

## What was omitted
No secret-bearing output produced.
