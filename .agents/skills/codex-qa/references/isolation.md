# Isolation — QA ONLY our plugin, never the user's real Codex

The whole point of this skill: exercise the omo plugin in a real Codex without
reading or writing the user's `~/.codex`, and without a real model API call. Two
levers do all the work.

## Lever 1 — an isolated `CODEX_HOME`

`CODEX_HOME` is Codex's master state root: `config.toml`, `auth.json`, sessions,
the state SQLite, plugins, and logs all hang off it (`utils/home-dir/src/lib.rs`).
Point it at a fresh temp dir and Codex reads/writes nothing else.

Gotcha: when `CODEX_HOME` is set it **must already exist** or Codex hard-errors.
`cqa_mk_isolated_home` creates it first.

`cqa_mk_isolated_home` also exports:

- `OMO_CODEX_PROJECT` + `QA_CWD` → a sandbox project dir, so the installer's
  project-local cleanup and the TUI's cwd never touch your real tree.
- `CODEX_LOCAL_BIN_DIR=$CODEX_HOME/bin` → component bins land in the sandbox.
  (Even without this, a non-default `CODEX_HOME` already routes bins to
  `$CODEX_HOME/bin`; with the DEFAULT home they would leak to `~/.local/bin`.)
- `OMO_DISABLE_POSTHOG=1` + `OMO_CODEX_DISABLE_POSTHOG=1` → no install/telemetry
  network call.

Proof it stayed clean: `cqa_guard_real_home` shasums `~/.codex/config.toml`
before, `cqa_assert_real_home_unchanged` re-checks after. Every script runs it.

## Lever 2 — a local mock model (no real API)

Codex must reach a model to run a turn. Instead of OpenAI, we run
`scripts/lib/mock-model.mjs` (OpenAI **Responses** SSE) on localhost and point a
custom provider at it via `-c` overrides:

```
-c model="mock-model"
-c model_provider="mock_provider"
-c model_providers.mock_provider.name="codex-qa mock"   # REQUIRED: empty name fails config load
-c model_providers.mock_provider.base_url="http://127.0.0.1:<PORT>/v1"
-c model_providers.mock_provider.wire_api="responses"
-c approval_policy="never"
-c sandbox_mode="read-only"
```

A non-OpenAI provider needs no key/auth, so there is no real egress. `-c`
overrides beat any value in `config.toml`, so even a misconfigured isolated home
still lands on the mock.

## The `codex` shell-function trap

The interactive shell here wraps `codex` in a function that injects
`--profile quotio`. That breaks non-runtime subcommands like
`generate-json-schema` and would point a turn at the quotio provider. **Bash
scripts do not inherit that function**, so `codex` inside a `#!/usr/bin/env bash`
script is the real binary on PATH. `cqa_codex_bin` resolves it explicitly; never
rely on the interactive alias. Combined with the isolated `CODEX_HOME`, the real
quotio config is never read.
