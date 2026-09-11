# Evidence — react-bits ambience reference for the frontend skill

## What was tested

1. Routing membership gate (the machine consumer of `designOriginals`): `bun test packages/shared-skills/frontend-ambience-routing.test.ts` run BEFORE `ambience-skill.md`, its manifest entry, and its `.gitignore` un-ignore existed (`red-routing-test.txt`).
2. Full battery after implementation: every `packages/shared-skills/*.test.ts` (third-party manifest partition, materialization, provenance pin, depersonalization, root path, upstreams, stylegallery + ambience routing), `skills-loader-core` builtin-skills tests (shared-skill extraction byte-equivalence between the shared `SKILL.md`, the loader-core artifact, and the TS description; skill file loader), and `omo-opencode/src/shared-skills-package.test.ts` (packaging + every-skill-parses pin) (`green-test-battery.txt`).
3. react-bits consultation recipe: live fetch against every endpoint the new reference documents — `/llms.txt`, `/r/registry.json`, `/r/<Name>-TS-TW.json` for a Motion row, an ogl row, and a zero-dependency row — plus a check that all 74 components named in the routing map exist in the registry (`reactbits-endpoint-verification.txt`).

## What was observed

- RED: 3 failing tests for exactly the right reasons — manifest lacks `ambience-skill.md`, `.gitignore` lacks the un-ignore line, git does not track the file.
- GREEN: 142 pass / 0 fail across 25 files under Bun 1.4.2 (the CI pin), run on a fleet compute machine rather than the session host.
- Endpoints return real payloads: 171-entry catalog, 684-item registry, per-component JSON whose `files[].content` is the source and `dependencies[]` the pinned engine (`motion@^12.23.12`, `ogl@^1.0.11`, `[]`).

## Why it is enough

The change is skill prose plus its machine-consumed registration (manifest, gitignore, ATTRIBUTION, the loader-core mirror). Every machine consumer is exercised by its own committed test, and the byte-equivalence pin proves the builtin artifact matches the shared source. Per the shared-skills AGENTS.md note, the prose itself ships on review, not on wording pins. The consultation recipe is verified against the live service, mirroring the `interaction-skill.md` (beui.dev) precedent.

## What was omitted

- No live opencode/codex session drive: the change adds a reference file and routing prose; skill loading mechanics are unchanged and covered by the loader/packaging pins above.
- react-bits source bodies are not stored in the endpoint capture: the library is MIT + Commons Clause, and the reference itself forbids vendoring.
