# test — aggregate plugin contract suite (node:test)

**Score 14** (53 files, ~9.7k LOC; distinct domain: black-box contract checking over generated artifacts).

## OVERVIEW

51 `*.test.mjs` suites + `index.js` loader asserting contracts over GENERATED/INSTALLED artifacts — manifests, aggregate hook JSON, built CLIs, synced skills — not over component sources. Runs via `npm test` from `plugin/` after `npm run build`; also the tail of repo-root `bun run test:codex`.

## KEY FILES

| File | Role |
|------|------|
| `index.js` | Suite loader: sorted dynamic import of every `*.test.mjs` |
| `aggregate-plugin-fixture.mjs` | Shared fixture API: manifest readers, hook collectors, structural `spawn_agent` scanning (balanced call/token shapes — never prose grep) |
| `sync-skills-test-support.mjs` | Skill inventory + exact-content assertions (`assertPackagedContentMatches`, `CONTEXT_PRESSURE_SKILL_BUDGET_BYTES`, `expectedSkills`) |
| `component-hook-contract-cases.mjs` | Shared per-component hook contract cases |
| `teammode-safety-fixture.mjs` | Teammode safety fixture |

## WHERE TO LOOK

| Family | Suites |
|--------|--------|
| Aggregate wiring | `aggregate-{manifest,hooks,build,mcp,agents,model-catalog}.test.mjs` |
| Bootstrap | `bootstrap-{hooks,setup,binlinks,orchestration,ps-guard}.test.mjs` |
| Update flow | `auto-update{,-state-persistence,-restart-notice,-release-notes}.test.mjs` |
| Migration | `migrate-codex-config.test.mjs` (1,242 LOC — densest), `multi-agent-v2-regression`, `subagent-limit-migration` |
| Skills sync | `sync-skills{,-codex-compatibility}.test.mjs`, `ulw-plan`/`ulw-research`/`ulw-loop` skill contracts |
| Teammode | `teammode-{transport,communication,worktree,safety,thread-links,thread-title,archive-ambiguity}.test.mjs` |
| Component CLIs | `component-{bundled-cli,bin-names}.test.mjs`, `lsp-prebuild-layouts` |

## CONVENTIONS

- `node:test` + `node:assert/strict`, ESM, test names in `#given ... #when ... #then` form.
- Idempotence asserted with byte equality; skill copies checked for hand-authored drift.
- Paths resolve from `import.meta.url`; temp roots isolated per test; subprocesses via `process.execPath`, never a shell assumption.
- Windows behavior explicit: `.cmd` shims, `commandWindows`, PowerShell 5.1/TLS/ASCII constraints.

## ANTI-PATTERNS

- Structural checks must parse balanced shapes; never trust prose text.
- Hooks must fail closed/silent on malformed input; migration must not mutate user-owned settings or change bytes on repeat runs.
- Never assert prompt/skill prose wording — machine-consumed fields and shipped-copy equality only.

## COMMANDS

- `npm test` (from `plugin/`, after `npm run build`)
- `node --test packages/omo-codex/plugin/test/<file>.test.mjs` (single suite; `--test-name-pattern` filters)
