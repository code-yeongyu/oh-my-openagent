# .git 102GB autopsy and cleanup (mengmotaHost, 2026-08-25)

## What was tested / measured

Autopsy of the main checkout's `.git` (102GB reported vs 700MB src) on mengmotaHost
(`/Volumes/mengmotaStorage/local-workspaces/omo`), followed by cleanup and verification.

All numbers below were captured live with `du -sh`, `git count-objects -vH`,
`git worktree list --porcelain`, and per-worktree `git status --porcelain` /
`git rev-list --count HEAD --not --remotes=origin`.

## Root cause

The repository history is healthy. The bloat was worktree submodule duplication:

| component | before | note |
|---|---|---|
| `.git/worktrees` | **100GB** | 85 linked worktrees x ~1.8GB admin dir each |
| `.git/modules` | 1.7GB | single shared submodule store (expected) |
| `.git/rr-cache` | 461MB | stale rerere entries |
| `.git/objects` | 423MB | main history - healthy |

Every linked worktree that ran `git submodule update --init` received its own FULL
clone of the vendored upstreams under `.git/worktrees/<id>/modules/`, dominated by
`open-design` (~1.7GB of objects per copy; upstream repo itself is ~1.8GB on GitHub).
85 worktrees x 1.8GB = ~100GB. No history-embedded binaries, no loose-object explosion.

## Actions

1. Classified all 85 linked worktrees: dirty state, unpushed commits, locks.
   - 55 removed via `git worktree remove --force`: all were fully pushed with a clean
     tree, or dirty ONLY with regenerated build artifacts (codegraph `dist/*`,
     `install-local.mjs` bundle drift, re-minified `plugin/extensions/*.js` - verified
     by diff content: hash-header + symbol-rename only). Branches were NOT deleted.
   - 30 kept: all locked worktrees (bip-*, parallelism-v3, perf/omo-launcher),
     worktrees with real uncommitted source/test changes, worktrees with unpushed
     commits, main checkout, and omo-thread-tools.
   - 11MB of opengateway QA evidence in a removed worktree's `.local-ignore` was
     salvaged to the sisyphuslabs evidence lane before removal.
2. Deduplicated surviving worktree submodule stores: wrote
   `objects/info/alternates` -> main `.git/modules/.../<name>/objects`, then
   `git repack -a -d -l` + `prune-packed` (84 module dirs, 0 failures). Fetched
   upstream into the main open-design module first so newer commits held only by
   recent worktrees also deduplicated (99MB -> 4MB residue per worktree).
3. `git rerere gc` with 7-day windows: 461MB -> 86MB.
4. `git gc` on the main repo: objects now a single healthy 206MB pack.
5. Prevention: `.gitmodules` marks all four vendored upstream submodules
   `shallow = true`, so future worktree/CI submodule clones fetch depth-1 instead of
   full history (open-design full history alone is ~1.7GB per clone).

## Observed result

- `.git`: **102GB -> 2.3GB** (modules 1.8GB shared store + objects 221MB +
  worktrees 139MB + rr-cache 86MB).
- Volume usage dropped ~200GB total including the removed checkouts' node_modules
  and submodule working copies.
- `git fsck --no-dangling`: clean.
- Survivor worktrees verified working: `git submodule status` healthy and submodule
  `git log` resolves through alternates (checked bip-7023, omo-thread-tools).
- Spot-checked removed worktrees' branches still present in the main repo
  (`fix/ci-real-sharding`, `feat/telemetry-surface-attribution`, `release/20260824-beta18`).

## Why this is enough

The change in this PR is metadata-only (`.gitmodules` clone-depth hint). It alters no
code reaching OpenCode/Codex/Senpi runtime; existing initialized submodules are
unaffected (shallow applies to fresh clones only), and `git submodule update` falls
back to fetching the exact pinned SHA when the shallow tip does not contain it
(GitHub serves reachable-SHA fetches).

## What was omitted

Raw command transcripts (they contain only sizes/paths already summarized above).
No secrets were involved.

## Residual risk / follow-up

- Worktree admin dirs still grow ~4MB per worktree for submodule residue; acceptable.
- If a surviving worktree later force-gc's the main open-design module store,
  alternates-borrowed objects could dangle; the store is a full upstream clone and is
  not routinely gc'd, and `repack -l` kept every locally-unique object.
- The stale-worktree accumulation itself (55 dead worktrees) suggests the worktree
  sweeper is not being run after PR merges; worth wiring into the release/merge flow.
