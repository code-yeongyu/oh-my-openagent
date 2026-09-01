# OMO Native Bun install and update-manager QA

Started: 2026-08-12T02:46:04Z
Tier: HEAVY - external package-manager integration and self-update behavior.
Worktree: `/Volumes/mengmotaStorage/local-workspaces/omo-wt/fix-omo-native-bun-update`
Branch: `fix/omo-native-bun-update`
Base: `origin/dev@55326d2a8408920c8578a239aa39b9967595777f`
Notepad: `/var/folders/h6/w548ypzn1k78_xqndn63y7xc0000gn/T/ulw-20260812-114604.XXXXXX.md.bPlvkdpqkX`

## Criterion 1 - Bun global install

PASS. RED reproduced with an unsafe empty dependency alias in the caller
project: `bun install -g omo-ai@beta` exited 1 after partial installation.
GREEN packed fix installed under Bun and emitted a package-root-anchored update
command that exited 0 from the same polluted caller without unsafe-name output.

## Criterion 2 - package-manager-aware update behavior

PASS. Focused RED was 29 pass / 1 Bun-layout failure against npm-only
production. GREEN is 30 pass / 0 fail with Bun, npm, and unknown-layout
coverage.

## Criterion 3 - adjacent regression and integrity

PASS so far. OMO Native package: 74 pass / 6 documented environment skips /
0 fail. Full root suite: 14,433 pass / 11 documented skips / 0 fail. Root
typecheck, build, payload verifier, Senpi install/freshness tests, and packed
manifest scan pass. Final LSP remains deferred because this session's LSP
server rejects external-worktree and symlink paths; it is a merge-time
completion gate on the clean main checkout.

## Criterion 4 - PR delivery and cleanup

Pending PR delivery. Behavior commit:
`1676388eb fix(omo-native): detect Bun-managed updates`.

## Omissions and cleanup

All Bun/npm/unknown-layout prefixes, remote fixtures, tarballs, manifest-scan
directories, and temporary transcripts used for completed QA were removed.
Generated build noise remains unstaged and will be discarded before rebase/PR.
