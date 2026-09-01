# Evidence — beui.dev interaction reference for the frontend skill

## What was tested

1. Manifest partition gate (the machine consumer of designOriginals): `bun test packages/shared-skills/frontend-thirdparty-manifest.test.ts` run BEFORE the reference file existed, immediately after adding `interaction-skill.md` to `designOriginals` in `scripts/frontend-refs-manifest.mjs`.
2. Builtin-artifact byte-equivalence gate: `packages/skills-loader-core/.../shared-skill-extraction.test.ts` run after editing the shared SKILL.md and before mirroring the loader-core artifact and TS description.
3. Full battery after implementation: shared-skills package tests (manifest, materialize, provenance, depersonalization, upstreams), skills-loader-core builtin-skills tests, omo-opencode builtin-skills tests, and `omo-opencode/src/shared-skills-package.test.ts` (packaging + every-skill-parses pin).
4. beui.dev consultation recipe: live curl against every endpoint the new reference documents (`/llms.txt`, `/r`, `/r/{slug}`, `/r/{slug}/raw`).

## What was observed

- RED: 2 failing tests for exactly the right reasons — `interaction-skill.md` not tracked, `.gitignore` missing the unignore line (`red-manifest-test.txt`).
- RED 2: byte-equivalence failure between shared SKILL.md and the loader-core artifact after the shared edit, before mirroring.
- GREEN: full battery passes (`green-test-battery.txt`); depersonalization gate passes; description stays 787 chars (under the 1024 Codex cap, enforced by the extraction test).
- Endpoints return real payloads: registry index JSON, component detail JSON with files/dependencies, raw TypeScript source (`beui-endpoint-verification.txt`).

## Why it is enough

The change is skill prose plus its machine-consumed registration (manifest, gitignore, ATTRIBUTION, TS description string). Every machine consumer is exercised by its own committed test: the DMCA partition, the materialization set, the byte-equivalence pins across harness copies, packaging inclusion, and frontmatter parse/length budget. Per `.omo/rules/test-discipline.md` PROMPT TESTS and the shared-skills AGENTS.md note, the prose content itself ships on review, not on wording pins. The consultation recipe is verified against the live service the reference documents, mirroring the lazyweb.md precedent.

## What was omitted

- No live opencode/codex session drive: the change adds a reference file and routing prose; skill loading mechanics are unchanged and are covered by the loader/packaging pins above. No new tool, hook, or config surface is introduced.
- beui.dev raw source bodies are truncated in the endpoint capture to avoid vendoring third-party source into the repo.
