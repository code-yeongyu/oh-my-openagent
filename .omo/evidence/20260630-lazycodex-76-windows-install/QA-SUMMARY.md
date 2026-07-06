# LazyCodex #76 Windows Install Command QA

## What Was Tested

- `node --test packages/omo-codex/scripts/install-delegated-command.test.mjs packages/omo-codex/scripts/install-cli-args.test.mjs packages/omo-codex/scripts/install-local-entrypoint.test.mjs packages/omo-codex/plugin/test/node-install-surface.test.mjs`
  - Proves LazyCodex dry-run install delegation emits direct package commands and the docs do not recommend the Windows-broken indirect `npx --package ... omo install` shape.
  - Artifact: `node-focused-tests.txt`.
- `bun test script/publish-lazycodex-workflow.test.ts script/lazycodex-published-smoke-workflow.test.ts`
  - Proves CI/publish smoke expectations pin the Windows-safe install command and keep doctor routed through the Codex workflow.
  - Artifact: `workflow-tests.txt`.
- `node packages/omo-codex/scripts/install-local.mjs --dry-run install --platform=codex --no-tui --codex-autonomous`
  - Manual CLI surface proof that the installer prints `npx --yes oh-my-openagent@latest install --platform=codex --no-tui --codex-autonomous`.
  - Artifact: `manual-dry-run.txt`.
- Temporary npx package exposing a `lazycodex-ai` bin wired to this local installer, run as `npx --yes --package <tmp-package> lazycodex-ai --dry-run install --platform=codex --no-tui --codex-autonomous`
  - Manual npx-bin surface proof for the same dry-run command shape without using the already-published npm package.
  - Artifact: `npx-local-bin-dry-run.txt`.
- `bash .agents/skills/codex-qa/scripts/install-verify.sh --self-test`
  - Isolated `CODEX_HOME` install proof for the local build; confirms plugin cache/config/bin/agent landing and real `~/.codex/config.toml` unchanged.
  - Artifact: `codex-install-verify.txt`.
- `bun run test:codex`
  - Hermetic Codex compatibility gate, including generated installer and Windows Git Bash preflight tests.
  - Artifact: `test-codex.txt`.

## Observed Result

All commands exited 0. `test-codex.txt` reports 436 passing tests and 0 failures. `manual-dry-run.txt` and `npx-local-bin-dry-run.txt` contain the Windows-safe direct package invocation. `codex-install-verify.txt` reports the real `~/.codex/config.toml` checksum unchanged.

## Why This Is Enough

The regression was a bad LazyCodex install delegation command shape. The source builder, generated installer bundle, direct Node entrypoint surface, CI smoke guard, publish smoke guard, and docs guard all now assert the direct package invocation form. Doctor remains separate and is still checked as a Codex workflow command, not forced through OmO install delegation.

## What Was Omitted

No native Windows VM was driven in this turn. The focused tests include Windows-specific installer/preflight coverage, and the manual dry-run plus local npx-bin smoke exercise the command string that failed for the reporter. No secret-bearing logs were copied.
