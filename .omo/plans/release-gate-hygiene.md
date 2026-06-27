# Release Gate Hygiene

## TL;DR
> Summary:      Create the RG release-hygiene PR that fixes the `git diff --check v4.13.0..HEAD` whitespace blocker, reconciles evidence claims, proves conflict/status cleanliness, and publishes a reviewer-ready release QA packet. If the packet cannot be made truthful without WF/AT landing first, write a BLOCKED report instead of pretending release readiness.
> Deliverables:
> - `.omo/evidence/20260627-release-gate-hygiene/` with RED->GREEN diff-check, evidence reconciliation, conflict/status, release packet, PR/BLOCKED proof, and cleanup receipts
> - A pushed PR from `code-yeongyu/fix-release-gate-hygiene` to `dev`, or `.omo/evidence/20260627-release-gate-hygiene/BLOCKED.md`
> - PR body following `.github/pull_request_template.md` with artifact paths and residual risks
> Effort:       Short
> Risk:         Medium - evidence paths are ignored by default and WF/AT may still be external release blockers.

## Scope
### Must have
- Work only in `/Users/yeongyu/local-workspaces/omo/.omo/teams/019f0791-4c2a-7051-a662-5c52a8f9d59d/worktrees/RG` on `code-yeongyu/fix-release-gate-hygiene`.
- Preserve RG ownership: release hygiene, evidence reconciliation, release packet, final PR/BLOCKED handoff. Team guide assigns WF and AT their own code-fix areas, and RG the release-hygiene deliverable at `/Users/yeongyu/local-workspaces/omo/.omo/teams/019f0791-4c2a-7051-a662-5c52a8f9d59d/guide.md:17`, `/Users/yeongyu/local-workspaces/omo/.omo/teams/019f0791-4c2a-7051-a662-5c52a8f9d59d/guide.md:18`, and `/Users/yeongyu/local-workspaces/omo/.omo/teams/019f0791-4c2a-7051-a662-5c52a8f9d59d/guide.md:19`.
- Clean the known RED `git diff --check v4.13.0..HEAD` failure recorded at `.omo/evidence/20260627-release-gate-hygiene/red-git-diff-check.txt:1`.
- Reconcile missing/untracked evidence claims and explicitly classify each item as `resolved`, `staged`, `stale-claim-removed`, or `dependent-WF/AT`.
- Prove current conflict/status state using git data surfaces, not prose.
- Prepare `.omo/evidence/20260627-release-gate-hygiene/release-packet.md` mapping release gates to evidence or blocker status. The release process requires metadata, targeted tests, typecheck, docs/known-issues, and CI/manual verification at `docs/reference/release-process.md:7`.
- Push a PR targeting `dev`, because CI closes PRs targeting `master` and tells contributors to retarget to `dev` at `.github/workflows/ci.yml:38` and `.github/workflows/ci.yml:41`.

### Must NOT have (guardrails, anti-slop, scope boundaries)
- Do not edit WF-owned `packages/omo-codex/plugin/components/workflow-selector/**` or AT-owned `packages/omo-opencode/src/hooks/atlas/**`.
- Do not merge the PR. Team guide says the leader owns integration and final decision at `/Users/yeongyu/local-workspaces/omo/.omo/teams/019f0791-4c2a-7051-a662-5c52a8f9d59d/guide.md:21`.
- Do not alter version metadata unless a release owner explicitly changes the target. Current package metadata is `4.13.0` in `package.json:3` and platform optional dependencies at `package.json:175`.
- Do not count local ignored evidence as delivered unless it is explicitly forced into git or documented as intentionally local. `.omo/*` is ignored by `.gitignore:2`.
- Do not claim release readiness while WF/AT blockers are unmerged. Mark the release packet `BLOCKED-PENDING-WF-AT` if their fixes are not on `origin/dev`.

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: tests-after + git/GitHub CLI/read-only release data checks. No product build is required unless the packet uncovers a release-gate claim that needs rerun proof.
- QA policy: every task has agent-executed scenarios and writes evidence under `.omo/evidence/20260627-release-gate-hygiene/`.
- Evidence: `.omo/evidence/task-<N>-release-gate-hygiene.<ext>`
- Evidence add policy: because `.omo/*` is ignored at `.gitignore:2`, every intended evidence artifact must be staged with `git add -f`.

## Execution strategy
### Parallel execution waves
> Target 5-8 tasks per wave. <3 per wave (except final) = under-splitting.
> Extract shared dependencies as Wave-1 tasks to maximize parallelism.

Wave 1 (no dependencies):
- Task 1: Baseline worktree conflict/status proof
- Task 2: RED diff-check reproduction proof
- Task 3: Evidence claim and ignored/untracked inventory
- Task 4: WF/AT dependency scan
- Task 5: Release gate source inventory

Wave 2 (after Wave 1):
- Task 6: depends [2]
- Task 7: depends [1, 3, 4, 5, 6]

Wave 3 (after Wave 2):
- Task 8: depends [7]

Critical path: Task 2 -> Task 6 -> Task 7 -> Task 8

### Dependency matrix
| Task | Depends on | Blocks | Can parallelize with |
|------|------------|--------|----------------------|
| 1    | none       | 7      | 2, 3, 4, 5           |
| 2    | none       | 6      | 1, 3, 4, 5           |
| 3    | none       | 7      | 1, 2, 4, 5           |
| 4    | none       | 7      | 1, 2, 3, 5           |
| 5    | none       | 7      | 1, 2, 3, 4           |
| 6    | 2          | 7      | none                 |
| 7    | 1, 3, 4, 5, 6 | 8   | none                 |
| 8    | 7          | final  | none                 |

## Todos
> Implementation + Test = ONE task. Never separate.
> Every task MUST have: References + Acceptance Criteria + QA Scenarios + Commit.

- [ ] 1. Baseline worktree conflict/status proof

  What to do: From the RG worktree, capture the branch, upstream, ahead/behind, conflict files, unmerged index entries, ignored evidence rule, and current dirty paths. Write `.omo/evidence/20260627-release-gate-hygiene/task-1-status-baseline.txt`.
  Must NOT do: Do not clean, stash, reset, checkout, or stage anything in this task.

  Parallelization: Can parallel: YES | Wave 1 | Blocks: [7] | Blocked by: []

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `/Users/yeongyu/local-workspaces/omo/.omo/teams/019f0791-4c2a-7051-a662-5c52a8f9d59d/guide.md:55` - team worktree isolation rule.
  - Pattern:  `/Users/yeongyu/local-workspaces/omo/.omo/teams/019f0791-4c2a-7051-a662-5c52a8f9d59d/guide.md:64` - RG branch and worktree assignment.
  - Pattern:  `/Users/yeongyu/local-workspaces/omo/.omo/teams/019f0791-4c2a-7051-a662-5c52a8f9d59d/team.json:63` - RG member state.
  - Pattern:  `.gitignore:2` - `.omo/*` ignored by default.
  - Pattern:  `.gitignore:57` - generic `plans/` ignored by default.

  Acceptance criteria (agent-executable only):
  - [ ] `test "$(git branch --show-current)" = "code-yeongyu/fix-release-gate-hygiene"` passes.
  - [ ] `git diff --name-only --diff-filter=U` outputs nothing.
  - [ ] `git ls-files -u` outputs nothing.
  - [ ] `.omo/evidence/20260627-release-gate-hygiene/task-1-status-baseline.txt` contains `# branch.head code-yeongyu/fix-release-gate-hygiene`.

  QA scenarios (MANDATORY - task incomplete without these):
  > Name the exact tool AND its exact invocation - not "verify it works". Browser use: use Chrome to drive the page; if Chrome is not available, download and use agent-browser (https://github.com/vercel-labs/agent-browser). Computer use: OS-level GUI automation for a non-browser desktop app.
  ```
  Scenario: clean conflict/status baseline
    Tool:     bash
    Steps:    cd /Users/yeongyu/local-workspaces/omo/.omo/teams/019f0791-4c2a-7051-a662-5c52a8f9d59d/worktrees/RG && { printf '## status porcelain v2\n'; git status --porcelain=v2 --branch; printf '\n## unmerged names\n'; git diff --name-only --diff-filter=U; printf '\n## unmerged index\n'; git ls-files -u; printf '\n## ignored evidence rule\n'; git check-ignore -v .omo/evidence/20260627-release-gate-hygiene/task-1-status-baseline.txt .omo/plans/release-gate-hygiene.md || true; } | tee .omo/evidence/20260627-release-gate-hygiene/task-1-status-baseline.txt
    Expected: artifact exists, branch is code-yeongyu/fix-release-gate-hygiene, unmerged sections are empty, ignored-rule section mentions .gitignore.
    Evidence: .omo/evidence/20260627-release-gate-hygiene/task-1-status-baseline.txt

  Scenario: fail fast on wrong worktree
    Tool:     bash
    Steps:    cd /Users/yeongyu/local-workspaces/omo/.omo/teams/019f0791-4c2a-7051-a662-5c52a8f9d59d/worktrees/RG && test "$(git branch --show-current)" = "code-yeongyu/fix-release-gate-hygiene" || { echo "BLOCKED: wrong branch $(git branch --show-current)"; exit 42; }
    Expected: command exits 0; if not, exact BLOCKED line names the wrong branch.
    Evidence: .omo/evidence/20260627-release-gate-hygiene/task-1-status-baseline-error.txt
  ```

  Commit: NO | Message: `chore(release): capture release hygiene status baseline` | Files: [.omo/evidence/20260627-release-gate-hygiene/task-1-status-baseline.txt]

- [ ] 2. RED diff-check reproduction proof

  What to do: Re-run the known failing whitespace gate from the RG worktree and capture the failing output. If it is already green because a prior local edit removed the blank line, record that as `already-green-after-local-change` and continue to Task 6 for the formal green artifact.
  Must NOT do: Do not edit the failing file in this task.

  Parallelization: Can parallel: YES | Wave 1 | Blocks: [6] | Blocked by: []

  References (executor has NO interview context - be exhaustive):
  - Test:     `.omo/evidence/20260627-release-gate-hygiene/red-git-diff-check.txt:1` - known RED output.
  - Pattern:  `.omo/evidence/20260625-codex-config-generated-bundle/QA-SUMMARY.md:17` - generated-bundle probe artifact is part of prior QA evidence.
  - Pattern:  `.omo/evidence/20260625-codex-config-generated-bundle/QA-SUMMARY.md:20` - prior summary claimed diff-check was green before the release-wide check exposed the blank EOF line.

  Acceptance criteria (agent-executable only):
  - [ ] `.omo/evidence/20260627-release-gate-hygiene/task-2-red-diff-check.txt` exists.
  - [ ] The artifact contains either `exit_code=2` with `.omo/evidence/20260625-codex-config-generated-bundle/generated-bundle-false-shorthand-probe.txt:23: new blank line at EOF.` or `exit_code=0` plus `already-green-after-local-change`.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: reproduce release-wide whitespace failure
    Tool:     bash
    Steps:    cd /Users/yeongyu/local-workspaces/omo/.omo/teams/019f0791-4c2a-7051-a662-5c52a8f9d59d/worktrees/RG && set +e; git diff --check v4.13.0..HEAD > .omo/evidence/20260627-release-gate-hygiene/task-2-red-diff-check.txt 2>&1; code=$?; { printf '\nexit_code=%s\n' "$code"; if [ "$code" -eq 0 ]; then printf 'already-green-after-local-change\n'; fi; } >> .omo/evidence/20260627-release-gate-hygiene/task-2-red-diff-check.txt; exit 0
    Expected: artifact records the exact RED line and exit_code=2, or records already-green-after-local-change with exit_code=0.
    Evidence: .omo/evidence/20260627-release-gate-hygiene/task-2-red-diff-check.txt

  Scenario: assert expected RED location when still failing
    Tool:     bash
    Steps:    cd /Users/yeongyu/local-workspaces/omo/.omo/teams/019f0791-4c2a-7051-a662-5c52a8f9d59d/worktrees/RG && if rg -q 'generated-bundle-false-shorthand-probe.txt:23: new blank line at EOF|already-green-after-local-change' .omo/evidence/20260627-release-gate-hygiene/task-2-red-diff-check.txt; then echo PASS > .omo/evidence/20260627-release-gate-hygiene/task-2-red-diff-check-error.txt; else echo 'BLOCKED: unexpected diff-check failure surface' > .omo/evidence/20260627-release-gate-hygiene/task-2-red-diff-check-error.txt; exit 42; fi
    Expected: PASS, or BLOCKED with the unexpected surface preserved.
    Evidence: .omo/evidence/20260627-release-gate-hygiene/task-2-red-diff-check-error.txt
  ```

  Commit: NO | Message: `test(release): capture red release diff check` | Files: [.omo/evidence/20260627-release-gate-hygiene/task-2-red-diff-check.txt]

- [ ] 3. Evidence claim and ignored/untracked inventory

  What to do: Extract every committed text claim that references `.omo/evidence/...`, compare it to filesystem existence and git tracking, and capture ignored/untracked evidence. This task only inventories; Task 7 reconciles.
  Must NOT do: Do not delete missing claims or stage ignored evidence in this task.

  Parallelization: Can parallel: YES | Wave 1 | Blocks: [7] | Blocked by: []

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `.github/pull_request_template.md:13` - PRs require QA and evidence detail.
  - Pattern:  `.github/pull_request_template.md:15` - each QA action needs tested surface, observed result, artifact path, and sufficiency.
  - Pattern:  `.gitignore:2` - `.omo/*` ignored by default, so new evidence can silently remain local.
  - Pattern:  `.omo/evidence/20260625-codex-config-generated-bundle/QA-SUMMARY.md:14` - prior evidence summary references multiple artifact files.
  - Pattern:  `.omo/evidence/20260625-shared-skills-release-blockers/QA-SUMMARY.md:14` - prior shared-skills evidence summary references multiple artifact files.

  Acceptance criteria (agent-executable only):
  - [ ] `.omo/evidence/20260627-release-gate-hygiene/task-3-evidence-claims.txt` exists and contains at least one `.omo/evidence/` claim.
  - [ ] `.omo/evidence/20260627-release-gate-hygiene/task-3-missing-claimed-evidence.txt` exists, even if empty.
  - [ ] `.omo/evidence/20260627-release-gate-hygiene/task-3-untracked-ignored-evidence.txt` exists, even if empty.
  - [ ] The inventory command excludes `.git/`, `node_modules/`, `dist/`, and ignored generated dependency trees.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: inventory evidence claims and untracked evidence
    Tool:     bash
    Steps:    cd /Users/yeongyu/local-workspaces/omo/.omo/teams/019f0791-4c2a-7051-a662-5c52a8f9d59d/worktrees/RG && rg -n --no-heading -o '\.omo/evidence/[A-Za-z0-9._/-]+' --glob '!node_modules/**' --glob '!dist/**' --glob '!packages/**/dist/**' --glob '!.git/**' . 2>/dev/null | sort -u | tee .omo/evidence/20260627-release-gate-hygiene/task-3-evidence-claims.txt && awk -F: '{p=$3; for (i=4;i<=NF;i++) p=p ":" $i; print p}' .omo/evidence/20260627-release-gate-hygiene/task-3-evidence-claims.txt | sort -u | while IFS= read -r p; do [ -z "$p" ] && continue; [ -e "$p" ] || printf '%s\n' "$p"; done | tee .omo/evidence/20260627-release-gate-hygiene/task-3-missing-claimed-evidence.txt && git ls-files --others --exclude-standard .omo/evidence | sort | tee .omo/evidence/20260627-release-gate-hygiene/task-3-untracked-ignored-evidence.txt
    Expected: all three artifacts exist; missing file lists only paths that truly do not exist; untracked list shows ignored evidence that would be absent from the PR unless forced.
    Evidence: .omo/evidence/20260627-release-gate-hygiene/task-3-evidence-claims.txt

  Scenario: prove each claimed existing evidence path is either tracked or explicitly ignored
    Tool:     bash
    Steps:    cd /Users/yeongyu/local-workspaces/omo/.omo/teams/019f0791-4c2a-7051-a662-5c52a8f9d59d/worktrees/RG && awk -F: '{p=$3; for (i=4;i<=NF;i++) p=p ":" $i; print p}' .omo/evidence/20260627-release-gate-hygiene/task-3-evidence-claims.txt | sort -u | while IFS= read -r p; do [ -e "$p" ] || continue; if git ls-files --error-unmatch "$p" >/dev/null 2>&1; then printf 'tracked\t%s\n' "$p"; elif git check-ignore -q "$p"; then printf 'ignored-untracked\t%s\n' "$p"; else printf 'untracked-not-ignored\t%s\n' "$p"; fi; done | tee .omo/evidence/20260627-release-gate-hygiene/task-3-tracking-classification.txt
    Expected: no `untracked-not-ignored` lines; any `ignored-untracked` lines must be reconciled in Task 7.
    Evidence: .omo/evidence/20260627-release-gate-hygiene/task-3-tracking-classification.txt
  ```

  Commit: NO | Message: `chore(release): inventory evidence claims` | Files: [.omo/evidence/20260627-release-gate-hygiene/task-3-*.txt]

- [ ] 4. WF/AT dependency scan

  What to do: Determine whether RG can truthfully produce a hygiene PR now, or must emit a BLOCKED report because the release packet depends on WF/AT landing. Capture local team state, remote PR state, and whether peer branch commits are already ancestors of `origin/dev`.
  Must NOT do: Do not fetch or read peer worktree code for implementation details; only inspect branch/PR/merge state.

  Parallelization: Can parallel: YES | Wave 1 | Blocks: [7] | Blocked by: []

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `/Users/yeongyu/local-workspaces/omo/.omo/teams/019f0791-4c2a-7051-a662-5c52a8f9d59d/team.json:33` - WF assignment.
  - Pattern:  `/Users/yeongyu/local-workspaces/omo/.omo/teams/019f0791-4c2a-7051-a662-5c52a8f9d59d/team.json:48` - AT assignment.
  - Pattern:  `/Users/yeongyu/local-workspaces/omo/.omo/teams/019f0791-4c2a-7051-a662-5c52a8f9d59d/team.json:63` - RG assignment.
  - Pattern:  `/Users/yeongyu/local-workspaces/omo/.omo/teams/019f0791-4c2a-7051-a662-5c52a8f9d59d/guide.md:37` - report findings/decisions to leader.

  Acceptance criteria (agent-executable only):
  - [ ] `.omo/evidence/20260627-release-gate-hygiene/task-4-wf-at-dependencies.json` exists.
  - [ ] `.omo/evidence/20260627-release-gate-hygiene/task-4-wf-at-summary.md` exists and contains one of: `RG-CAN-PR-NOW` or `RG-BLOCKED-PENDING-WF-AT`.
  - [ ] If WF/AT are not merged, the summary names the exact branch and PR status command output.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: capture WF/AT remote PR and merge-state data
    Tool:     bash
    Steps:    cd /Users/yeongyu/local-workspaces/omo/.omo/teams/019f0791-4c2a-7051-a662-5c52a8f9d59d/worktrees/RG && { printf '{"workflow_selector_pr":'; gh pr list --head code-yeongyu/fix-workflow-selector-esm-spy --base dev --state all --json number,state,title,url,headRefName,baseRefName,mergeStateStatus,isDraft,updatedAt 2>/dev/null || printf '[]'; printf ',"atlas_output_gate_pr":'; gh pr list --head code-yeongyu/fix-atlas-background-output-gate --base dev --state all --json number,state,title,url,headRefName,baseRefName,mergeStateStatus,isDraft,updatedAt 2>/dev/null || printf '[]'; printf '}\n'; } | tee .omo/evidence/20260627-release-gate-hygiene/task-4-wf-at-dependencies.json
    Expected: JSON artifact exists; empty arrays mean no remote PR exists yet and must be called out.
    Evidence: .omo/evidence/20260627-release-gate-hygiene/task-4-wf-at-dependencies.json

  Scenario: classify RG dependency state
    Tool:     bash
    Steps:    cd /Users/yeongyu/local-workspaces/omo/.omo/teams/019f0791-4c2a-7051-a662-5c52a8f9d59d/worktrees/RG && { echo '# WF/AT dependency summary'; echo; echo 'WF branch: code-yeongyu/fix-workflow-selector-esm-spy'; echo 'AT branch: code-yeongyu/fix-atlas-background-output-gate'; if rg -q '"number"' .omo/evidence/20260627-release-gate-hygiene/task-4-wf-at-dependencies.json; then echo 'RG-CAN-PR-NOW: RG hygiene can be PRd with release packet residuals; final publish remains blocked until WF/AT PRs merge if they are open.'; else echo 'RG-BLOCKED-PENDING-WF-AT: no remote WF/AT PRs found; release readiness packet must mark external blocker until leader confirms peer landing path.'; fi; } | tee .omo/evidence/20260627-release-gate-hygiene/task-4-wf-at-summary.md
    Expected: summary contains exactly one classification line and branch names.
    Evidence: .omo/evidence/20260627-release-gate-hygiene/task-4-wf-at-summary.md
  ```

  Commit: NO | Message: `chore(release): capture peer dependency status` | Files: [.omo/evidence/20260627-release-gate-hygiene/task-4-*]

- [ ] 5. Release gate source inventory

  What to do: Capture the release automation and metadata surfaces the packet must map: current package version, optional dependency versions, CI draft-release trigger, publish workflow gates, PR template evidence requirements, and prior QA summaries.
  Must NOT do: Do not modify workflow, package, or docs files.

  Parallelization: Can parallel: YES | Wave 1 | Blocks: [7] | Blocked by: []

  References (executor has NO interview context - be exhaustive):
  - API/Type: `package.json:3` - current release version.
  - API/Type: `package.json:175` - platform optional dependencies are release-version pinned.
  - Pattern:  `.github/workflows/ci.yml:397` - draft-release job.
  - Pattern:  `.github/workflows/ci.yml:399` - draft-release depends on test, typecheck, codex compatibility, and build.
  - Pattern:  `.github/workflows/ci.yml:400` - draft release runs on pushes to `dev`.
  - Pattern:  `.github/workflows/publish.yml:39` - release test gate.
  - Pattern:  `.github/workflows/publish.yml:78` - release typecheck gate.
  - Pattern:  `.github/workflows/publish.yml:113` - Codex compatibility gate starts.
  - Pattern:  `.github/workflows/publish.yml:158` - trusted publishing preflight.
  - Pattern:  `.github/workflows/publish.yml:332` - prepare-release-state gate.
  - Pattern:  `.github/workflows/publish.yml:777` - final release job.
  - Pattern:  `docs/reference/release-process.md:7` - manual pre-publish release checks.

  Acceptance criteria (agent-executable only):
  - [ ] `.omo/evidence/20260627-release-gate-hygiene/task-5-release-source-inventory.txt` exists.
  - [ ] The artifact contains `package.json version`, `optional dependency versions`, `draft-release`, `publish gates`, and `prior QA summaries` sections.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: capture release source inventory
    Tool:     bash
    Steps:    cd /Users/yeongyu/local-workspaces/omo/.omo/teams/019f0791-4c2a-7051-a662-5c52a8f9d59d/worktrees/RG && { echo '## package.json version'; node -p "require('./package.json').version"; echo; echo '## optional dependency versions'; node -e "const p=require('./package.json'); for (const [k,v] of Object.entries(p.optionalDependencies||{})) console.log(k+' '+v)"; echo; echo '## draft-release workflow refs'; sed -n '397,462p' .github/workflows/ci.yml; echo; echo '## publish gates'; sed -n '39,120p;158,260p;332,465p;777,1023p' .github/workflows/publish.yml; echo; echo '## prior QA summaries'; sed -n '1,120p' .omo/evidence/20260625-codex-config-generated-bundle/QA-SUMMARY.md; sed -n '1,140p' .omo/evidence/20260625-shared-skills-release-blockers/QA-SUMMARY.md; } | tee .omo/evidence/20260627-release-gate-hygiene/task-5-release-source-inventory.txt
    Expected: artifact includes version 4.13.0, each platform optional dependency at 4.13.0, workflow excerpts, and prior QA summary excerpts.
    Evidence: .omo/evidence/20260627-release-gate-hygiene/task-5-release-source-inventory.txt

  Scenario: fail if package versions are inconsistent
    Tool:     bash
    Steps:    cd /Users/yeongyu/local-workspaces/omo/.omo/teams/019f0791-4c2a-7051-a662-5c52a8f9d59d/worktrees/RG && node -e "const p=require('./package.json'); const v=p.version; const bad=Object.entries(p.optionalDependencies||{}).filter(([k,val])=>k.startsWith('oh-my-opencode-')&&val!==v); if (bad.length) { console.error('BLOCKED: optional dependency version mismatch '+JSON.stringify(bad)); process.exit(42); } console.log('versions-consistent '+v)" | tee .omo/evidence/20260627-release-gate-hygiene/task-5-release-source-inventory-error.txt
    Expected: versions-consistent 4.13.0.
    Evidence: .omo/evidence/20260627-release-gate-hygiene/task-5-release-source-inventory-error.txt
  ```

  Commit: NO | Message: `chore(release): capture release gate source inventory` | Files: [.omo/evidence/20260627-release-gate-hygiene/task-5-*]

- [ ] 6. Clean diff-check failure and record GREEN

  What to do: Remove only the extra blank line at EOF from `.omo/evidence/20260625-codex-config-generated-bundle/generated-bundle-false-shorthand-probe.txt`, then rerun `git diff --check v4.13.0..HEAD`. If the file is already locally modified with exactly that one-line removal, preserve it and capture the diff as the intended fix.
  Must NOT do: Do not edit the prior QA summary, do not rewrite probe content, and do not touch any other evidence file except new RG evidence artifacts.

  Parallelization: Can parallel: NO | Wave 2 | Blocks: [7] | Blocked by: [2]

  References (executor has NO interview context - be exhaustive):
  - Test:     `.omo/evidence/20260627-release-gate-hygiene/task-2-red-diff-check.txt` - RED or already-green baseline.
  - Pattern:  `.omo/evidence/20260625-codex-config-generated-bundle/QA-SUMMARY.md:17` - the probe file is meaningful prior QA evidence.
  - Pattern:  `.omo/evidence/20260625-codex-config-generated-bundle/generated-bundle-false-shorthand-probe.txt:21` - final probe table begins near EOF.

  Acceptance criteria (agent-executable only):
  - [ ] `git diff --check v4.13.0..HEAD` exits 0.
  - [ ] `git diff -- .omo/evidence/20260625-codex-config-generated-bundle/generated-bundle-false-shorthand-probe.txt` shows only deletion of the final blank line.
  - [ ] `.omo/evidence/20260627-release-gate-hygiene/task-6-green-diff-check.txt` contains `exit_code=0`.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: GREEN release-wide diff-check
    Tool:     bash
    Steps:    cd /Users/yeongyu/local-workspaces/omo/.omo/teams/019f0791-4c2a-7051-a662-5c52a8f9d59d/worktrees/RG && perl -0pi -e 's/\n+\z/\n/' .omo/evidence/20260625-codex-config-generated-bundle/generated-bundle-false-shorthand-probe.txt && set +e; git diff --check v4.13.0..HEAD > .omo/evidence/20260627-release-gate-hygiene/task-6-green-diff-check.txt 2>&1; code=$?; printf '\nexit_code=%s\n' "$code" >> .omo/evidence/20260627-release-gate-hygiene/task-6-green-diff-check.txt; exit "$code"
    Expected: command exits 0 and artifact contains exit_code=0.
    Evidence: .omo/evidence/20260627-release-gate-hygiene/task-6-green-diff-check.txt

  Scenario: prove fix is only final blank-line removal
    Tool:     bash
    Steps:    cd /Users/yeongyu/local-workspaces/omo/.omo/teams/019f0791-4c2a-7051-a662-5c52a8f9d59d/worktrees/RG && git diff -- .omo/evidence/20260625-codex-config-generated-bundle/generated-bundle-false-shorthand-probe.txt | tee .omo/evidence/20260627-release-gate-hygiene/task-6-fix-diff.txt && rg -q '^-$$' .omo/evidence/20260627-release-gate-hygiene/task-6-fix-diff.txt && ! rg -q '^[+-][^+-]' .omo/evidence/20260627-release-gate-hygiene/task-6-fix-diff.txt
    Expected: artifact shows only the removed blank line; the assertion exits 0.
    Evidence: .omo/evidence/20260627-release-gate-hygiene/task-6-fix-diff.txt
  ```

  Commit: NO | Message: `fix(release): clean generated bundle evidence whitespace` | Files: [.omo/evidence/20260625-codex-config-generated-bundle/generated-bundle-false-shorthand-probe.txt, .omo/evidence/20260627-release-gate-hygiene/task-6-*.txt]

- [ ] 7. Reconcile evidence blockers and write release packet

  What to do: Create `.omo/evidence/20260627-release-gate-hygiene/evidence-reconciliation.md` and `.omo/evidence/20260627-release-gate-hygiene/release-packet.md`. The reconciliation must classify every missing, ignored, or untracked evidence item from Task 3. The packet must map release-process gates, CI/publish gates, prior QA summaries, current diff-check green, conflict/status proof, WF/AT dependency state, and residual risks.
  Must NOT do: Do not mark release ready if Task 4 says WF/AT are not landed. Do not paste secrets, raw auth headers, environment dumps, or private logs.

  Parallelization: Can parallel: NO | Wave 2 | Blocks: [8] | Blocked by: [1, 3, 4, 5, 6]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `.github/pull_request_template.md:13` - QA and evidence section required.
  - Pattern:  `.github/pull_request_template.md:22` - risks/residuals must map to evidence.
  - Pattern:  `docs/reference/release-process.md:9` - release metadata gate.
  - Pattern:  `docs/reference/release-process.md:10` - targeted tests gate.
  - Pattern:  `docs/reference/release-process.md:11` - typecheck gate.
  - Pattern:  `docs/reference/release-process.md:13` - known issues before final release notes.
  - Pattern:  `.github/workflows/publish.yml:70` - release test gate summary.
  - Pattern:  `.github/workflows/publish.yml:105` - release typecheck gate summary.
  - Pattern:  `.github/workflows/publish.yml:252` - LazyCodex token/trusted publisher preflight.
  - Pattern:  `.github/workflows/publish.yml:460` - release source-state gate summary.
  - Pattern:  `.github/workflows/publish.yml:1019` - final release job summary.

  Acceptance criteria (agent-executable only):
  - [ ] `.omo/evidence/20260627-release-gate-hygiene/evidence-reconciliation.md` exists and contains `resolved`, `dependent-WF/AT`, or `none`.
  - [ ] `.omo/evidence/20260627-release-gate-hygiene/release-packet.md` exists and contains sections: `Scope`, `Diff-check`, `Evidence reconciliation`, `Conflict/status`, `Release gates`, `WF/AT dependency`, `Residual risks`, `Cleanup receipts`, `Reviewer gate`.
  - [ ] If Task 4 output contains `RG-BLOCKED-PENDING-WF-AT`, `release-packet.md` contains `BLOCKED-PENDING-WF-AT`.
  - [ ] If any missing evidence remains, `release-packet.md` contains `BLOCKED` and names each missing path.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: write reconciliation and release packet from captured artifacts
    Tool:     bash
    Steps:    cd /Users/yeongyu/local-workspaces/omo/.omo/teams/019f0791-4c2a-7051-a662-5c52a8f9d59d/worktrees/RG && { echo '# Evidence reconciliation'; echo; echo '## Missing claimed evidence'; if [ -s .omo/evidence/20260627-release-gate-hygiene/task-3-missing-claimed-evidence.txt ]; then sed 's/^/- BLOCKED missing: /' .omo/evidence/20260627-release-gate-hygiene/task-3-missing-claimed-evidence.txt; else echo '- none'; fi; echo; echo '## Ignored or untracked evidence'; if [ -s .omo/evidence/20260627-release-gate-hygiene/task-3-untracked-ignored-evidence.txt ]; then sed 's/^/- staged-or-local: /' .omo/evidence/20260627-release-gate-hygiene/task-3-untracked-ignored-evidence.txt; else echo '- none'; fi; echo; echo '## Tracking classification'; sed -n '1,240p' .omo/evidence/20260627-release-gate-hygiene/task-3-tracking-classification.txt; } > .omo/evidence/20260627-release-gate-hygiene/evidence-reconciliation.md && { echo '# Release Gate Hygiene Packet'; echo; echo '## Scope'; echo 'RG release hygiene only; WF/AT code fixes remain out of scope.'; echo; echo '## Diff-check'; sed -n '1,80p' .omo/evidence/20260627-release-gate-hygiene/task-6-green-diff-check.txt; echo; echo '## Evidence reconciliation'; sed -n '1,240p' .omo/evidence/20260627-release-gate-hygiene/evidence-reconciliation.md; echo; echo '## Conflict/status'; sed -n '1,160p' .omo/evidence/20260627-release-gate-hygiene/task-1-status-baseline.txt; echo; echo '## Release gates'; echo '- Metadata: package/version evidence in task-5-release-source-inventory.txt.'; echo '- Targeted tests: prior QA summaries captured in task-5-release-source-inventory.txt; no new product code in RG.'; echo '- Typecheck: prior QA summaries captured; no new TS code in RG.'; echo '- Docs/known issues: release owner must confirm before final publish; no docs behavior change in RG.'; echo '- CI/draft release: dev push workflow captured in task-5-release-source-inventory.txt.'; echo '- Publish gates: test/typecheck/Codex/preflight/source-state/finalization workflow captured in task-5-release-source-inventory.txt.'; echo; echo '## WF/AT dependency'; sed -n '1,160p' .omo/evidence/20260627-release-gate-hygiene/task-4-wf-at-summary.md; echo; echo '## Residual risks'; if [ -s .omo/evidence/20260627-release-gate-hygiene/task-3-missing-claimed-evidence.txt ]; then echo '- BLOCKED: missing claimed evidence remains.'; else echo '- Evidence claims reconciled by filesystem/tracking inventory.'; fi; if rg -q 'RG-BLOCKED-PENDING-WF-AT' .omo/evidence/20260627-release-gate-hygiene/task-4-wf-at-summary.md; then echo '- BLOCKED-PENDING-WF-AT: peer release blockers not proven landed.'; else echo '- WF/AT state captured; final release readiness still requires leader review.'; fi; echo; echo '## Cleanup receipts'; echo '- See task-8-cleanup-receipt.txt after PR/BLOCKED handoff.'; echo; echo '## Reviewer gate'; echo '- F1-F4 final verification must APPROVE before leader declares complete.'; } > .omo/evidence/20260627-release-gate-hygiene/release-packet.md
    Expected: both markdown files exist and packet contains the required sections.
    Evidence: .omo/evidence/20260627-release-gate-hygiene/release-packet.md

  Scenario: packet fails closed on unresolved evidence or WF/AT dependency
    Tool:     bash
    Steps:    cd /Users/yeongyu/local-workspaces/omo/.omo/teams/019f0791-4c2a-7051-a662-5c52a8f9d59d/worktrees/RG && { rg -q '^## (Scope|Diff-check|Evidence reconciliation|Conflict/status|Release gates|WF/AT dependency|Residual risks|Cleanup receipts|Reviewer gate)' .omo/evidence/20260627-release-gate-hygiene/release-packet.md && if [ -s .omo/evidence/20260627-release-gate-hygiene/task-3-missing-claimed-evidence.txt ]; then rg -q 'BLOCKED: missing claimed evidence remains' .omo/evidence/20260627-release-gate-hygiene/release-packet.md; fi && if rg -q 'RG-BLOCKED-PENDING-WF-AT' .omo/evidence/20260627-release-gate-hygiene/task-4-wf-at-summary.md; then rg -q 'BLOCKED-PENDING-WF-AT' .omo/evidence/20260627-release-gate-hygiene/release-packet.md; fi; } | tee .omo/evidence/20260627-release-gate-hygiene/task-7-packet-integrity.txt
    Expected: command exits 0; missing evidence or WF/AT dependency cannot disappear from packet.
    Evidence: .omo/evidence/20260627-release-gate-hygiene/task-7-packet-integrity.txt
  ```

  Commit: NO | Message: `docs(release): add release hygiene packet` | Files: [.omo/evidence/20260627-release-gate-hygiene/evidence-reconciliation.md, .omo/evidence/20260627-release-gate-hygiene/release-packet.md, .omo/evidence/20260627-release-gate-hygiene/task-7-*.txt]

- [ ] 8. Push PR or BLOCKED report with cleanup receipts

  What to do: If Task 7 packet is not blocked by missing evidence or WF/AT dependency, stage the whitespace fix and forced evidence artifacts, commit once, push branch, and create a PR to `dev`. If blocked, write `.omo/evidence/20260627-release-gate-hygiene/BLOCKED.md`, force-add it with the supporting evidence, commit/push only if the leader wants a blocked-report PR; otherwise report the file path to the leader.
  Must NOT do: Do not merge PR. Do not stage `.omo/plans/release-gate-hygiene.md` unless the leader asks for plan artifacts in the PR. Do not include raw tokens or secret-bearing logs.

  Parallelization: Can parallel: NO | Wave 3 | Blocks: [final] | Blocked by: [7]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `.github/pull_request_template.md:1` - PR body summary section.
  - Pattern:  `.github/pull_request_template.md:13` - QA evidence section.
  - Pattern:  `.github/pull_request_template.md:22` - risks/residuals section.
  - Pattern:  `.github/pull_request_template.md:36` - automated checks section.
  - Pattern:  `.github/workflows/ci.yml:41` - target PRs to `dev`.
  - Pattern:  `/Users/yeongyu/local-workspaces/omo/.omo/teams/019f0791-4c2a-7051-a662-5c52a8f9d59d/guide.md:66` - done means deliverable, evidence, and report.

  Acceptance criteria (agent-executable only):
  - [ ] `git diff --check v4.13.0..HEAD` exits 0 immediately before push.
  - [ ] `git status --porcelain=v2 --branch` has no unstaged or untracked intended RG evidence after staging/commit.
  - [ ] Either `gh pr view --json baseRefName,headRefName,state,url` reports base `dev`, head `code-yeongyu/fix-release-gate-hygiene`, state `OPEN`; or `.omo/evidence/20260627-release-gate-hygiene/BLOCKED.md` exists and names the exact unresolved dependency.
  - [ ] `.omo/evidence/20260627-release-gate-hygiene/task-8-cleanup-receipt.txt` exists.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: pushed PR path
    Tool:     bash
    Steps:    cd /Users/yeongyu/local-workspaces/omo/.omo/teams/019f0791-4c2a-7051-a662-5c52a8f9d59d/worktrees/RG && if rg -q 'BLOCKED: missing claimed evidence remains|BLOCKED-PENDING-WF-AT' .omo/evidence/20260627-release-gate-hygiene/release-packet.md; then echo 'BLOCKED path required; skip PR creation until blocker is recorded' > .omo/evidence/20260627-release-gate-hygiene/task-8-pr-proof.txt; exit 0; fi && git diff --check v4.13.0..HEAD | tee .omo/evidence/20260627-release-gate-hygiene/task-8-final-diff-check.txt && git add .omo/evidence/20260625-codex-config-generated-bundle/generated-bundle-false-shorthand-probe.txt && git add -f .omo/evidence/20260627-release-gate-hygiene && git status --short | tee .omo/evidence/20260627-release-gate-hygiene/task-8-staged-status.txt && git commit -m 'chore(release): reconcile release gate hygiene' -m 'Plan: .omo/plans/release-gate-hygiene.md' && git push -u origin code-yeongyu/fix-release-gate-hygiene && tmp=/tmp/release-gate-hygiene-pr-body.md && { echo '## Summary'; echo; echo '- Cleaned the release-wide diff-check blocker in prior generated-bundle evidence.'; echo '- Added a release hygiene packet with evidence reconciliation, status/conflict proof, and release-gate mapping.'; echo; echo '## Changes'; echo; echo '- Release hygiene evidence under .omo/evidence/20260627-release-gate-hygiene/.'; echo '- One-line EOF whitespace cleanup in .omo/evidence/20260625-codex-config-generated-bundle/generated-bundle-false-shorthand-probe.txt.'; echo; echo '## QA & Evidence'; echo; echo '- **What was tested:** git diff --check v4.13.0..HEAD'; echo '  **Observed result:** exit 0 after whitespace cleanup.'; echo '  **Artifact:** .omo/evidence/20260627-release-gate-hygiene/task-8-final-diff-check.txt'; echo '  **Why sufficient:** proves the known release-wide whitespace gate is green.'; echo '- **What was tested:** evidence claim/tracking reconciliation and release packet integrity.'; echo '  **Observed result:** packet includes required release gates and residuals.'; echo '  **Artifact:** .omo/evidence/20260627-release-gate-hygiene/release-packet.md'; echo '  **Why sufficient:** reviewer can audit every release-hygiene claim against saved artifacts.'; echo; echo '## Risks & Residuals'; echo; sed -n '/## Residual risks/,$p' .omo/evidence/20260627-release-gate-hygiene/release-packet.md | sed -n '1,80p'; echo; echo '## Automated Checks'; echo; echo '```bash'; echo 'git diff --check v4.13.0..HEAD'; echo 'git diff --name-only --diff-filter=U'; echo 'git ls-files -u'; echo '```'; echo; echo '## Related Issues'; echo; } > "$tmp" && if gh pr list --head code-yeongyu/fix-release-gate-hygiene --base dev --state open --json number --jq '.[0].number // empty' | rg -q '^[0-9]+'; then pr=$(gh pr list --head code-yeongyu/fix-release-gate-hygiene --base dev --state open --json number --jq '.[0].number'); gh pr edit "$pr" --body-file "$tmp"; else gh pr create --base dev --head code-yeongyu/fix-release-gate-hygiene --title 'chore(release): reconcile release gate hygiene' --body-file "$tmp"; fi | tee .omo/evidence/20260627-release-gate-hygiene/task-8-pr-proof.txt; rm -f "$tmp"; echo 'removed /tmp/release-gate-hygiene-pr-body.md' | tee .omo/evidence/20260627-release-gate-hygiene/task-8-cleanup-receipt.txt
    Expected: PR exists/open against dev, or command records that BLOCKED path is required; temp PR body is removed.
    Evidence: .omo/evidence/20260627-release-gate-hygiene/task-8-pr-proof.txt

  Scenario: BLOCKED report path
    Tool:     bash
    Steps:    cd /Users/yeongyu/local-workspaces/omo/.omo/teams/019f0791-4c2a-7051-a662-5c52a8f9d59d/worktrees/RG && if rg -q 'BLOCKED: missing claimed evidence remains|BLOCKED-PENDING-WF-AT' .omo/evidence/20260627-release-gate-hygiene/release-packet.md; then { echo '# BLOCKED: release gate hygiene'; echo; echo 'RG cannot truthfully mark release hygiene complete for final publish.'; echo; echo '## Blocking evidence'; sed -n '/## Residual risks/,$p' .omo/evidence/20260627-release-gate-hygiene/release-packet.md; echo; echo '## Required unblock'; echo '- WF/AT landing or missing evidence reconciliation must be completed, then rerun Tasks 4, 7, and 8.'; } > .omo/evidence/20260627-release-gate-hygiene/BLOCKED.md; git add -f .omo/evidence/20260627-release-gate-hygiene/BLOCKED.md .omo/evidence/20260627-release-gate-hygiene; git status --short | tee .omo/evidence/20260627-release-gate-hygiene/task-8-blocked-status.txt; else echo 'not-blocked' > .omo/evidence/20260627-release-gate-hygiene/task-8-blocked-status.txt; fi
    Expected: if blocked, BLOCKED.md exists and names exact blocker; if not blocked, artifact says not-blocked.
    Evidence: .omo/evidence/20260627-release-gate-hygiene/BLOCKED.md
  ```

  Commit: YES | Message: `chore(release): reconcile release gate hygiene` | Files: [.omo/evidence/20260625-codex-config-generated-bundle/generated-bundle-false-shorthand-probe.txt, .omo/evidence/20260627-release-gate-hygiene/**]

## Final verification wave (MANDATORY - after all implementation tasks)
> Runs in PARALLEL. ALL must APPROVE. Surface results to the caller and wait for an explicit "okay" before declaring complete.
- [ ] F1. Plan compliance audit - every task done, every acceptance criterion met
  - Command: `cd /Users/yeongyu/local-workspaces/omo/.omo/teams/019f0791-4c2a-7051-a662-5c52a8f9d59d/worktrees/RG && rg -n 'Task [1-8]|F[1-4]|BLOCKED|exit_code=0|RG-CAN-PR-NOW|RG-BLOCKED-PENDING-WF-AT' .omo/evidence/20260627-release-gate-hygiene | tee .omo/evidence/20260627-release-gate-hygiene/f1-plan-compliance.txt`
- [ ] F2. Code quality review - diagnostics clean, idioms match, no dead code
  - Command: `cd /Users/yeongyu/local-workspaces/omo/.omo/teams/019f0791-4c2a-7051-a662-5c52a8f9d59d/worktrees/RG && git diff --check v4.13.0..HEAD | tee .omo/evidence/20260627-release-gate-hygiene/f2-diff-check.txt`
- [ ] F3. Real manual QA - every QA scenario executed with evidence captured
  - Command: `cd /Users/yeongyu/local-workspaces/omo/.omo/teams/019f0791-4c2a-7051-a662-5c52a8f9d59d/worktrees/RG && for f in task-1-status-baseline.txt task-2-red-diff-check.txt task-3-evidence-claims.txt task-4-wf-at-summary.md task-5-release-source-inventory.txt task-6-green-diff-check.txt task-7-packet-integrity.txt task-8-pr-proof.txt; do test -s ".omo/evidence/20260627-release-gate-hygiene/$f" || { echo "missing $f"; exit 42; }; done | tee .omo/evidence/20260627-release-gate-hygiene/f3-evidence-presence.txt`
- [ ] F4. Scope fidelity - nothing extra shipped beyond Must-Have, nothing Must-NOT-Have introduced
  - Command: `cd /Users/yeongyu/local-workspaces/omo/.omo/teams/019f0791-4c2a-7051-a662-5c52a8f9d59d/worktrees/RG && git diff --name-only origin/dev...HEAD | tee .omo/evidence/20260627-release-gate-hygiene/f4-changed-files.txt && ! rg -q '^(packages/omo-codex/plugin/components/workflow-selector/|packages/omo-opencode/src/hooks/atlas/)' .omo/evidence/20260627-release-gate-hygiene/f4-changed-files.txt`

## Commit strategy
- One logical change per commit. Conventional Commits (`<type>(<scope>): <subject>` body + footer).
- Atomic: every commit builds and passes tests on its own.
- No "WIP" / "fix typo squash later" commits on the final branch - clean up before merge.
- Reference the plan file path in the final commit footer: `Plan: .omo/plans/release-gate-hygiene.md`.
- Use one commit unless Task 8 produces a leader-requested BLOCKED-report-only PR; then use `chore(release): record release gate hygiene blocker`.

## Success criteria
- All Must-Have shipped; all QA scenarios pass with captured evidence; F1-F4 approved; commit history clean.
- `git diff --check v4.13.0..HEAD` is green.
- Evidence reconciliation distinguishes resolved/staged evidence from WF/AT dependencies.
- Worktree conflict/status proof shows no unmerged paths.
- Release packet truthfully maps metadata, tests, typecheck, docs/known-issues, CI/draft-release, publish gates, peer dependencies, cleanup receipts, and residual risks.
- Final handoff is either an open pushed PR targeting `dev`, or a BLOCKED report with exact unblock conditions and evidence paths.
