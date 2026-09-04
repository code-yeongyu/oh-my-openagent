# Issue 5838 Visual QA Completion Gate

## What was tested

- Reviewed the canonical shared frontend skill before and after the move.
- Verified the existing dual-oracle contract moved from line 139 to the
  truncation-safe opening block without weakening its browser, viewport,
  interaction, motion, or fresh-evidence requirements.

## What was observed

- Before: the completion contract appeared after all routing and ruleset prose.
- After: it appears immediately after the quality bar and before Phase 0.

## Why this evidence is enough

This is a pure prompt-ordering fix, so behavior tests would pin prose rather
than a machine contract.

## Additional verification

- Exact commands are recorded in [commands.txt](./commands.txt).
- Shared-skill suite: `85 pass, 0 fail`
  ([shared-skills-tests.txt](./shared-skills-tests.txt)).
- Canonical/OpenCode checked-in artifact parity: `3 pass, 0 fail`
  ([artifact-parity-tests.txt](./artifact-parity-tests.txt)).
- The complete plugin build finished successfully and synchronized the
  canonical frontend skill into the packaged trees
  ([opencode-build.txt](./opencode-build.txt)).
- The OpenCode QA harness self-check passed with an isolated XDG home
  ([opencode-common-self-check.txt](./opencode-common-self-check.txt)).
- The isolated OpenCode server returned a healthy version, exposed 162 API
  paths, enforced authentication, and left the real database at 8,067
  sessions before and after
  ([opencode-server-smoke.txt](./opencode-server-smoke.txt)).
- Full `test:codex` gate passed: 97 LSP MCP tests, 508 component tests,
  415 Bun tests with one skip, and 484 Node tests
  ([codex-gate.txt](./codex-gate.txt)).
- The Codex QA harness self-check used an isolated `CODEX_HOME` and local mock
  model while leaving the real config hash unchanged
  ([codex-common-self-check.txt](./codex-common-self-check.txt)).
- Isolated install verification passed for the plugin cache, config
  enablement, nine component bins, and agent TOMLs
  ([codex-install-verify.txt](./codex-install-verify.txt)).
- The real Codex app-server completed a mock-model turn and emitted
  `hook/started` and `hook/completed` notifications for session start, prompt
  submission, and stop hooks
  ([codex-app-server-drive.json](./codex-app-server-drive.json)).

## What was omitted

- No private prompt content, credentials, auth headers, tokens, or user session
  data were captured.
- Raw outputs include only synthetic sandbox paths and hashes, never sandbox
  credentials or real config contents.
