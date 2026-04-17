# src/cli/doctor/ — Health Diagnostics (25 Check Files)

**Generated:** 2026-04-18

## OVERVIEW

`bunx oh-my-opencode doctor` — parallel diagnostic checks across 4 categories (System, Config, Tools, Models). Catches broken installs, config typos, missing dependencies, provider misconfigurations before they become runtime errors.

## COMMAND FLAGS

```bash
bunx oh-my-opencode doctor              # Full diagnostics (all 4 categories)
bunx oh-my-opencode doctor --status     # Compact dashboard (status only)
bunx oh-my-opencode doctor --verbose    # Deep details (model resolution traces)
bunx oh-my-opencode doctor --json       # Machine-readable output
```

## CHECK CATEGORIES

| Category | File | Validates |
|----------|------|-----------|
| **SYSTEM** | `checks/system.ts` | OpenCode binary found + version ≥1.0.150, plugin registered in opencode.json, loaded plugin version matches installed |
| **CONFIG** | `checks/config.ts` | JSONC validity, Zod schema passes, no unknown keys, model override syntax correct |
| **TOOLS** | `checks/tools.ts` | AST-Grep CLI + NAPI, comment-checker binary, LSP servers reachable, GitHub CLI auth, built-in MCP reachability |
| **MODELS** | `checks/model-resolution.ts` | models.json cache exists, per-agent fallback resolution, category overrides valid, provider availability |

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
├── model-resolution-config.ts             # oh-my-opencode.jsonc parse
├── model-resolution-effective-model.ts    # Per-agent fallback chain trace
├── model-resolution-variant.ts            # Model variant (max, high, medium) handling
├── model-resolution-details.ts            # Verbose output formatter
└── model-resolution-types.ts              # Shared types
```

## EXECUTION FLOW

```
doctor command
  → runner.ts: parallel check execution with 30s per-check timeout
  → checks/index.ts registers all 4 category checks
  → each check returns: { status: "ok" | "warn" | "error", detail: string }
  → formatter.ts: render to stdout (text/status/json)
  → exit code: 0 (all ok) | 1 (errors) | 2 (warnings only)
```

## KEY FILES

| File | Purpose |
|------|---------|
| `index.ts` | CLI command entry, flag parsing |
| `runner.ts` | Parallel `Promise.allSettled()` orchestration, 30s timeout per check |
| `formatter.ts` | Pretty printing: colored status, hierarchical output |
| `types.ts` | `DoctorCheck`, `CheckResult`, `DoctorReport` types |

## HOW TO ADD A CHECK

1. Create `src/cli/doctor/checks/{name}.ts` exporting check function matching `DoctorCheck`
2. Register in `checks/index.ts`
3. Category-level aggregator (system/config/tools/model-resolution) invokes it
4. Return `{ status, detail }` — no throws, all errors caught by runner

## EXIT CODES

- `0`: All checks passed (or only info messages)
- `1`: One or more errors — plugin will likely not work
- `2`: Warnings only — plugin works with degraded features
