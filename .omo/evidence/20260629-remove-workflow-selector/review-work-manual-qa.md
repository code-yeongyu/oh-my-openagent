# PR 5745 Manual QA

Goal: verify PR #5745 removes the Codex Light opt-in workflow selector from runtime wiring while preserving existing Codex hooks for rules, ultrawork, ulw-loop, CodeGraph, and related surfaces.

Tier: HEAVY. Justification: Codex hook/runtime wiring changed, and the assignment requested hands-on QA review.

Skills used:
- codex-qa: required because this is `packages/omo-codex` live hook/runtime QA.

Verdict: PASS with high confidence.

## manualQa

### surfaceEvidence
| scenario id | criterion reference | surface | exact invocation | verdict | artifactRefs |
|---|---|---|---|---|---|
| S1 | Target branch/commit match assignment | git CLI | `git -C /Users/yeongyu/local-workspaces/omo-wt/code-yeongyu-remove-codex-workflow-selector status --short --branch && git -C /Users/yeongyu/local-workspaces/omo-wt/code-yeongyu-remove-codex-workflow-selector rev-parse HEAD && git -C /Users/yeongyu/local-workspaces/omo-wt/code-yeongyu-remove-codex-workflow-selector branch --show-current` | PASS | A1 |
| S2 | Runtime selector references absent | filesystem CLI | `rg -n "workflow-selector|selecting-lazycodex-workflow|OMO_CODEX_AUTO_WORKFLOW" packages/omo-codex/plugin/package.json packages/omo-codex/plugin/package-lock.json packages/omo-codex/plugin/.codex-plugin/plugin.json packages/omo-codex/plugin/hooks packages/omo-codex/plugin/components --glob '!**/test/**' --glob '!**/dist/**' --glob '!**/node_modules/**'` | PASS | A2 |
| S3 | Existing Codex hooks still fire in live isolated Codex app-server | codex app-server notification stream evidence | `bash .agents/skills/codex-qa/scripts/app-server-drive.sh --plugin` from existing evidence, then `node -e <parse app-server JSON and assert hook list>` | PASS | A3, A4 |
| S4 | Manifest/package wiring removed selector but retained required hooks/components | filesystem/data CLI | `node -e <assert package/manifest/hook/component wiring>` | PASS | A5 |
| S5 | PR CI matrix health | GitHub CLI | `gh pr checks 5745 --repo code-yeongyu/oh-my-openagent` | PASS | A6 |
| S6 | Existing QA bundle is present and non-empty | filesystem CLI | `find .omo/evidence/20260629-remove-workflow-selector -maxdepth 1 -type f -print | sort` plus `sed -n` inspection of `SUMMARY.md` and logs `01-09` | PASS | A7-A16 |

### adversarialCases
| scenario id | criterion reference | adversarial class | expected behavior | verdict | artifactRefs |
|---|---|---|---|---|---|
| A-SEL-1 | No hidden runtime opt-in selector | residual runtime string scan | Runtime package, manifest, hook, and component paths contain no `workflow-selector`, `selecting-lazycodex-workflow`, or `OMO_CODEX_AUTO_WORKFLOW` hits. | PASS | A2 |
| A-SEL-2 | Residual strings are harmless | broad string scan including tests | Any remaining selector-related strings are confined to tests/fixtures asserting absence or preserving old transcript behavior. | PASS | A17 |
| A-HOOK-1 | Removing selector must not remove userPromptSubmit chain | live hook regression | Live isolated Codex turn still reports started/completed `user-prompt-submit-loading-project-rules`, `user-prompt-submit-checking-ultrawork-trigger`, and `user-prompt-submit-checking-ulw-loop-steering`; no selector hook appears. | PASS | A3, A4 |
| A-HOOK-2 | Removing selector must not remove CodeGraph bootstrap | live hook regression | Live isolated Codex turn still reports `session-start-checking-codegraph-bootstrap`. | PASS | A3, A4 |
| A-PKG-1 | Removed component not still installed through package metadata | package-lock/manifest regression | `package.json`, `package-lock.json`, `.codex-plugin/plugin.json`, hooks dir, and components dir have no workflow selector wiring; required `codegraph`, `rules`, `ultrawork`, `ulw-loop`, `lsp` remain present. | PASS | A5 |
| A-CI-1 | Cross-platform compatibility regression | CI matrix | macOS, Ubuntu, and Windows codex compatibility/test/typecheck checks pass. | PASS | A6 |

### artifactRefs
| id | kind | description | path |
|---|---|---|---|
| A1 | command transcript | Target worktree branch and commit confirmed during setup. | terminal transcript in this QA session |
| A2 | command artifact | Targeted runtime absence scan, no runtime selector hits. | `.omo/evidence/20260629-pr5745-manual-qa/01-targeted-runtime-absence.txt` |
| A3 | existing live app-server artifact | codex-qa isolated app-server plugin drive JSON, hook notifications, home isolation proof. | `.omo/evidence/20260629-remove-workflow-selector/09-codex-app-server-drive-plugin.json` |
| A4 | derived command artifact | Parsed app-server hook summary asserting required hooks and no selector hook. | `.omo/evidence/20260629-pr5745-manual-qa/03-app-server-hook-list.txt` |
| A5 | command artifact | Manifest/package/hook/component wiring assertion. | `.omo/evidence/20260629-pr5745-manual-qa/05-manifest-package-wiring.txt` |
| A6 | command artifact | `gh pr checks 5745` CI matrix output. | `.omo/evidence/20260629-pr5745-manual-qa/02-gh-pr-checks.txt` |
| A7 | existing summary | Existing PR evidence summary inspected. | `.omo/evidence/20260629-remove-workflow-selector/SUMMARY.md` |
| A8 | existing build artifact | Bun install and build, component build list excludes workflow-selector. | `.omo/evidence/20260629-remove-workflow-selector/01-bun-install.txt` |
| A9 | existing test artifact | Aggregate manifest/hooks tests. | `.omo/evidence/20260629-remove-workflow-selector/02-aggregate-tests.txt` |
| A10 | existing test artifact | Component bundled CLI tests. | `.omo/evidence/20260629-remove-workflow-selector/03-component-bundled-cli.txt` |
| A11 | existing command artifact | Runtime absence check. | `.omo/evidence/20260629-remove-workflow-selector/04-runtime-absence-check.txt` |
| A12 | existing test artifact | Plugin npm test. | `.omo/evidence/20260629-remove-workflow-selector/05-plugin-npm-test.txt` |
| A13 | existing gate artifact | `bun run test:codex`. | `.omo/evidence/20260629-remove-workflow-selector/06-bun-test-codex.txt` |
| A14 | existing codex-qa artifact | codex-qa common self-check and real `~/.codex/config.toml` unchanged proof. | `.omo/evidence/20260629-remove-workflow-selector/07-codex-qa-common-self-check.txt` |
| A15 | existing codex-qa artifact | Isolated install verification and real `~/.codex/config.toml` unchanged proof. | `.omo/evidence/20260629-remove-workflow-selector/08-codex-install-verify.txt` |
| A16 | existing live app-server artifact | Same as A3; listed for complete logs 01-09 coverage. | `.omo/evidence/20260629-remove-workflow-selector/09-codex-app-server-drive-plugin.json` |
| A17 | command artifact | Broad residual string scan showing only test-only residual hits. | `.omo/evidence/20260629-pr5745-manual-qa/04-broad-residual-string-scan.txt` |

## cleanup

No product files edited. New QA artifacts are under `.omo/evidence/20260629-pr5745-manual-qa/`. No long-running processes were started by this review.
