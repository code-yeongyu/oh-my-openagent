# omo-senpi src

Source root of the Senpi adapter package. The package barrel (`index.ts`) exports only `omoSenpiAdapterPackageName` and re-exports `./install`; everything else is consumed through `extension/index.ts` (extension entry) and per-component barrels. Package anatomy, build, and QA live one level up in `../AGENTS.md`.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Extension entry / composition | `extension/` | `index.ts` (source entry, eager task), `bundled-index.ts` (built entry, lazy task runtime). Own AGENTS.md. |
| Install / uninstall | `install/` | `runSenpiInstaller` / `runSenpiUninstaller`, local launcher, atomic settings writes. |
| Memory MCP server | `mcp/memory-server.ts` | Standalone stdio JSON-RPC server exposing the memory tools under exposure `"search"` (senpi `tool_search` catalog). Plain Node, no senpi runtime; the extension injects bound identity + accepted-turn provenance, cwd-based auto identity retained for standalone calls. |
| Real host modules for tests | `senpi-test-runtime.ts` | Resolves the installed `@code-yeongyu/senpi` dist and imports real theme/ModelRegistry/ModelRuntime at load time. |
| Deep components | `components/{task,memory,lsp,telemetry,init-deep-advisor}/` | Each has its own AGENTS.md; `memory/` additionally documents `worker/`, `commands/`, `palace/`. |
| Small components | `components/*` | Single-purpose factories (ulw-loop, config-watch, onboarding, fallback-architect, ...) documented in `../AGENTS.md`. |

## Root audit gates

Colocated at `src/` root. These are executable package-contract tests, not documentation:

- `bundle-purity.test.ts` - import allowlist for the extension bundle; keep aligned with `SENPI_LOADER_ALIASES` in `plugin/scripts/build-extension.mjs` (peer-external rule in `../AGENTS.md`).
- `bundle-size.test.ts` - bundle size budget.
- `package-shape.test.ts` - adapter manifest contract; license/notice files must ship with generated artifacts.
- `plugin-manifest.test.ts` - packaged plugin manifest.
- `runtime-dependency-resolution.test.ts` - a symlinked plugin without host hoisting still resolves runtime deps from the real path.
- `runtime-package.test.ts` - LSP daemon runtime staging: manifest pins sorted outputs; tampered output rejected.
- `extension-node-runtime-audit.test.ts` - extension loads under plain Node/jiti: no Bun-only module properties (`import.meta.dir` / `import.meta.file`) at module scope (v5.0.0-beta.1 regression).
- `senpi-main-runtime-import-audit.test.ts`, `omo-native-capture-path.audit.test.ts` - import/capture-path surface audits.
- `skills-sync.test.ts` - synced skills carry no foreign harness tokens (`codex`, `multi_agent`, `spawn_agent`, case-insensitive).

## CONVENTIONS

- Tests colocated (`*.test.ts`), Bun runner, `#given ... #when ... #then` names; `FakeExtensionAPI` drives registration without a host.
- Components are factory objects (`create*Component()`) with `register(pi, ctx)`; registration order lives in `extension/component-list.ts`.
- Host surface is consumed only through `extension/types.ts` structural ports (`SenpiExtensionAPI`, `ComponentContext`), never concrete senpi types outside `extension/`.

## COMMANDS

```bash
bun test packages/omo-senpi                                   # package suite
tsgo --noEmit -p packages/omo-senpi/tsconfig.json             # typecheck
bun run test:senpi                                            # full gate: build + stage + typecheck + tests
```

## ANTI-PATTERNS

- Don't loosen an audit gate to unblock a build; fix the violation or deliberately change the contract.
- Don't add runtime dependencies without keeping `runtime-dependency-resolution.test.ts` / `runtime-package.test.ts` green from a symlinked install.
- Don't grow the package barrel; new surface goes through `extension/` or a component barrel.
