# utils — Shared Utilities (Core)

**Generated:** 2026-06-16

## OVERVIEW

Harness-neutral pure-TypeScript core package (`@oh-my-opencode/utils`). Consumed by both adapters (`packages/omo-opencode`, `packages/omo-codex`) and 15+ sibling Core packages. Barrel-exports 36 modules across runtime shims, config tooling, file utilities, prompt gating, git parsing, migration maps, and codegraph primitives.

## CATEGORY MAP

| Group | Key Files | Role |
|-------|-----------|------|
| **Config** | `omo-config.ts`, `omo-config/loader.ts` | Harness-aware JSONC config loader with `[codex]`/`[opencode]`/`[omo]` block merging; `validateOmoConfig()` |
| **Deep Merge** | `deep-merge.ts` | `deepMerge()` — recursive, prototype-pollution safe (`__proto__`/`constructor`/`prototype` filtered), max depth 50 |
| **Frontmatter** | `frontmatter.ts` | `parseFrontmatter()` — default YAML (`js-yaml` JSON_SCHEMA) + rule-mode parser with multiline glob arrays |
| **File Utils** | `file-utils.ts`, `atomic-write.ts`, `xdg-data-dir.ts` | Symlink resolution, atomic writes with tolerant fsync, XDG data dir with tmp fallback |
| **Runtime Shims** | `runtime/spawn.ts`, `runtime/which.ts`, `runtime/file.ts` | `spawn()` / `spawnSync()` — prefers `Bun.spawn`, falls back to Node `child_process`; unified `SpawnedProcess` interface |
| **Prompt Gate** | `prompt-async-gate.ts` + `prompt-async-gate/*.ts` | `dispatchInternalPrompt()` — reservation + queue + semantic dedupe + live-route fallback; the mandated gate for all internal `session.prompt` calls |
| **Git Worktree** | `git-worktree/*.ts` | Porcelain status parser, diff stat collection, `formatFileChanges()` |
| **Migration** | `migration.ts`, `migration/*.ts` | Agent-name, hook-name, model-version, agent-category migration maps; `migrateConfigFile()` |
| **Command Exec** | `command-executor/execute-command.ts`, `execute-hook-command.ts` | `executeCommand()` via `node:child_process` `exec`; stderr inlined in return string |
| **Codegraph** | `codegraph/*.ts` | Workspace manifest, environment detection, provision helpers |
| **Misc** | `snake-case.ts`, `jsonc-parser.ts`, `record-type-guard.ts`, `port-utils.ts`, `logger.ts` | Key transformation, safe JSONC parse, type guards, port finder, injectable shared logger stub |

## NOTES

- **Dependencies:** `js-yaml`, `jsonc-parser` (only production deps).
- **No path aliases:** relative imports only; strict `ESNext` + `bundler` moduleResolution.
- **Runtime portability:** `runtime/spawn.ts` wraps both Bun and Node APIs so downstream packages can run under Electron-hosted OpenCode.
- **Prompt-async-gate is critical infrastructure:** every internal prompt dispatch across the plugin must route through `dispatchInternalPrompt()` to prevent duplicate injections and race conditions. See the root [`AGENTS.md`](../../AGENTS.md) "Internal message injection is dangerous" section.
