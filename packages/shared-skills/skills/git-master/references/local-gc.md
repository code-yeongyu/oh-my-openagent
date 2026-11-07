# Local GC: branch and worktree cleanup judged by PR state

Local checkouts accumulate branches whose work has long landed. The cost is attention: `git branch` stops being a list of live work, a stale name gets reused, and a worktree nobody remembers holds the only copy of an uncommitted fix. This reference is the contract `scripts/branch-gc.ts` implements and the rules a hand-run cleanup follows when the script is not available. The classes and the do-not-delete rules are adapted from the `dev-devops` skill of lidge-jun/codexclaw (MIT); the script is omo's own.

## 1. Merge truth is PR state

`git branch --merged <base>` answers "is this tip an ancestor of the base". A squash merge and a rebase merge both land the work as new commits, so the branch tip is never an ancestor and the branch reads as unmerged forever. The forge knows better: `gh pr list --state all --json number,state,headRefName,baseRefName,mergedAt,closedAt,headRefOid,isCrossRepository` lists every pull request with the branch it came from and the SHA it was merged at. A branch is merged when a `MERGED` PR names it as `headRefName` and the local tip equals that PR's `headRefOid`. Ancestry stays as the second proof for branches merged with a merge commit or a fast-forward and never sent through a PR.

The tip equality matters. A branch that received commits after its PR merged carries work the forge never saw; the script keeps it and says why.

## 2. Classes

Every local branch gets exactly one class. Keep classes win over delete classes, in this order.

| Class | Test | Action |
|---|---|---|
| `retained-prefix` | name starts with `backup/`, `archive/`, `wip/` | keep; retention is a human policy |
| `protected` | `main`, `master`, `dev`, `develop`, `trunk`, `release/*`, `hotfix/*` | keep |
| `locked-worktree` | checked out in a locked worktree, or in the worktree the command runs from | keep; a lock is a human statement of intent |
| `dirty-worktree` | checked out in a worktree whose `git status --porcelain --untracked-files=no` is non-empty | keep; uncommitted work has no reflog |
| `open-pr-head` | an `OPEN` PR has this branch as `headRefName` | keep |
| `open-pr-base` | an `OPEN` PR has this branch as `baseRefName` (a stacked child) | keep; deleting the parent closes the child |
| `checked-out` | attached to a clean, unlocked worktree, and `--worktrees` was not given | keep until the worktree is removed |
| `pr-merged` | a `MERGED` PR names the branch and its `headRefOid` equals the tip | delete |
| `integrated` | tip is an ancestor of the base | delete |
| `pr-closed-stale` | every PR for the branch is `CLOSED`, the tip equals a closed PR's head, the newest `closedAt` is older than the grace period (14 days by default), and the name is inside a disposable namespace | delete |
| `disposable-no-pr` | inside a disposable namespace with no PR on record | report only |
| `human-no-pr` | everything else: a human-named branch without merge proof, a closed PR outside the namespace, a disposable branch inside its grace period | keep |

The disposable namespaces default to `codex/`, `agent/`, `claude/`, `copilot/`, `ingw/`; `--namespace <prefix>` replaces the list. A name match alone is never a reason to delete; the tip equality with a PR head is what proves the branch holds nothing newer than what the forge saw. Fork heads (`isCrossRepository`) are ignored: their branches live in another repository.

## 3. Worktrees

Remove worktrees before their branches, because git refuses to delete an attached branch, and never with `--force`, because a forced removal of a dirty tree discards work no reflog returns. The script removes a worktree only when `--worktrees` is given, the tree is clean and unlocked, it is not the directory the command runs from, and its branch is a delete row. A refusal from `git worktree remove` is reported as a refusal and the run exits 4 with the list of what was removed before it. Worktrees under a temporary directory (`/private/tmp`, `/var/folders`) do not survive a reboot; a dirty one is a recovery candidate (commit or stash in place, then `git worktree move` under a durable root), never a deletion candidate.

`git worktree prune` deletes only the administrative entries of worktrees whose directories are already gone; it removes no files and no branches, and `-n` shows what it would do.

## 4. Order of a run

1. `git fetch --prune` so `: gone]` upstream markers are fresh (`--no-fetch` skips it; set `fetch.prune true` in the repository so the next fetch does it on its own).
2. Read PR state through `gh`, or from `--pr-state <file>` when the run cannot reach the forge.
3. Classify (section 2) and print the plan grouped by action. Exit 2 when delete rows exist, 0 when none. This is the default, and the report a user sees first.
4. `--apply`: write the snapshot (`git for-each-ref --format='%(objectname) %(refname)'` plus the worktree list) to `--snapshot <path>` or a file under the temp directory, print its path, then remove worktrees (section 3), then `git branch -D` each delete row. A deleted branch is restorable with `git branch <name> <sha>` from the snapshot, and a deleted remote branch with `git push origin <sha>:refs/heads/<name>`, for as long as the SHA is held.

Exit codes: 0 nothing to do or every deletion succeeded; 1 error; 2 dry run found candidates; 3 a precondition refused the run (no base ref, no PR state, fetch failed); 4 git refused part of an `--apply` after some deletions completed, so the run is partial and the report lists what went.

## 5. What a cleanup never does

- `rm -rf <worktree>`: leaves `.git/worktrees` state behind and skips the dirty check.
- `git worktree unlock` as part of GC: the lock was placed by a person.
- `--apply` from a scheduled job: a schedule may produce the dry-run report, and a person runs the deletion.
- Deleting by name pattern without the PR head equality.
- `fetch.pruneTags` set by reflex: with a `refs/tags/*` refspec it deletes local tags that never came from that remote.
