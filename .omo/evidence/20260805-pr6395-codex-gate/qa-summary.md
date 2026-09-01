# QA summary - PR #6395 - shared skills root resolution

Captured 2026-08-05 on Windows 11 with the live Codex proof and full compatibility
gate executed as the non-root `codexqa` user in Ubuntu 22.04 under WSL2.

PR head tested: `fix/6376-shared-skills-root-path`.

## What was tested

1. The complete Codex compatibility gate:

   ```text
   bun run test:codex
   ```

   This was run from a clean clone of the PR branch with Bun 1.3.14, Node
   v24.18.0, Codex CLI 0.146.0, jq 1.6, tmux 3.2a, and Python 3.11.

2. The Codex QA isolation harness:

   ```text
   bash .agents/skills/codex-qa/scripts/lib/common.sh --self-check
   ```

3. A first-party live Codex turn against the local mock model:

   ```text
   bash .agents/skills/codex-qa/scripts/app-server-drive.sh --plugin
   ```

## What was observed

- `bun run test:codex` completed with exit code 0.
- The LSP tools segment passed 25 files and 95 tests.
- The ULW loop segment passed 40 files and 420 tests.
- The permission-sensitive TOML migration file passed all 17 tests under the
  non-root user with Python 3.11 `tomllib`.
- The Codex QA self-check passed all dependency, sandbox, mock-model, cleanup,
  and real-config integrity assertions.
- The live app-server turn completed with `ok: true`, no missing hooks, no failed
  hooks, and the mock assistant response `Hello from the codex-qa mock model.`
- The notification stream contained `hook/started` and `hook/completed` records
  for plugin hooks. Completed event families were `sessionStart`, `stop`, and
  `userPromptSubmit`.
- The isolated run reported the real `~/.codex/config.toml` as `ABSENT` before
  and after the run.

Exact concise captures:

- `test-codex-proof.txt`
- `app-server-proof.txt`

## Why it is enough

The shared-skills resolver feeds the Codex plugin build. The full compatibility
gate covers the installer, generated bundles, shared skill synchronization,
Codex components, MCP runtimes, configuration migration, and package tests.
The app-server proof separately drives the real Codex protocol surface with the
local PR build installed in an isolated `CODEX_HOME` and proves first-party
plugin hook execution. Together they close the missing Codex QA coverage
reported on PR #6395.

## What was omitted

No credentials, tokens, authentication headers, environment dumps, or
secret-bearing logs were copied. Repetitive build output and the full hook list
were summarized; the decisive command, exit status, isolation assertions, hook
families, and test counts are retained in the concise captures.
