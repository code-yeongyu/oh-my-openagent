# Windows memory-core git lock contention

## What was tested

The Windows `test` job failed 6 of 16 concluded CI runs while `typecheck` and
`codex-compatibility` on the same OS stayed green, always in `packages/memory-core`
around git lock contention. Every job log old enough to diagnose had expired, so
the failure had never actually been captured.

## What was observed

Git serialises index, ref and config writes behind `*.lock` files. The loser of the
race fails immediately instead of waiting, so it surfaces as a transient failure
rather than a real defect. Windows loses these races far more often because file
handles are released more slowly.

A local probe ran 24 concurrent commits against one repository: **22 failed**, and the
existing `isGitConfigLockError` predicate matched **0 of 22**. Every failure was
`Unable to create '.../.git/index.lock': File exists` / `Another git process seems to
be running`. See `cross-process-probe.txt`.

Seven mutating call sites in `repo.ts` took index or ref locks. Only `configSet` was
protected, through a predicate that matched `config.lock` alone.

| artifact | shows |
|---|---|
| `red-1-predicate.txt` | index.lock and ref-lock cases failing `Expected: true, Received: false` while the config.lock case passes |
| `red-3-init-ref-lock.txt` | RED with the stack naming `at init (repo.ts:50)`, the unguarded `symbolic-ref` |
| `mutation-proof-predicate.txt` | reverting the predicate to config-only fails 3 tests; restoring returns 8/8 |
| `green-1-predicate.txt` | 8/8 including the negative case |
| `green-7-full.txt` | memory-core 489 pass / 0 fail; memory component 613 pass / 0 fail |
| `cross-process-worktree-probe.txt` | 8 processes x 4 worktree cycles clean on macOS |

## Why it is enough

The predicate is pinned against **verbatim** git stderr rather than paraphrase, and a
negative case asserts `pathspec ... did not match` still surfaces after exactly one
attempt, so genuine failures are never retried away. The mutation proof shows the
assertions fail when the fix is reverted, so they are not tautological.

## What was omitted, stated plainly

This was **not reproduced on macOS**: 6/6 repeated concurrent-commit runs and an
8-process worktree probe were clean. Two diagnostic routes were unavailable - all six
Windows job logs had expired, and the Parallels VM needs an attended `inittool2` init.
The fix therefore targets the mechanism proven by local error capture, not a captured
Windows failure. A green Windows job on this PR is supporting evidence, not proof the
race is gone, because the race is probabilistic.

`git init` at repo.ts:49 is deliberately left unwrapped: it runs behind an `existsSync`
guard and does not contend on a `*.lock` file.

## Which proof covers which criterion

| criterion | proof | RED captured? |
|---|---|---|
| retry predicate recognises real lock text and does not swallow genuine failures | `red-1-predicate.txt`, `mutation-proof-predicate.txt` | yes - two classes failed `Expected: true, Received: false`, and reverting the predicate fails 3 tests |
| the retry actually engages on a lock-losing mutation | `red-3-init-ref-lock.txt` | yes - stack names `at init (repo.ts:50)`, the unguarded `symbolic-ref` |
| concurrent mutations all land, with the expected number of commits | `green-8-worktree-concurrency.txt` | **no - see below** |

The concurrent-worktree case asserts six distinct commit shas and zero rejections. It was
**never captured RED**, and it cannot be on this machine: macOS does not lose these races,
so the case passes with or without the fix here. It is a real-surface assertion of the
end state, not a failing-first proof. The failing-first proof for the retry mechanism is
`red-1` and `red-3`, both of which fail deterministically when the fix is reverted.

An earlier version of that case asserted only that no *lock* error surfaced. That was
weaker than the criterion asked for, but it could not be strengthened in place: writers
sharing one index legitimately reject each other through the unrelated-change guard, so a
commit count was not provable there. Per-worktree commits are both the shape reflection
actually runs and the shape where every writer is expected to succeed.

## Coverage of the mutating call sites

All seven lock-taking mutations in `repo.ts` are now wrapped: `symbolic-ref` (init),
`commit --allow-empty` (init), `stage`, `commitStaged`, `worktreeAdd`, `worktreeRemove`
and `merge`. An audit for `await this.git([...])` on a mutating verb returns empty.
