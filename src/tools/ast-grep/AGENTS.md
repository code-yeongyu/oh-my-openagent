# src/tools/ast-grep/ -- AST-Aware Search and Rewrite

**Generated:** 2026-05-18

## OVERVIEW

Two always-on tools: `ast_grep_search` (find AST patterns) and `ast_grep_replace` (rewrite AST patterns). 25 languages supported via `@ast-grep/napi` as primary backend with fallback to `sg` CLI.

Pattern syntax uses AST meta-variables, not regex. `$VAR` matches one AST node. `$$$` matches zero or more nodes. `$$$VAR` captures a named list. Patterns must be complete, parseable source code.

`ast_grep_replace` defaults to dry-run. Pass `dryRun=false` to apply changes.

## FILE CATALOG

| File | Role |
|------|------|
| `tools.ts` | `createAstGrepTools` factory -- returns Record with 2 tool entries |
| `cli.ts` | `runSg` -- spawns sg process, handles two-pass rewrite |
| `cli-binary-path-resolution.ts` | Async init wrapper with singleton promise dedup |
| `sg-cli-path.ts` | Resolve sg via node_modules, platform subpackages, Homebrew, or cache |
| `downloader.ts` | Auto-download from GitHub releases if missing |
| `environment-check.ts` | Verify CLI + NAPI availability at startup |
| `language-support.ts` | 25 CLI languages + 5 NAPI languages + extension map |
| `pattern-hints.ts` | Detect regex misuse and language-specific mistakes |
| `result-formatter.ts` | Format matches with file:line:column for LLM |
| `sg-compact-json-output.ts` | Parse `sg --json=compact` into `SgResult` |
| `tool-descriptions.ts` | Tool description constants |
| `process-output-timeout.ts` | 300s timeout wrapper for spawn |
| `types.ts` | `CliMatch`, `SgResult`, `AnalyzeResult`, etc. |
| `constants.ts` | Re-exports from language-support, environment-check, sg-cli-path |
| `index.ts` | Barrel |

## KEY BEHAVIORS

- Dual binary detection: NAPI primary, CLI fallback
- Fallback chain: node_modules → platform subpackage → Homebrew → cached download
- Dry-run protection: `ast_grep_replace` defaults to preview; pass `dryRun=false` to apply
- Two-pass rewrite: when rewrite + apply both requested, cli.ts runs `--json=compact` first, then `--update-all`
- Output limits: 1MB max output or 500 matches, whichever comes first
- Timeout: 300s cap via `process-output-timeout.ts`; kills process and returns truncated result

## LANGUAGES

25 CLI languages: bash, c, cpp, csharp, css, elixir, go, haskell, html, java, javascript, json, kotlin, lua, nix, php, python, ruby, rust, scala, solidity, swift, typescript, tsx, yaml.

5 NAPI languages (native bindings): html, javascript, tsx, css, typescript.

## PATTERN HINTS

When a search returns zero matches, `pattern-hints.ts` scans for regex-style misuse (`|`, `.*`, `\w`, `[a-z]`) and returns a corrective hint redirecting to ast-grep meta-variable syntax. Also catches language-specific mistakes like trailing colons in Python def/class patterns or incomplete function signatures in JS/Go/Rust.

## RELATED

Doctor check at `src/cli/doctor/checks/tools.ts` verifies both NAPI and CLI availability.
