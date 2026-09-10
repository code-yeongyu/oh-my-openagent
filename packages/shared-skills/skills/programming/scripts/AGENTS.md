# programming/scripts — Project Generators and Rule Checkers

## OVERVIEW

The only executable surface of the otherwise Markdown-only `programming` skill: per-language project generators plus the no-excuse rule checkers the skill's gates invoke. Earned this file at score 9 (21 files, ~3.2k LOC, four language lanes) because the parent skill guide documents prose references, not these tools.

## WHERE TO LOOK

| Need | File |
|------|------|
| Python project / script scaffold | `python/new-project.py`, `python/new-script.py` |
| Rust project scaffold | `rust/new-project.py` |
| Go project scaffold + templates | `go/new-project.py`, `go/templates/` |
| TypeScript project scaffold | `typescript/new-project.ts` |
| Policy gates | `python/check-no-excuse-rules.py` (687 LOC, AST-based), `rust/check-no-excuse-rules.{py,sh}`, `go/check-no-excuse-rules.sh`, `typescript/check-no-excuse-rules.ts` |

`go/templates/` holds the emitted project fragments (`main.go.tmpl`, `config.go`, `run.go`, `Taskfile.yml`, `ci.yml`, `README.md.tmpl`, `AGENTS.md.tmpl`, `gitignore`).

## CONVENTIONS

- Python tools are PEP 723 single-file scripts run through `#!/usr/bin/env -S uv run --script`, with Typer/Rich CLIs and a guarded `main()`; TypeScript tools are `#!/usr/bin/env bun`.
- Generated projects are strict by construction: Python 3.13 + basedpyright `all` + Ruff `ALL`, Rust edition 2024 with deny.toml and toolchain-qualified lints, Go with Taskfile and `slog`, TypeScript with strict compiler settings.
- Checkers take file-or-directory arguments, report each violation with its path, and expose only the documented opt-out markers (`# noqa:` rules for Python, `no-excuse-ok:` comments for TypeScript).
- Only `typescript/check-no-excuse-rules.ts` has a colocated test; the generators are verified by running them.

## ANTI-PATTERNS

- Do not weaken or bypass a checker rule to make a file pass; the opt-out markers are the sanctioned escape hatch.
- Do not let a scaffold emit banned patterns (`asyncio`, pandas, `Any`, bare dict returns, `log`/`fmt` logging in Go libraries).
- Do not edit generated output by hand when the template under `go/templates/` is the source of truth.

## COMMANDS

```bash
uv run new-project.py <name> [--path <dir>] [--lib]   # python/, rust/, go/
uv run new-script.py <name> [--deps <pkg>] [--py 3.13]
bun run new-project.ts <name> [--path <dir>]
uv run scripts/python/check-no-excuse-rules.py <changed paths>
bash scripts/rust/check-no-excuse-rules.sh <changed paths>
bun run scripts/typescript/check-no-excuse-rules.ts <changed paths>
```
