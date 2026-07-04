# PR #5448 Security/Safety Code Review

Reviewed commit: `0fc481122d3414ec8aba42c7fc80efe1ec82da82`
Worktree: `/Users/yeongyu/local-workspaces/omo-wt/fix-codex-codegraph-bootstrap-node26`
Verdict: PASS
codeQualityStatus: WATCH
recommendation: APPROVE
blockers: none

## Skill-Perspective Check

- Loaded and applied `code-review`.
- Loaded and applied `codex-security:security-diff-scan` in terminal/chat fallback mode. Capability preflight returned `ready`; delegated workers were unavailable, so this was a parent-agent diff review rather than app-orchestrated exhaustive scan.
- Loaded and applied `programming` plus the TypeScript reference.
- Loaded and applied `remove-ai-slops`.
- `remove-ai-slops` perspective: no deletion-only, tautological, removal-only, or implementation-constant-only tests found. The new tests exercise observable worker behavior.
- `programming` perspective: production source stays under the 250 pure-LOC ceiling. The touched test file was already oversized and this diff grows it from 504 to 545 pure LOC, which is a non-blocking maintainability violation noted under LOW.

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

None.

### LOW

1. `packages/omo-codex/plugin/components/codegraph/test/hook.test.ts:250`
   Symptom: The diff adds more cases to an already oversized test file.
   Cause: `hook.test.ts` is 545 pure LOC after the change, up from 504 pure LOC before the change.
   Fix: Split the SessionStart worker/provisioning cases into a focused test file in a follow-up. This is not a security blocker for this PR because the added tests are relevant and behavior-focused.

## Security/Safety Review

- Falling through to `ensureProvisioned` does not introduce a PATH-command execution path. Under unsupported local Node, `path` commands still fail `canUseResolvedCommand` at `packages/omo-codex/plugin/components/codegraph/src/session-start-worker.ts:106`, and the worker uses the provisioned `binPath` returned by `ensureProvisioned` at line 117.
- `auto_provision:false` still prevents provisioning. Existing PATH-but-unsupported commands return `skipped-unsupported-node` before provisioning at `packages/omo-codex/plugin/components/codegraph/src/session-start-worker.ts:109`; missing commands return `skipped-unavailable` at line 110. The regression test pins this at `packages/omo-codex/plugin/components/codegraph/test/hook.test.ts:250`.
- `OMO_CODEGRAPH_BIN` / env / bundled / provisioned trust boundaries remain effectively unchanged for existing binaries: `env`, `bundled`, and `provisioned` resolutions remain trusted by `codegraphCommandRequiresSupportedLocalNode`, while `path` still requires supported local Node unless provisioning replaces it.
- `config.install_dir` remains respected. Provisioning writes to `config.install_dir` when set, otherwise to `HOME/.omo/codegraph`, via `installDir = config.install_dir ?? join(homeDir, ".omo", "codegraph")` at `packages/omo-codex/plugin/components/codegraph/src/session-start-worker.ts:112`.
- I did not find a new path traversal sink in the changed logic. The changed code does not derive paths from the unusable PATH command; it passes the configured install directory or the default HOME store into the existing provisioner.
- The provisioner uses the fixed CodeGraph manifest and checksum validation before install at `packages/utils/src/codegraph/provision.ts:203` and `packages/utils/src/codegraph/provision.ts:223`.
- Evidence scan found no committed tokens, auth headers, cookies, API keys, or private config contents. Evidence contains sandbox temp paths and SHA receipts that the real `~/.codex/config.toml` was unchanged.

## Verification

- Inspected changed source, bundled dist diff, tests, and evidence metadata under `.omo/evidence/20260620-codegraph-bootstrap-node26/`.
- Ran focused tests locally:
  `bun test test/hook.test.ts test/provisioned-node-guard.test.ts test/serve-provision.test.ts`
  Result: 22 pass, 0 fail.
- Reviewed committed evidence:
  - `focused-component-checks.txt`: component typecheck/build/test passed.
  - `test-codex.txt`: `bun run test:codex` evidence shows 354 pass, 0 fail.
  - `node26-worker-repro.txt`: real built worker under Node `v26.0.0` initialized via `source:"provisioned"` and linked `.codegraph` into isolated `HOME/.omo/codegraph/projects/...`.
  - `codex-qa-app-server-plugin.json`: live isolated app-server turn completed and hooks fired.
- Worktree was clean after local test execution.
