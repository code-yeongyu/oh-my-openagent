# dag-library QA evidence — 2026-08-18

Scope: stored dag definitions rerunnable in two lines (`plugin/runtime/dag/library.js`) plus the `dag-library` skill and its registry/telemetry/doc wiring.

## What was tested

1. **Unit: load/placeholder/key-rotation/start semantics** — `bun test src/extension/dag-library.test.ts` (7 cases: explicit suffix rotation, default datetime rotation, empty-suffix idempotency, dir shadowing order, missing-name error, invalid-definition error, start handle wiring). RED first: all 7 failed against the not-implemented stub; GREEN after implementation. Artifact: `test-output.txt`.
2. **Real-surface: two-line usage from an eval-shaped JS context** — a bun script installing only the eval kernel globals (`read`, `env`, `tool.dag`) ran exactly the two lines a cell would run (`import(library.js)` + `lib.start("nightly", { suffix: "demo1" })`). Observed: `run_id` returned, definition started with rotated key `nightly-audit-demo1` and `{{key}}`/`{{date}}` placeholders filled. Artifact: `qa-two-line-usage.txt`.
3. **Skill packaging** — `sync-skills.mjs` emits `plugin/skills/dag-library/SKILL.md`; frozen inventories updated (`skills-sync.test.ts`, `native-skill-sources.test.mjs`, telemetry `BUILTIN_SKILL_NAMES`, regenerated `docs/reference/senpi-telemetry.md` schema block). Artifact: `test-output.txt` (skills-sync 10/10 within the 17).
4. **Skill standard validation** — `validate-skills.py` on `skills/dag-library`: OK. Artifact: `skill-validation.txt`.
5. **Typecheck** — `bun run typecheck` in `packages/omo-senpi`: clean. Artifact: `typecheck-output.txt`.

## Why sufficient

The library's only responsibilities are file→definition resolution, placeholder filling, key rotation, and forwarding to `tool.dag`; (1) pins each, (2) proves the user-visible two-line path end to end through the same global seam the eval kernel provides, and (3)-(5) prove the skill ships and the package stays green.
