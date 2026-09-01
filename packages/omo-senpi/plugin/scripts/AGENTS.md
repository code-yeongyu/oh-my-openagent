# plugin scripts

Build, staging, sync, and install pipeline for the `@code-yeongyu/omo-senpi` Pi package. All hand-authored Node ESM `.mjs` (built-ins only, no runtime deps), tests colocated as `.test.mjs`. Earned by score: 22 files, the plugin's symbol-density and reference hub (sibling tests plus root build wiring import these exports).

## WHERE TO LOOK

| Script | Role |
|--------|------|
| `build-extension.mjs` | Bundles the six extension artifacts. Entry/output map: `src/extension/bundled-index.ts` -> `extensions/omo.js`, `src/extension/omo-task.ts` -> `extensions/omo-task.js`, `packages/senpi-task/src/team/member-extension/index.ts` -> `extensions/omo-member.js`, `src/mcp/memory-server.ts` -> `extensions/omo-memory-mcp.js`, `src/components/memory/worker/memory-run-supervisor.ts` -> `extensions/memory-run-supervisor.mjs`, `src/components/init-deep-advisor/runtime.ts` -> `extensions/omo-init-deep-advisor.js`. Exports `buildExtension`, `checkExtensionCurrent`, `resolveBunExecutable`, `SENPI_LOADER_ALIASES`, `toPortableBuildPath`; type surface in `build-extension.d.mts`. |
| `build-artifact.mjs` | Shared artifact helpers: `normalizeBuiltinImports`, `minifyBundle` (secondary terser pass), `attachBuildMarker`, `artifactsMatch`, `toPortableBuildPath`. |
| `build-install.mjs` / `install.mjs` | Installer build and the installer itself (largest script here): atomic settings writes with backups, platform launchers, package dedup, legacy builtin shadow removal, superseded Omo package cleanup, agent-dir context resolution, CLI dispatch. |
| `sync-skills.mjs` | Ships skills into `plugin/skills/` by composing the pools below. |
| `native-skill-sources.mjs` | Native skill registry (alphabetical): `dag-library`, `give-me-tips`, `hyperplan`, `init-deep`, `mass-ulw`, `onboarding`, `ultrawork`, `ulw-plan`, `ulw-research`; ships verbatim aside from blank-line normalization. `init-deep` and `ulw-plan` are senpi-local overrides shadowing shared-pool copies (other editions consume the shared files untouched; `ulw-plan` is seeded from the fully senpi-adapted bundle output). |
| `senpi-compatibility-guidance.mjs` | Detects and strips OpenCode-only orchestration shapes (`call_omo_agent`, `background_output`, `team_*`, `task(...)`) from shared skills. |
| `senpi-skill-roster-overlay.mjs` | Senpi-specific skill roster overlay applied on top of synced skills. |
| `embed-directive.mjs` | Embeds `skills/ultrawork/SKILL.md` into `src/components/ultrawork/generated-directive.ts`; rejects forbidden directive tokens/patterns (multi_agent, spawn_agent, codex, ...). `--check` verifies freshness. |
| `sync-version.mjs` | Version sync for the plugin manifest. |
| `persona-artifacts.mjs` | Persona staging/freshness (dream, facts, reflection) consumed by the extension build. |
| `stage-agent-toolkit.mjs`, `stage-ast-grep-mcp-runtime.mjs`, `stage-lsp-daemon-runtime.mjs` | Stage vendored runtimes into `plugin/runtime/` with manifest + SHA-256 + mode verification and `check*Fresh` freshness gates; `stage-lsp-daemon-runtime.d.mts` is the explicit type surface. |

## CONVENTIONS

- Paths derive from `import.meta.url` (script dir -> plugin root -> package root -> repo root), never from cwd.
- Build/stage functions are async with an `options = {}` bag; deterministic outputs; portable build paths; freshness via build markers and source-input digests.
- `SENPI_LOADER_ALIASES` must stay byte-for-byte aligned with senpi `loader.ts` (see the comment in `build-extension.mjs`) and with `src/bundle-purity.test.ts`. Externals: `#omo-task-runtime`, the senpi peer/import family, TypeBox aliases, and Node builtins (bare and `node:`).
- Tests: `bun:test` for most modules, `node:test` for some; check the runner import before adding a case.

## ANTI-PATTERNS

- Never edit generated outputs directly; change source or these scripts and rebuild. Never bypass a stale/missing-artifact or `--check` failure.
- Never widen `SENPI_LOADER_ALIASES` without the matching senpi loader and `bundle-purity.test.ts` change (peer-external rule in `../../AGENTS.md`).
- No non-atomic settings writes and no direct artifact mutation in install paths.
- Never let forbidden tokens (`multi_agent`, `spawn_agent`, codex references) into synced skills or the embedded directive; the checks exist to fail the build.

## COMMANDS

```bash
node plugin/scripts/build-extension.mjs [--check]
node plugin/scripts/build-install.mjs
node plugin/scripts/sync-skills.mjs
node plugin/scripts/embed-directive.mjs --check
node plugin/scripts/stage-agent-toolkit.mjs        # likewise stage-ast-grep-mcp-runtime.mjs, stage-lsp-daemon-runtime.mjs
bun test plugin/scripts/                          # colocated suite
```
