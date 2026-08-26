# src/cli/doctor/ — Health Diagnostics (25 Check Files)

**Generated:** 2026-08-10 / 38d268995

## OVERVIEW

`bunx oh-my-opencode doctor` — parallel diagnostic checks. `getAllCheckDefinitions()` registers **8** checks; a second function `getCodexCheckDefinitions()` registers **3** Codex-only checks. Four of the eight are category aggregators (System, Config, Tools, Models); the rest register standalone. Catches broken installs, config typos, missing dependencies, provider misconfigurations before they become runtime errors.

## COMMAND FLAGS

```bash
bunx oh-my-opencode doctor              # Full diagnostics
bunx oh-my-opencode doctor --status     # Compact dashboard (status only)
bunx oh-my-opencode doctor --verbose    # Deep details (model resolution traces)
bunx oh-my-opencode doctor --json       # Machine-readable output
```

## CHECK CATEGORIES

Registered by `getAllCheckDefinitions()` (8):

| Check | File | Validates |
|----------|------|-----------|
| **SYSTEM** | `checks/system.ts` | OpenCode binary found + version >= `MIN_OPENCODE_VERSION` (`1.4.0`), plugin registered in opencode.json, loaded plugin version matches installed |
| **CONFIG** | `checks/config.ts` | JSONC validity, Zod schema passes, no unknown keys, model override syntax correct |
| **TUI_PLUGIN** | `checks/tui-plugin-config.ts` | TUI sidebar plugin entry resolvable |
| `deprecated-reasoning-keys` | `checks/deprecated-reasoning-keys.ts` | Scans `~/.omo/omo.json[c]` for deprecated `variant` / `reasoningEffort` / `thinking` / `textVerbosity` / `fallback_models` keys, reporting file + dotted path and a `config migrate` hint. Skips the `[opencode]` block and passthrough containers (`provider_options`). Registered with a literal id, NOT in `CHECK_IDS`. |
| **TOOLS** | `checks/tools.ts` | AST-Grep CLI + NAPI, comment-checker binary, LSP servers reachable, GitHub CLI auth, built-in MCP reachability |
| **MODELS** | `checks/model-resolution.ts` | models.json cache exists, per-agent fallback resolution, category overrides valid, provider availability |
| **TELEMETRY** | `checks/telemetry.ts` | Telemetry configuration state |
| **TEAM_MODE** | `checks/team-mode.ts` | Team-mode dependencies |

Registered by `getCodexCheckDefinitions()` (3): **CODEX** (critical, `checks/codex.ts`), **CODEX_COMPONENTS** (`checks/codex-components.ts`), `codex-runtime-wrapper` (literal id, `checks/codex-runtime-wrapper.ts`).

`checks/legacy-config-leftovers.ts` is not registered standalone; the Config aggregator invokes it.

## SUPPORTING CHECK FILES (25 total)

```
checks/
├── index.ts                               # Registration
├── system.ts                              # Main System aggregator
├── system-binary.ts                       # OpenCode binary discovery (PATH + desktop app)
├── system-plugin.ts                       # opencode.json plugin entry detection
├── system-loaded-version.ts               # Cache vs npm latest
├── config.ts                              # Main Config aggregator
├── tools.ts                               # Main Tools aggregator
├── dependencies.ts                        # AST-Grep CLI/NAPI + comment-checker presence
├── tools-gh.ts                            # gh cli install + auth status
├── tools-lsp.ts                           # LSP server enumeration
├── tools-mcp.ts                           # Built-in + user MCP reachability
├── model-resolution.ts                    # Main Models aggregator
├── model-resolution-cache.ts              # models.json presence + freshness
├── model-resolution-config.ts             # unified OMO config resolution
├── model-resolution-effective-model.ts    # Per-agent fallback chain trace
├── model-resolution-variant.ts            # Model variant (max, high, medium) handling
├── model-resolution-details.ts            # Verbose output formatter
├── model-resolution-types.ts              # Shared types
├── tui-plugin-config.ts                   # TUI sidebar plugin entry
├── deprecated-reasoning-keys.ts           # Deprecated ~/.omo config keys
├── telemetry.ts                           # Telemetry state
├── team-mode.ts                           # Team-mode dependencies
├── legacy-config-leftovers.ts             # Invoked by the Config aggregator, not registered
├── codex.ts                               # Codex install (critical)
├── codex-components.ts                    # Codex plugin components
└── codex-runtime-wrapper.ts               # Codex runtime wrapper bins
```

## EXECUTION FLOW

```
doctor command
  → runner.ts: parallel check execution with 30s per-check timeout
  → checks/index.ts: getAllCheckDefinitions() (8) + getCodexCheckDefinitions() (3)
  → each check returns CheckResult: { name, status, message, details?, issues, duration? }
  → formatter.ts: render to stdout (text/status/json)
  → exit code: EXIT_CODES.SUCCESS (0) | EXIT_CODES.FAILURE (1)
```

`CheckStatus` is `pass` / `warn` (`STATUS_COLORS` also carries `fail` / `skip`). There is no `"ok"` or `"error"` status and no `detail` string field.

## KEY FILES

| File | Purpose |
|------|---------|
| `index.ts` | CLI command entry, flag parsing |
| `runner.ts` | Parallel `Promise.allSettled()` orchestration, 30s timeout per check |
| `formatter.ts` | Pretty printing: colored status, hierarchical output |
| `types.ts` | `DoctorCheck`, `CheckResult`, `DoctorReport` types |

## HOW TO ADD A CHECK

1. Create `src/cli/doctor/checks/{name}.ts` exporting check function matching `DoctorCheck`
2. Register in `checks/index.ts` — either standalone in `getAllCheckDefinitions()`, or have a category aggregator (system/config/tools/model-resolution) invoke it
3. Return a `CheckResult` (`{ name, status, message, issues }`) — no throws, all errors caught by runner
4. Add the id/name to `framework/constants.ts` `CHECK_IDS`/`CHECK_NAMES` unless registering with a literal id

## EXIT CODES

`framework/constants.ts` `EXIT_CODES` defines only:

- `SUCCESS: 0` — all checks passed
- `FAILURE: 1` — one or more failures
