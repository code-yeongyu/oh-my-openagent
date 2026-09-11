# What was observed

## Remote regression gate

`task-gate-b-remote-tests.log` records `REMOTE_HEAD=3451c0a8b4d872a43523a5b9b54073bbd30f850f` and exactly six `TEST_EXIT=0` lines. Its SHA-256 is `4ff660221c2d13a09119a02226d54549ea14244737918c8ce5db89fc56ca292d`, verified again during todo 14.

| Gate | Observed result |
| --- | --- |
| ulw-loop | 54 files, 547 tests passed |
| ultrawork | 5 files, 24 tests passed |
| ulw-execute-continuation | 3 files, 43 tests passed |
| Plugin Node aggregate | 327 passed, 0 failed, 0 skipped |
| prompts-core and installer freshness | 28 passed, 0 failed |
| test:codex | Component stages: 97 and 547 passed. Bun stage: 418 passed, 1 existing Windows-only skip, 0 failed. Node stage: 486 passed, 0 failed. |

The skipped case is the Windows named-pipe daemon ownership test on macOS, not a newly skipped failure. The primary was mengmotaMac; gorky was an unused fallback for this final gate, not a fleet fanout. The receipt explicitly records `/tmp/lcx-gate-b5-20260908 REMOVED`. `task-12-remote-cleanup.log` also closes the four earlier setup-directory cleanup gaps.

The task-start HEAD was `8dde4e843eecbe1ed9e6d4cc26402531d0d0ba24`. Its only changes after the remotely tested SHA are evidence files. Todo 14 likewise makes no product changes.

## Verifier rounds

`task-14-verifier-rounds.json` preserves the six completed verifier responses, including earlier failures rather than replacing them with a blanket pass.

1. `st_01a080d5` / verify-b: needs-fix; found acceptor, hook-shape/order, incomplete remote execution, drift, installation, and cleanup problems.
2. `st_01a080f9` / verify-b2: needs-fix; implementation repairs were visible, but an obsolete checkpoint rejection and the drift inverse still failed, with coverage/evidence gaps.
3. `st_01a0810f` / verify-b3: confirmed todos 8 and 11; retained needs-fix for remaining CLI evidence, self-contained bundle/drift, breaker RED, installation, and cleanup gaps. `task-gate-b3-receipt.json` preserves the red gate results.
4. `st_01a0811b` / verify-b4: repaired snapshot checks passed, but the final gate was still stale/red and some repairs uncommitted.
5. `st_01a0812e` / verify-b5: confirmed todos 8, 9, 11, and 13 and all six remote gates. Its independent active-plan missing-manualQa CLI run closed todo 9's receipt gap. Todos 10 and 12 still needed breaker baseline RED and installed/cleanup receipts.
6. `st_01a08148` / verify-b6: confirmed todos 10 and 12, overall `GATE: confirmed`, at evidence-only HEAD 8dde4e843. Breaker baseline RED had 12 failures/28 passes, then source-overlay GREEN had 40 passes. This is retrospective baseline proof, not a claim about original TDD chronology. Installed Stop/SubagentStop probes and all outstanding cleanup receipts were accepted.

Those confirmations precede the newly observed todo-14 native hook-count discrepancy; they do not certify that assertion.

## Fresh local build and installed-harness results

- Installer rebuild, actual plugin build, and local tsgo all exited 0. `git status --porcelain` was empty after both builds. No installer source or committed bundle changed.
- Install self-test and fresh install exited 0. The isolated plugin cache, enabled config entry, nine component bins, and agent TOMLs were present.
- The full installed marketplace manifest has **21 hook paths**. The native macOS installed cache has **19**. Both include `post-tool-use-recording-spawn-admission.json` and exclude `subagent-stop-checking-ulw-execute-continuation.json`.
- The two filtered paths are `pre-tool-use-recommending-git-bash-mcp.json` and `post-compact-resetting-git-bash-mcp-reminder.json`. `removeGitBashHooksOffWindows` in `packages/omo-codex/src/install/codex-git-bash-hooks.ts` already does this at the branch base; PR B does not change it. Therefore the literal 21-hook native-cache assertion remains failed, and the QA runner deliberately exits 1 after completing the other proofs.
- Both real app-server turns returned `ok: true`, `turnStatus: completed`, and the mock assistant response. The plugin run has no missing or failed hooks and matching started/completed notifications for `session-start-loading-project-rules.json` and `user-prompt-submit-checking-ultrawork-trigger.json`. Stop hooks also completed. See `task-14-app-server.json`.
- Codex stderr warns that helper PATH aliases cannot be created under the temporary directory and that the worktree's project-local configuration is untrusted/disabled. These warnings are retained; they did not prevent the isolated installed plugin notifications or completed turn.

Initial QA-wrapper failures remain in `task-14-*-initial.log`, `task-14-*-cache-assertion.log`, and `task-14-*-noncanonical-path.log`. The first was the macOS mktemp placement assumption. The cache assertion exposed the platform distinction. The noncanonical `/var` script path caused the Node entrypoint guard to skip execution; empty summaries were rejected and never counted as live QA. The canonical-path run supplies the actual notification evidence. All task-owned sandboxes were removed with receipts.

Real `~/.codex/config.toml` SHA-1 before: `b012e531f5aa9fb1bce9003593c3eadf07081fcd`; after: `b012e531f5aa9fb1bce9003593c3eadf07081fcd`.
