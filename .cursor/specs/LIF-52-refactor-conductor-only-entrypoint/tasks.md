# Tasks: Conductor-only Entrypoint (canonicalize conductor)

**Input**: `.cursor/commands/conductor.md`  
**Prerequisites**: spec.md, plan.md

## Phase 1: Canonicalization

- [x] T001 Rewrite `.cursor/commands/conductor.md` as the full canonical Railway Conductor command:
  - Front-load mandatory Step 1–5 flow + critical guardrails
  - Keep Step 6–8 as OPTIONAL/CONDITIONAL sections inside the same file with explicit triggers
  - Add `<!-- END conductor.md -->` + “re-read if missing” instruction
- [x] T002 Delete legacy alias command file (leave only `.cursor/commands/conductor.md`)
- [x] T003 Repo-wide sweep: replace any legacy alias references with `/conductor` and `.cursor/commands/conductor.md`
- [x] T004 Verify repo-wide grep shows zero legacy alias references

## Phase 2: Governance

- [x] T010 Historian: add changelog entry for LIF-52 conductor canonicalization


