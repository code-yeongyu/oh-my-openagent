# Release Gate Test Slop Evidence

## Success Criteria

- Scenario: `setup.sh` offline tolerance for failing provenance submodule and frontend materialization commands.
  Invocation: `bun test script/agent-env.test.ts script/agent-setup-offline.test.ts`.
  Binary observable: `script/agent-setup-offline.test.ts` passed after fake `git submodule` and fake `node materialize-frontend-refs.mjs` failed; stdout contained both warning messages and the later skip-build message.
  Artifact: `.omo/evidence/20260622-release-gate-test-slop/bun-test-agent-env-and-setup-offline.txt`.

- Scenario: LazyCodex auto-update started notice avoids full-string pinning.
  Invocation: `node --test packages/omo-codex/plugin/test/auto-update-restart-notice.test.mjs`.
  Binary observable: 7 Node tests passed; started notice assertions cover version transition, background install, new-session recommendation, preferred tone instruction, and release-notes-unavailable fallback.
  Artifact: `.omo/evidence/20260622-release-gate-test-slop/node-test-auto-update-restart-notice-rerun.txt`.

- Scenario: whitespace/conflict hygiene.
  Invocation: `git diff --check`.
  Binary observable: exit 0, no output after the command banner.
  Artifact: `.omo/evidence/20260622-release-gate-test-slop/git-diff-check-rerun.txt`.

- Scenario: focused TypeScript check for changed script tests.
  Invocation: `bun run typecheck:script`.
  Binary observable: `tsgo --noEmit -p script/tsconfig.json` exited 0.
  Artifact: `.omo/evidence/20260622-release-gate-test-slop/typecheck-script-rerun.txt`.

- Scenario: focused MJS syntax check.
  Invocation: `node --check packages/omo-codex/plugin/test/auto-update-restart-notice.test.mjs`.
  Binary observable: exit 0.
  Artifact: `.omo/evidence/20260622-release-gate-test-slop/node-check-auto-update-restart-notice-rerun.txt`.

- Scenario: suppression/slop scan on changed test files.
  Invocation: `rg -n "as any|@ts-ignore|@ts-expect-error|catch\\s*\\([^)]*\\)\\s*\\{\\s*\\}" script/agent-env.test.ts script/agent-setup-offline.test.ts packages/omo-codex/plugin/test/auto-update-restart-notice.test.mjs`.
  Binary observable: exit 0 from the wrapper, no matches after the command banner.
  Artifact: `.omo/evidence/20260622-release-gate-test-slop/no-suppression-scan-rerun.txt`.

- Scenario: Codex QA isolation harness self-check.
  Invocation: `bash .agents/skills/codex-qa/scripts/lib/common.sh --self-check`.
  Binary observable: dependencies present, isolated `CODEX_HOME` auto-removed, mock model served Responses SSE, real `~/.codex/config.toml` hash unchanged.
  Artifact: `.omo/evidence/20260622-release-gate-test-slop/codex-qa-common-self-check.txt`.

- Scenario: Codex deterministic local-plugin hook probe.
  Invocation: `bash .agents/skills/codex-qa/scripts/hook-unit-probe.sh --self-test`.
  Binary observable: local plugin installed into isolated `CODEX_HOME`, real `~/.codex/config.toml` hash unchanged, `ultrawork` hook injected `<ultrawork-mode>`.
  Artifact: `.omo/evidence/20260622-release-gate-test-slop/codex-qa-hook-unit-probe-rerun.txt`.

## Bootstrap Receipts

- `bun install --ignore-scripts` created workspace links in this fresh worktree without running the repo build.
  Artifact: `.omo/evidence/20260622-release-gate-test-slop/bun-install-ignore-scripts.txt`.
- `npm --prefix packages/lsp-tools-mcp ci` installed the vendored Node-targeted LSP MCP dependencies required by the Codex QA hook probe.
  Artifact: `.omo/evidence/20260622-release-gate-test-slop/npm-ci-lsp-tools-mcp.txt`.
