# script/ -- Build/Publish Automation

**Generated:** 2026-08-24

## OVERVIEW

Build, publish, QA, and repo-invariant automation. Run via `bun run <script>` from root package.json. Singular directory name (not "scripts/" -- the root `scripts/` dir holds node helpers like `check-third-party-notices.mjs`).

## SCRIPTS (top-level)

| File | Purpose |
|------|---------|
| `build-binaries.ts` | Writes 12 generated Node launcher packages for darwin/linux/windows (AVX2 + baseline) |
| `build-cli-node.ts` | Node-runtime CLI bundle (`dist/cli-node`) for environments without Bun |
| `build.ts` | Main build entry (`bun run build`) |
| `build-codex-install.ts` | Bundle the Codex installer entrypoints into `packages/omo-codex/scripts/install-dist/`. Also embeds a source-freshness marker (`// omo-codex-install:<sourceDigest>:<bodyDigest>`) as line 2 of the generated bundle and exports `buildCodexInstaller()` / `digestCodexInstallerSources()` / `parseCodexInstallerArtifact()` for non-destructive freshness checks; guarded by `import.meta.main` |
| `build-omo-schema.ts` + `build-omo-schema-document.ts` | Generate the unified OMO config schema + companion document |
| `build-omo-native.ts` | Build the native omo runtime artifacts |
| `ensure-vendored-lsp-daemon.ts` | Build/watch the vendored LSP daemon (daemon bin + lock-dir watch) |
| `verify-omo-ai-payload.mjs` | omo-ai npm payload gate: required artifact list, 18-skill minimum, 30 MB unpacked cap, no nested `node_modules`/source paths |
| `test-fast.ts` | `bun run test:fast` partitioned suite: `opencode-memory` -> `senpi` -> root-rest via `bunfig.win2.toml` |
| `ci-fast-path.mjs` | CI skip classifier (`classifyCiMode`): platform-sensitive paths and the `ci:full-matrix` label force the full OS matrix |
| `telemetry-schema-block.mjs` | Generate the telemetry schema doc block (`generateTelemetrySchemaBlock`) |
| `remove-stale-self-package-tests.ts` | Prune self-package tests that reference deleted sources |
| `agent-command-string-scan.ts` | Scan tracked sources for unsafe agent command strings; allowlisted exceptions live in `agent-command-string-audit.allowlist.json` |
| `verify-npm-payload.mjs` | npm payload verification |
| `build-help-schemas.ts` | Generate CLI help schemas |
| `build-schema.ts` + `build-schema-document.ts` | Zod schema to JSON Schema for `assets/oh-my-opencode.schema.json` |
| `build-model-capabilities.ts` | Refresh the generated model-capabilities artifact consumed by `packages/model-core/` |
| `patch-node-require-shim.ts` | Patches `dist/index.js` for Node/Electron require compatibility |
| `publish.ts` | Local multi-package publish alternative (platform packages + npm) |
| `generate-changelog.ts` | Release notes from git log, filters bot commits |
| `stats.ts` | npm + GitHub-release download counts (`gh api --paginate --slurp`; weekly `stats.yml`) |
| `sync-lazycodex-marketplace.ts` | Copy plugin + marketplace payload into the `code-yeongyu/lazycodex` repo (publish.yml stable releases) |
| `lazycodex-marketplace-validation.ts` | Validate the synced marketplace payload (runtime path args incl. Windows/absolute/`components/*/dist/*.js`) |
| `lazycodex-runtime-dists.ts` | Enumerate component runtime dists bundled into the published payload |
| `update-frontend-upstreams.mjs` | Bump shared-skills submodules + rewrite ATTRIBUTION pins (`--check` verifies) |
| `install-codex-dev.ts` | Dev dogfood installer: uninstall current Codex Light, then install this repo's local build into the REAL `~/.codex` stamped as version `dev` (`.../omo/dev/`, `(OmO dev)` hook prefix). Sets `LAZYCODEX_DEV_VERSION`. Run via `bun run install:codex-dev`. Flags: `--version=<x>`, `--no-uninstall`. NOT for QA — use the isolated `CODEX_HOME` flow for that. |

## SUBDIRS

- `qa/` -- QA drivers: `codex-marketplace-e2e.sh`, `web-terminal-visual-qa.mjs` (renders TUI evidence through real xterm.js + node-pty in a browser, true color; NEVER tmux capture-pane), `xterm-live-terminal.mjs` (live capture core), `strip-ansi.mjs`, `web-terminal-redaction.mjs`, `omo-native-telemetry-qa.mjs` (end-to-end telemetry privacy QA: sandbox, capture server, redaction; `--evidence-dir <dir> --senpi-bin <path>`).
- `fixtures/` -- shared script test fixtures (vendored LSP build owner).
- `agent/` -- dev-env contract: `setup.sh`, `cleanup.sh`, `cleanup-hook.sh`, `docker-dev.sh`, `qa-sandbox.sh`, `qa-docker.sh` (see root AGENTS.md DEVELOPMENT ENVIRONMENT).

## TESTS (61 `*.test.ts`)

Co-located per script (`build-binaries.test.ts`, `stats.test.ts`, `sync-lazycodex-marketplace.test.ts`, `publish-lazycodex-workflow.test.ts`, `package-layout.test.ts`, `lazycodex-marketplace-validation.pin.test.ts`, `web-terminal-visual-qa.test.ts`, ...). Repo-wide meta-audits also live here and run in root `bun test`:

| File | Invariant |
|------|-----------|
| `package-registration-audit.test.ts` | Workspaces registered, devDeps aligned, ROADMAP reverse-dependency edges stay zero, shim inventory complete |
| `shared-core-extraction-guard.test.ts` | `packages/*-core` stay harness-neutral (no harness-adapter imports/deps) |
| `agent-env.test.ts` / `agent-harness-wiring.test.ts` / `agents-md-dev-env.test.ts` | Dev-env scripts, harness wiring files, and the root AGENTS.md DEVELOPMENT ENVIRONMENT section stay in sync |
| `codex-install-bundle-freshness.test.ts` | The COMMITTED Codex installer bundle matches its sources: reads the bundle from the git index (`git show :packages/omo-codex/scripts/install-dist/install-local.mjs`), checks the build marker is present and self-consistent, and asserts the current source digest matches it |
| `agent-command-string-audit.test.ts` (+ `agent-command-string-scan.test.ts`) | Bare/unsafe agent command strings in tracked sources must be allowlisted (`agent-command-string-audit.allowlist.json`, categorized) |
| `ci-root-test-partition.test.ts` / `root-test-config.test.ts` | `ci.yml` root test job and the `bunfig.*.toml` partition stay in sync |
| `root-test-serial-quarantine.ts` | Single source of truth for the test files every parallel CI leg runs serially first, with the documented reason per entry; pinned into both parallel bunfigs and both leg commands by `ci-root-test-partition.test.ts` |
| `test-environment-isolation.test.ts` | The test preload strips `OPENCODE_SERVER_PASSWORD` so credentials never reach tests |

## TSCONFIG

`tsconfig.json` is script-specific (separate from package `src/`). It includes all top-level `script/*.ts` files so build and release automation stay in the Bun-typed TypeScript project instead of falling back to inferred LSP projects. Typechecked via `bun run typecheck:script`.

## NOTE

CI uses plain `bun test`; there is no sharding or split isolation runner.
