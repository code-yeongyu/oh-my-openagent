---
name: git-master
description: "MUST USE for ANY git operations: atomic commits, rebase/squash/fixup, history search (blame, bisect, log -S, reflog), local branch and worktree cleanup judged by PR state, and the proof a release claim owes. Load it before running git yourself, or pass load_skills=['git-master'] to the task that commits. Triggers: 'commit', 'rebase', 'squash', 'who wrote', 'when was X added', 'find the commit that', 'delete merged branches', 'clean up branches', 'worktree cleanup', '벨랜치 정리', '워크트리 정리', 'release proof', 'is this release safe to publish'."
---

# Git Master

Use this skill when the user asks you to operate on Git history or answer a Git-history question. Be exact, conservative, and evidence-led. Read the repository state before you infer anything.

## Mode Gate

Classify the request first:

- `COMMIT`: stage and commit local changes.
- `REBASE`: rebase, squash, fixup, autosquash, reorder, split, or otherwise rewrite branch history.
- `HISTORY`: answer when, where, who, why, or which commit changed something.
- `STATUS`: inspect branch, diff, or working-tree state without changing it.
- `GC`: delete local branches and worktrees whose work has landed, judged by PR state (`references/local-gc.md`).
- `RELEASE`: state what a release claim must prove before anyone publishes or announces it (`references/release-proof.md`).

Do not commit, rebase, push, force-push, reset, stash-pop, or delete anything unless the user explicitly asked for that operation. When a workflow the user started mandates one of them (ulw-loop commits each verified unit, ulw-execute lands its branches), that workflow's instruction is the ask. If the request is only investigative, report findings and stop.

## Ground Truth

Gather independent facts in parallel when the tools allow it:

```bash
git status --short
git diff --stat
git diff --staged --stat
git branch --show-current
git log -30 --oneline
git log -30 --pretty=format:%s
git rev-parse --abbrev-ref @{upstream}
git merge-base HEAD origin/main
git merge-base HEAD origin/master
```

Missing upstream or missing `main`/`master` is normal. Fall back to the best available branch or report the missing fact. Never treat a failed lookup as proof.

## PR Body Evidence Attachments

When a PR body needs screenshots or terminal PNGs, the allowed hosting path is GitHub user attachments from the authenticated web attachment flow; never commit temporary images, never use GitHub Releases for PR evidence, and never use external image hosts. Do not log browser cookies, CSRF tokens, S3 form fields, or upload headers.

The flow needs an authenticated GitHub web session (a `gh` API token alone is not enough):

1. Open the target PR or issue page in that session and read its file-attachment CSRF token and repository id.
2. `POST https://github.com/upload/policies/assets` with `repository_id`, `name`, `size`, `content_type`, and that token as `authenticity_token`.
3. Upload the bytes to the returned S3 URL with the returned form fields exactly as given.
4. `PUT https://github.com/upload/assets/:id` with the returned `asset_upload_authenticity_token`.
5. Put only the final `https://github.com/user-attachments/assets/<uuid>` URL in the PR body (write the body to a temp file and pass it with `gh pr edit --body-file`).

If no authenticated browser session is available, leave the local evidence paths in the PR body and state the blocker.

## Commit Mode

Commit only the user's requested changes. Preserve unrelated dirty work.

1. Detect message style from recent history. Use the dominant local pattern, language, and casing. Do not default to Conventional Commits unless the repo uses them.
2. Inspect the full diff, not only filenames. Separate unrelated user edits from the requested commit.
3. Build atomic groups by behavior, module, and revertability. Keep implementation and its direct tests together.
4. Prefer multiple commits for unrelated concerns. A single commit is acceptable only when the changed files form one indivisible behavior or the user explicitly asks for one commit.
5. Stage by path or hunk so each commit contains only its atomic group.
6. Before each commit, verify `git diff --staged --stat` and enough staged diff to prove the group is right.
7. Commit with the detected style. After each commit, verify `git log -1 --oneline`.

Grouping rules:

- Split different features, modules, generated artifacts, config, docs, and test-only changes unless they are inseparable.
- Keep generated files with the source change that produced them when omitting them would leave the repo inconsistent.
- Never hide failing or unrelated changes inside a broad commit.

Final report: list commit hashes, messages, and any remaining uncommitted files.

## Rebase Mode

History rewriting is a shared-impact operation.

- Never rebase or rewrite `main`, `master`, `dev`, release branches, or a protected branch unless the user explicitly named that exact operation.
- If commits may already be pushed, ask before force-pushing. Use `--force-with-lease`, never plain `--force`.
- If the worktree is dirty, preserve it intentionally before rebasing. Do not stash-pop over conflicts without checking what changed.
- For fixups, prefer `git commit --fixup=<hash>` followed by `GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash <base>`.
- For conflicts, read the conflicting files and resolve by intent. Do not choose ours/theirs blindly.
- If a rebase goes wrong, use `git rebase --abort` first. Use reflog only after explaining the recovery path.

After rewriting, run the relevant tests or at least the project's cheapest smoke check, then show the new branch log from base to HEAD.

## History Mode

Choose the Git tool by the question:

- `git log -S "text"`: when the count of an exact string changed.
- `git log -G "regex"`: when diffs touched lines matching a pattern.
- `git blame -L start,end -- file`: who last changed specific lines.
- `git log --follow -- file`: history across renames for one file.
- `git show <hash>`: inspect the commit that appears relevant.
- `git bisect`: find the first bad commit when there is a deterministic pass/fail command and known good/bad bounds.
- `git reflog`: recover or explain recent local history movement.

Always cite the exact command evidence in the answer: commit hash, subject, file path, and line or diff context when relevant. If the evidence is ambiguous, say what remains unproven.

## GC Mode

`git branch --merged` misses every squash and rebase merge, so the proof that a branch landed is the forge's pull request state, joined by branch name and confirmed by the tip SHA. `scripts/branch-gc.ts` does that join and classifies every local branch; read `references/local-gc.md` for the classes and the do-not-delete rules before running it.

```bash
bun "$SKILL_DIR/scripts/branch-gc.ts" --repo . --json                  # dry run: classes, reasons, exit 2 when candidates exist
bun "$SKILL_DIR/scripts/branch-gc.ts" --repo . --apply --worktrees      # snapshot first, then remove clean worktrees and delete
```

`$SKILL_DIR` is this skill's own directory (the folder holding this SKILL.md). The dry run is the default and the report the user sees first. `--apply` writes a `for-each-ref` snapshot (SHA plus refname for every ref, printed as `snapshot: <path>`) before the first deletion, removes worktrees before their branches, and never forces: a locked worktree, a dirty worktree, the worktree you are standing in, a protected or `wip/`/`backup/`/`archive/` branch, an open PR's head, and the base of any open PR are reported and left alone. A scheduled job may run the dry run; the `--apply` run is a human-approved invocation, every time.

## Release Mode

A release claim ("shipped", "published", "deployed", "safe to tag") is a set of facts, and `references/release-proof.md` lists the five the claim owes: the artifact digest, the builder that produced it, the target it went to, the smoke evidence against that target, and the rollback evidence. Collect them before saying the release is done; a claim missing one of them is reported as missing that item, not as done.

## Safety Checks

Before any write to Git history:

- Current branch is known.
- Dirty work is accounted for.
- Upstream/pushed status is known or explicitly unknown.
- The operation matches the user's request.
- Recovery path is known (`rebase --abort`, reflog hash, or untouched worktree).

Before finishing:

- Run the most relevant verification available for the changed behavior or history operation.
- Report commands that passed and any command you could not run.
- Leave the worktree state explicit.
