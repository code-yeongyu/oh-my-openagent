# QA Evidence: fix-5751

## What Was Tested

- Issue context: `gh issue view 5751 --repo code-yeongyu/oh-my-openagent --json title,body,comments`.
- Failing-first regression: `PATH="$HOME/.bun/bin:$PATH" bun test packages/omo-codex/src/install/codex-config-permissions.test.ts`.
- Codex package suite: `PATH="$HOME/.bun/bin:$PATH" bun test packages/omo-codex`.
- Hermetic Codex gate: `PATH="$HOME/.bun/bin:$PATH" bun run test:codex`.
- Typecheck: `PATH="$HOME/.bun/bin:$PATH" bun run typecheck`.
- codex-qa isolation harness: `bash .agents/skills/codex-qa/scripts/lib/common.sh --self-check`.
- codex-qa installer surface: `bash .agents/skills/codex-qa/scripts/install-verify.sh --self-test`.
- Isolated unreadable installer path: temporary `CODEX_HOME` with `config.toml` mode `0200`, then `node packages/omo-codex/scripts/install-local.mjs install`.

## What Was Observed

- `red-regression-only.txt`: the new test failed before the product fix because `updateCodexConfig()` resolved instead of rejecting.
- `green-regression-only.txt`: the same regression passed after the ENOENT-only read guard.
- `green-bun-test-packages-omo-codex-after-materialize.txt`: `255 pass, 0 fail`.
- `test-codex.txt`: `bun run test:codex` completed successfully, including generated installer tests.
- `typecheck.txt`: `bun run typecheck` completed successfully.
- `codex-qa-common-self-check.txt`: isolated `CODEX_HOME` was created and removed; real `~/.codex/config.toml` checksum stayed unchanged.
- `codex-qa-install-verify.txt`: local omo installed in an isolated `CODEX_HOME`; plugin cache, config, bins, and agents were present; real `~/.codex/config.toml` checksum stayed unchanged.
- `codex-qa-unreadable-isolated-install.txt`: installer exited `1` on unreadable isolated config, preserved `[user] important = "keep"`, and real `~/.codex/config.toml` checksum stayed unchanged.

## Why It Is Enough

- The regression proves the original bug before the fix and the corrected behavior after the fix at the `updateCodexConfig()` seam.
- The isolated installer proof drives the real local installer against an unreadable `CODEX_HOME/config.toml`, showing the user-facing install path now fails before writing.
- The codex-qa installer script proves ordinary isolated installs still work and do not touch the real Codex config.
- `test:codex`, package tests, and typecheck cover generated installer parity and broader Codex installer compatibility.

## What Was Omitted

- No real `~/.codex` install was run. All Codex installer QA used isolated `CODEX_HOME` sandboxes.
- Raw temporary installer directories were removed after assertions.
- No GitHub issue comments were posted.

## Notes

- Initial setup without `~/.bun/bin` on `PATH` failed because `bun` was not found.
- Setup with `~/.bun/bin` installed dependencies but the build failed while strict submodule materialization tried stale local submodule URLs. The submodule URLs were synced from `.gitmodules` and updated via HTTPS inside this worktree only before rerunning materialization and QA.
