# mass-ulw usage-patterns (capacity model, dag-or-team, trigger runs, failure modes) — QA evidence (2026-08-18)

## What was tested
- `node packages/omo-senpi/plugin/scripts/sync-skills.mjs` — regenerated tree ships the edited planning.md.
- `bun test` on skills-sync, mass-ulw-protocol-doc, native-skill-sources — the three machine gates.
- rg checks: "Reading this file is not planning", "Capacity model", "Trigger-launched runs", "Dag or team", "quiet widget is not a stall", "Provider storms amplify" present in both source and shipped planning.md.

## What was observed
- 19 pass / 0 fail / 240 expect() calls (see qa-output.txt). Only planning.md modified; SKILL.md untouched (the mandatory-read gate already routes every dag author through planning.md).

## Why it is enough
Prose-only change to one reference file; the three suites are the only machine consumers of skill content and registration. No prose-pinning tests per repo test discipline. New content verified this session against live runs: 5-slot limiter + rolling refill (run dag_f7d0063c), 64-node/16-run caps (dag/types.ts), queued-not-stuck + transition-lag self-heal (HWP session journal), provider start-storm (51-node batch, all leaves failed at start).

## What was omitted
No secret-bearing output produced. No overlap with in-flight feat/dag-definition-library (it adds a new dag-library skill; zero shared files).
