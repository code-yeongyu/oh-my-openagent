# OpenCode Skill Loading Consolidation QA

## What Was Tested

- Focused Bun tests for the runtime resolver, native accessor, direct `skill` routing, delegated `load_skills` routing, and core tool-registry wiring.
- `packages/omo-opencode` package typecheck.
- Root build.
- OpenCode QA common self-check.
- Manual runtime-shape smoke against an isolated `opencode serve` 1.17.8 server with isolated XDG state and a project-local normal-path skill.

## What Was Observed

- `focused-tests.log`: 194 tests passed, covering plugin-registered runtime skills, native/user normal-path fallback, shared resolver wiring into `skill`, `skill_mcp`, and `task`, and the delegate task call order for runtime/base resolution before native loading.
- `omo-opencode-typecheck.log`: `tsgo --noEmit -p tsconfig.json` passed for `packages/omo-opencode`.
- `build.log`: root `bun run build` completed successfully.
- `opencode-qa-common-self-check.log`: OpenCode QA helper dependencies, DB path, sandbox cleanup, and shim preservation checks passed.
- `manual-runtime-shape-smoke.log`: a real `createOpencodeClient()` object had an internal generated client but no direct `app.skills` method; the v2 wrapper native accessor loaded the isolated `user-normal-skill` from live OpenCode `/skill`. Direct `skill` and delegated `load_skills` both loaded that native skill only after runtime/base miss, and both preserved runtime/base resolution before native fallback. The real OpenCode DB session count stayed `5737` before and after.

## Why It Is Enough

The tests pin both bug classes from #5576 and #5652: runtime/plugin-registered skills are resolved lazily from the merged runtime config, while OpenCode native/default/user skills are fetched through the host skill endpoint. The manual smoke drives the exact SDK shape called out in review: direct `ctx.client.app.skills` is unavailable on a real `createOpencodeClient()` style object, while the v2 wrapper attaches and returns live skills.

## What Was Omitted

- No real model call was made; the changed behavior is skill discovery and tool/delegate resolution, not LLM generation.
- The isolated server password and Authorization header were not written to evidence.
