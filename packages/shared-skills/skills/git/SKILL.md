---
name: git
description: "Local git: commit, push, worktree, base sync, rebase/squash/fixup, and history search (blame, bisect, log -S, reflog). Load before a task's first commit, push or worktree, or pass load_skills=['git'] to the task that commits. GitHub PRs, checks and merges: `github` skill. Triggers: 'commit', 'push', 'rebase', 'worktree', 'who wrote', 'when was X added'."
---

# Git

Load this skill with the read tool, `tool.read({ path })` inside a cell, or `load_skills`, because those paths apply the user's git settings and the bare prelude `read(path)` does not.

Local git: state, commits, worktrees, base sync, history rewrite, push, history questions. Anything on GitHub itself (pull requests, checks, issues, merging) is the `github` skill; hand it the head SHA you pushed.

Commit, push, rebase, reset, stash or delete only when the user asked for it or a workflow they started requires it (ulw-loop commits each verified unit; a PR workflow pushes its branch). An investigative ask ends with findings.

## Running git from an eval cell

git stays the CLI you already know. The cell adds what a shell line lacks: a failure that stops the cell, reads that run together, and values that reach the next call. On a harness without a js cell the same rules hold for plain shell lines: `git -C <repo>` on every call, `set -e` or `&&` between dependent steps.

```js
const git = (repo, ...args) => Bun.$`git -C ${repo} ${args}`.quiet().text() // repo is an absolute path; a non-zero exit throws
const [state, head] = await Promise.all([git(R, "status", "--short", "--branch"), git(R, "rev-parse", "HEAD")])
```

- **One cell answers one question.** Every read it needs goes into one `Promise.all`, and the results stay in variables for the step that uses them. Never spend a turn per `git status`.
- **A failed step must stop what depends on it.** `git()` throws. In a `tool.bash` script that is `set -e` or `&&`; `;` is for independent reads, because after a failed `fetch` or `checkout` it runs the rest on the wrong commit and the cell still looks green.
- `tool.bash` is for shell syntax (pipes, globs, loops) and for a command that can run for minutes, such as a clone or a push whose hooks run tests. Give it the repo too: `git -C <abs-path>` or `cwd`; a `cd` does not carry to the next call.
- **A ref is usable only after this clone has it.** Fetch the exact ref (`git fetch origin <branch>`, `refs/pull/<n>/head`), then `git rev-parse --verify '<ref>^{commit}'` before it is checked out, diffed or merged. A SHA from a message or another machine is not here until fetched.
- Two git commands that write to one worktree never run at the same time: the second dies on `index.lock`.
- Keep output small: `--stat` or `--name-only` first, then the one file.

## Reading state

`status --short --branch` gives the upstream and ahead/behind. `symbolic-ref --short refs/remotes/origin/HEAD` names the default branch, so never guess `main` or `master`. `log -15 --format='%h %s'` shows the message style. `git diff A..B` compares the two tips, including what A gained since they split; `git diff A...B` shows only B's side since the merge base.

## Commits

1. Message style comes from the log: language, casing, prefix. Conventional Commits only where the log uses them.
2. One commit per behavior that could be reverted alone, with its tests. Generated files travel with the source that produced them.
3. **Stage the paths you name.** `git add -A`, `git add .` and `commit -a` are for a worktree you created in which every change is yours; anywhere else they sweep in someone else's work.
4. Hooks run. `--no-verify` needs the user's word.
5. Commit under the repository's configured identity. If none is configured, report it; never invent one with `-c user.name=`.
6. Report hashes, subjects and what is still uncommitted.

## Worktrees

- One task, one worktree on its own branch: fetch, then `git worktree add -b <branch> <path> origin/<base>`. Read `git worktree list` first; a branch checked out elsewhere cannot be checked out or force-moved here.
- **No `git stash` where worktrees share a repository.** The stash belongs to all of them, and a `stash pop` in the wrong one drops foreign changes into your tree. Park work as a commit on your branch.
- Remove what you added (`git worktree remove <path>`, then the branch) once its work is merged or abandoned.

## Syncing with the base, rewriting, pushing

- Follow the repository's rule for merge versus rebase. Without one, merge the base into a branch that is already pushed and rebase only unpushed work.
- Preview first: `git merge-tree --write-tree --name-only HEAD origin/<base>` exits 1 and lists the conflicted paths without touching the tree.
- A merge that stops on a conflict exits 1, so `git()` throws: catch that error alone, list the paths with `git diff --name-only --diff-filter=U`, and resolve each by reading both sides. A generated file, bundle or lockfile is regenerated from the resolved sources, never picked with `--ours` or `--theirs`.
- **Never push while a merge or rebase is in progress.** Before every push, `git status` shows no operation in progress and no unmerged paths, and the checks that passed ran on this exact HEAD.
- Never rewrite `main`, `master`, `dev` or a release branch. On your own pushed branch use `--force-with-lease`, never `--force`.
- Fixups: `git commit --fixup=<hash>`, then `GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash <base>`. A rebase gone wrong: `git rebase --abort` first, reflog after.
- `reset --hard` and `clean` destroy uncommitted work: run them only in a tree whose `status` you just read.
- After a push, read the head back and hand it on in the same cell: `const sha = (await git(R, "ls-remote", "origin", `refs/heads/${branch}`)).slice(0, 40)`, then the `github` skill's `pr.wait({ repo, number, headSha: sha })` and `pr.merge({ matchHeadSha: sha })`. Never poll with `sleep`.

## History questions

`log -S` (a string's count changed), `log -G` (a diff line matches), `blame -L a,b -- file`, `log --follow -- file`, `bisect` with a deterministic test and known good and bad commits, `reflog` for local movement. Answer with the commit hash, subject and path that prove it, and say what stays unproven.
