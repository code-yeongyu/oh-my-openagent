# .agents/skills/ - Executable Helper Map

**Generated:** 2026-09-10 / bee8c2ba4

## OVERVIEW

Skill helper maintenance boundary (score 10: file/subdirectory count, packaging config, LSP symbol density, module exports); the catalog and migration policy remain in `../AGENTS.md`.

## STRUCTURE

The executable QA skills use this layout; instruction-only skills need only their entry file.

```text
<skill>/
|- SKILL.md       # Routing and invocation contract
|- references/    # Protocol details separated from the entry prompt
`- scripts/       # Executable drivers
   `- lib/       # Sourced shell helpers and subprocess fixtures
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Codex result assertions | `codex-qa/scripts/lib/app-server-client.mjs` | `parseExpectedHooks`, `summarizeRun`; colocated `.test.js` imports both. |
| Codex sandbox and mock lifecycle | `codex-qa/scripts/lib/common.sh` | `cqa_*` helpers; `mock-model.mjs` is the subprocess provider. |
| OpenCode sandbox and server lifecycle | `opencode-qa/scripts/lib/common.sh` | `oqa_*` helpers; `fake-openai-*.mjs` splits provider events and branches. |
| Cross-harness LSP scenarios | `codex-qa/scripts/lsp-e2e.sh`, `opencode-qa/scripts/lsp-e2e.sh` | Largest drivers; dispatch via `--scenario` and `--evidence-dir`. |
| Server split/wake regression | `opencode-qa/scripts/serve-wake-split-probe.sh` | Separate process/evidence probe, not the basic server smoke script. |
| Senpi resolver implementation | `senpi-qa/scripts/resolve-evidence-dir.mjs` | Import-safe module plus guarded Node CLI; colocated `.test.mjs`. |
| GitHub fetcher dependencies | `github-triage/scripts/gh_fetch.py` | Standalone PEP 723 Python script; `uv` supplies Typer and Rich. |

## CONVENTIONS

- Shell-sourced `cqa_*` and `oqa_*` APIs register resources in globals for `EXIT` cleanup. Both common libraries use `set -uo pipefail`; OpenCode probes deliberately inspect failure responses rather than enabling blanket `set -e`.
- `summarizeRun` requires a completed turn, every expected hook completed, and no failed hook result; assistant text alone is not success.
- Check the actual helper's flags: common libraries use `--self-check`, while drivers expose their own `--self-test` or scenario modes.

## ANTI-PATTERNS

- Never wrap `cqa_mk_isolated_home`, `cqa_start_mock`, `oqa_mk_isolated_xdg`, or `oqa_start_server` in command substitution: the subshell loses exports and cleanup registration.
- Do not remove `oqa_preserve_home_opencode_bin` when changing HOME isolation; installed wrappers may resolve their binary through `$HOME/.opencode/bin`.
- Do not confuse OpenCode DB-read helpers with server-spawning QA: the former intentionally inspect the live DB read-only; the latter must use the sandbox.
- Do not treat `gh_fetch.py`'s 50-row Rich table as the full fetch result; preserve exhaustive pagination independently of display truncation.
