# Prompt Contract Test Removal - Final Evidence Report

## Outcome

The branch removes automated contracts on authored prompt, directive,
`SKILL.md`, rule, `AGENTS.md`, and markdown-instruction prose while preserving
machine-consumed values, real artifact equality, parsing, routing, dispatch,
state, security, runtime delivery, and user-facing UI/error behavior.

## Failing-first proof

- Exact final scanner command:
  `python3 <audit_prompt_contracts.py> --classification
  <prompt-contract-classification-index.json> --compact`
- Original base `3dd88267f87bd47795d3eea7782e676bb40e2f9b`:
  exit 1; 2,291 tests; 2,421 candidates; 747 unclassified;
  94 stale active fingerprints.
- Final rebased tree:
  exit 0; 2,297 tracked tests; 1,910 candidates;
  1,910 allowed; 0 unclassified; 0 forbidden; 0 stale.
- Exact base inventory:
  `red-prompt-contract-scan-post-quality.txt`.
- Exact pre-rebase summary and scanner/classification hashes:
  `green-prompt-contract-scan-post-quality.txt`.
- Exact final rebased summary:
  `green-prompt-contract-scan-rebased.txt`.

## Policy

- Root rule: `AGENTS.md`.
- Repository-test rule: `tests/AGENTS.md`.
- RED: `red-agents-policy-audit.txt`.
- GREEN: `green-agents-policy-audit.txt`.
- Reviewer-readable diff: `agents-policy-diff.txt`.

## Automated verification

- `bun run typecheck`: exit 0 across root, scripts, and every package.
- `bun test`: 15,613 passed, 0 failed, 7 existing platform/TUI skips,
  131,764 assertions, 2,048 files.
- `bun run build`: exit 0.
- `bun run test:codex`: exit 0; final Node section 492/492 passed.
- Scanner regression suite: 15 passed under the declared uv environment.
- Independent review blocker resolutions:
  `review-fixes.txt`.
- Post-rebase command and result ledger:
  `post-rebase-validation.txt`.
- Focused-domain totals: `focused-domain-verification.txt`.
- LSP invocation and clean changed source/helper results:
  `lsp-diagnostics.txt`.
- Scanner strict checks: pytest, Ruff, basedpyright strict,
  no-excuse checks, Node syntax, and <=250 pure LOC all passed.

## Real-surface QA

- OpenCode real local plugin:
  `opencode-serve-wake-rebased/`.
  - `RESULT=FIXED`
  - one terminal stop
  - one child task session
  - live-route dispatch
  - real DB count unchanged (exact count redacted)
- Codex real app-server:
  - isolated local plugin install
  - mock-model turn completed
  - `hook/completed`: `sessionStart`, `userPromptSubmit`, `stop`
  - real Codex config hash unchanged
- Codex isolated installer:
  - plugin cache `5.0.0-beta.8`
  - `omo@sisyphuslabs` enabled
  - 10 component bins and agent TOMLs linked
  - real Codex config hash unchanged
- Senpi local extension through xterm.js:
  `senpi-web-terminal/`.
  - screenshot, text, ANSI, metadata
  - valid tips JSON
  - help exit 0
  - invalid option exit 1
- Senpi post-rebase CLI:
  - `result=PASS`
  - `ultraworkInjected=true`
  - `commentChecker=PASS`
  - `realSenpiUntouched=true`
- Consolidated scenarios and cleanup:
  `manual-qa-summary.txt`.

## Cleanup and scope

- Removed reference-proven orphaned exports, test helpers, one dead module, and
  stale scoped documentation.
- Dead-code reference evidence:
  `dead-code-reference-audit.txt`.
- Generated CodeGraph/Senpi artifacts have zero final diff.
- Temporary detached scanner worktrees, XDG/CODEX/Senpi homes, fake servers,
  PTYs, and the LSP bridge were removed.
- No task edits remain in the dirty shared main checkout.

## Evidence hygiene

Raw secrets, environment dumps, credentials, cookies, authorization headers,
and private logs are omitted. Classification sources are hash-bound by
`prompt-contract-classification-index.json`.
