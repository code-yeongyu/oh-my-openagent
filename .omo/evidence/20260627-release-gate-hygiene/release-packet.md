# Release Gate Hygiene Packet

## Scope

RG release hygiene only. This packet does not edit WF-owned workflow-selector code or AT-owned Atlas hook code.

## Diff-check

RED:
- `red-git-diff-check.txt` records `git diff --check v4.13.0..HEAD` exiting `2` on one blank EOF line in `generated-bundle-false-shorthand-probe.txt`.

Candidate GREEN:
- `candidate-green-git-diff-check.txt` records `git diff --check v4.13.0` exiting `0` after the one-line evidence cleanup.

Commit-range GREEN:
- Pending until the RG commit is created, because `git diff --check v4.13.0..HEAD` checks committed `HEAD`, not the unstaged worktree.

## Evidence Reconciliation

See `evidence-reconciliation.md`.

Conclusion:
- Current release-summary `.omo/evidence/...` artifacts are present and tracked.
- Broad missing-path inventory contains historical examples, test fixtures, and transcript fragments rather than current release blockers.
- New RG evidence is intentionally staged with `git add -f` because `.omo/*` is ignored.

## Conflict/status

See `task-1-status-baseline.txt`.

Observed:
- Branch: `code-yeongyu/fix-release-gate-hygiene`.
- Upstream: `origin/dev`.
- Ahead/behind at baseline: `+0 -0`.
- Unmerged names: empty.
- Unmerged index: empty.

## Release Gates

Source inventory: `task-5-release-source-inventory.txt`.

- Metadata: `package.json` version is `4.13.0`; optional platform dependencies are consistent at `4.13.0` per `task-5-release-source-inventory-error.txt`.
- Targeted tests: prior relevant QA summaries are captured in the source inventory; RG changed evidence/packet files only.
- Typecheck: prior relevant QA summaries are captured; RG changed no TypeScript.
- User-facing docs: no new public behavior in RG.
- Known issues: final release owner still needs to consider unresolved WF/AT blockers before release notes are finalized.
- CI/draft-release: workflow excerpts captured from `.github/workflows/ci.yml`.
- Publish gates: test/typecheck/Codex compatibility/preflight/source-state/finalization excerpts captured from `.github/workflows/publish.yml`.

## WF/AT Dependency

Status: `BLOCKED-PENDING-WF-AT`.

Evidence: `task-4-wf-at-dependencies.json`, `task-4-wf-at-summary.md`.

- WF branch `code-yeongyu/fix-workflow-selector-esm-spy`: no remote PR found.
- AT branch `code-yeongyu/fix-atlas-background-output-gate`: no remote PR found.
- RG can open the hygiene PR, but final publish readiness remains blocked until WF/AT land or the leader supersedes those blockers.

## Residual Risks

- `BLOCKED-PENDING-WF-AT`: final publish gate cannot be truthfully rerun to release-ready status until WF/AT code-fix slices are landed or superseded.
- Broad historical evidence references remain noisy, but the current release summaries were checked directly and their actual `.omo/evidence/...` artifacts are present/tracked.
- CI for the RG PR still needs to run after push.

## Cleanup Receipts

- Evidence collection spawned no servers, tmux sessions, browsers, containers, bound ports, or temp directories.
- PR body temp file cleanup will be recorded in `task-8-cleanup-receipt.txt`.

## Reviewer Gate

Pending:
- F1 plan compliance.
- F2 commit-range diff-check after commit.
- F3 evidence presence.
- F4 scope fidelity.
