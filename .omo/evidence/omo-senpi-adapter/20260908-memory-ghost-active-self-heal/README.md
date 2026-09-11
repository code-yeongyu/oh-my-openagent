# QA evidence: memory ghost-active reservation self-heal (2026-09-08)

## Scope (rebased onto dev after d69e67401 landed)

While this PR was in review, dev merged `fix(memory): reclaim dead launchers shadowed by retired
reflection runs` (d69e67401) plus the stranded-temporaries sweep (f8ef47b5a). That rule covers the
fleet's observed wedge shape: an active reservation whose run dir carries a retired generation's
ledger AND terminal artifact (`final.json`/`abandoned.json`) with a confirmed-dead launcher.

This PR was rebuilt on top of it and now adds only the gaps that rule cannot see:

1. **Missing launcher identity** (`reservedAt`/`launcherPid`/`launcherHostname` absent) — a legacy
   record no current code path writes (observed live on `senpi-de7b420e`). Reclaimed outright when
   no pid survives; probed for liveness (and deferred if alive) when pid+hostname do survive.
2. **Older ledger without a terminal artifact** (the retired run crashed before settling) — treated
   as retired-generation when `startedAt < reservedAt - 5s`, then the existing dead-launcher gate
   and complete-as-failed + promote path apply.
3. **Run-dir loop skip** for a retired-generation dir in the same pass, whether or not the reclaim
   fired, so the retired ledger can never settle the live reservation through runId equality.
4. `/doctor` reservation check (dead-launcher / missing-identity ghost warning).

Artifact policy converges with dev: retired artifacts (ledger, prelaunch, worktree) are never
touched by the reclaim. An earlier revision of this PR carried a "ghost-owned prelaunch cleanup"
lane; three gate-review rounds converged on dropping it (see `gate-fix-round-*.md`).

## What was tested

- `bun test packages/omo-senpi/src/components/memory/worker` and the full memory suite — see the
  counts recorded in the PR body for the final head.
- `bunx tsgo --noEmit -p packages/omo-senpi/tsconfig.json` — clean.
- `run-reconciliation-ghost.test.ts` (7 cases): missing identity reclaimed with run dir intact;
  missing reservedAt + live launcher deferred; missing reservedAt + dead launcher reclaimed; older
  ledger without terminal + dead launcher reclaimed (retired dir left for a later pass); older
  ledger without terminal + live launcher untouched (no settle against the live reservation);
  in-slack ledger not a ghost; classification boundaries incl. terminal dirs delegated to dev's rule.
- `run-terminal-precedence.integration.test.ts` mock `active` now carries the launcher identity
  the store stamps on every production reserve (`tryReserve`/`withLaunchOwner`).
- `replica-drive.mts` + `replica-drive-result.json`: the real wedged byte-copy of
  `sisyphuslabs-d5fbf349` (ghost active.lock from the pre-repair backup, retired merged-dream run
  dir, completions, synthetic pending) reclaimed as failed with pending promoted, retired artifacts
  sha256-identical, repo HEAD unchanged, second pass no-op — on the merged dev+PR code.
- Live fleet repair on mengmotaHost (`fleet-repair-receipt.json`, `post-repair-fleet-state.json`):
  26 identities repaired; the unmodified runtime then drained the backlog itself (system tokens
  31834 -> 2532, automatic idle-origin dream `reflection-run-14` merged — first since 2026-08-13).

## Why this is enough

Each added branch is pinned by a real-store/real-git test, the shared reclaim path is dev's own,
and the replica drive exercises the production state machine on real wedged data.

## Omitted / residuals

- Headless `omo -p "/dream"` smoke hit a pre-existing `extension ctx is stale after session
  replacement or reload` error on the print-mode bind path — unrelated; the desktop path completed
  dream run-14 through the same bind reconcile.
- Pending-payload growth (the 183 MB amplifier) remains a follow-up; the temporaries sweep on dev
  covers `.json.tmp-*` under runs/ and completions/, not `reflection/pending.json.tmp-*`.
- Raw transcripts/memory repo contents are not copied here; only hashes, sizes, and outcomes.
