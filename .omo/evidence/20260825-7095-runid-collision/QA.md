# QA Evidence — Issue #7095 Defect 2: reflection bare-runId completion-record collision

Date: 2026-08-25
Branch: `fix/7095-runid-collision` (worktree `/Volumes/mengmotaStorage/local-workspaces/omo-wt/fix-7095-runid-collision`, base `dev` @ 66a8bd272)

## WHAT WAS TESTED

Surface: reflection run-id minting and its reservation seam —
`packages/omo-senpi/src/components/memory/reflection-run-id.ts` (new),
`packages/omo-senpi/src/components/memory/identity-runtime.ts` (wiring),
`packages/memory-core/src/reflection/reservation.ts` (async `createRunId` awaited under the
scheduler lock).

Commands (bun 1.4.0-canary.1, all fixtures under `mkdtemp(tmpdir())`; the real agent home,
`~/.omo/memory`, and the network were never touched):

1. Failing-first reproduction: `reflection-run-id.ts` temporarily stubbed with the PRE-FIX
   per-process counter (`let runCounter = 0` lifted verbatim from `identity-runtime.ts`, one
   instance per launch so numbering restarts at 1 exactly as a process restart does), run against
   the committed regression suite:
   `bun test packages/omo-senpi/src/components/memory/reflection-run-id-collision.test.ts`
2. Lock-placement discrimination: minting temporarily reverted to OUTSIDE the scheduler lock,
   `bun test packages/memory-core/src/reflection/reservation.test.ts`
3. Scoped suites after the fix:
   `bun test packages/memory-core/src`
   `bun test packages/omo-senpi/src/components/memory`
4. Typechecks: `bunx tsgo --noEmit -p packages/memory-core/tsconfig.json`,
   `bunx tsgo --noEmit -p packages/omo-senpi/tsconfig.json`
5. Bundles: `node packages/omo-senpi/plugin/scripts/build-extension.mjs` then `--check`

## WHAT WAS OBSERVED

1. RED — 0 pass / 3 fail. Two failures threw the issue's literal error at
   `worker/completion-records.ts:15`:

   ```
   error: Reflection completion record mismatch for reflection-run-1
         at ensureReflectionCompletion (.../worker/completion-records.ts:15:17)
   (fail) reflection run ids across a run-counter reset > #given stale generation-one completion
          records #when a fresh process reserves and publishes #then the retired id is never re-minted
   (fail) reflection run ids across a run-counter reset > #given a run published by a fresh
          generation #when the stale record is re-read #then it is byte-identical
   (fail) reflection run ids across a run-counter reset > #given two successive launches sharing one
          identity #when each publishes a completion #then neither collides with the other
    0 pass / 3 fail
   ```

   An earlier RED attempt failed for the WRONG reason (`runId.trim is not a function` — the store
   was passing the un-awaited Promise), which is why the async-factory support landed before the
   regression could be captured honestly. GREEN after the real factory: 3 pass / 0 fail.
2. Lock placement discriminates: with minting moved back outside the scheduler lock, the new
   `#when reservations race #then minting is serialized so no id is issued twice` case FAILED
   (10 pass / 1 fail); inside the lock it passes. The test therefore guards the placement, not
   merely the signature.
3. Scoped suites: `packages/memory-core/src` **547 pass / 0 fail** (68 files);
   `packages/omo-senpi/src/components/memory` **921 pass / 0 fail** (135 files).
4. Typechecks: both packages exit 0.
5. `build-extension.mjs --check` exits 0 after regeneration
   ("omo-senpi extension build is current").

## WHY IT IS ENOUGH

The committed regression suite pins the reported wedge end-to-end through the REAL
`ReflectionReservationStore` and the REAL `ensureReflectionCompletion` publish path: generation
one's consumed bwrap-failure completion record and run directory are seeded on disk, then a fresh
store reserves and publishes. It fails against the pre-fix counter with the issue's exact error
string, so it guards the defect rather than the implementation. A separate case asserts the stale
record is **byte-identical** after the new generation publishes, pinning the "records stay
untouched" half of the contract.

The factory unit tests pin each input of the high-water scan independently — completion records,
run directories, `reflection-sessions/`, epoch-prefixed worktree names
(`1755000000000-reflection-run-21`), and live `active.lock` / `pending.json` reservations — each
seeded ALONE so no assertion can pass on a sibling source. Non-run-shaped names
(`not-a-run.json`, `reflection-run-notanumber.json`, `facts-abc123-4`) are proven ignored, and
strict in-process monotonicity is pinned for repeated mints with no intervening disk writes.

Remaining risk: two processes minting concurrently are serialized only by the existing
cross-process scheduler lock. That lock is the pre-existing seam for reservation state; minting
now happens inside it, so it inherits exactly the guarantee the rest of the reservation already
had — no more, no less.

## WHAT WAS OMITTED

- Raw bun output beyond the counts and the RED snippet above (trimmed for size; no secrets).
- The temporary pre-fix counter stub and the temporary out-of-lock revert (both reverted after
  capture; their exact content is described above and reproducible from this document).
- Defect 1 of #7095 (reflection sandbox-degraded fallback) — out of scope here, landing
  separately via the #6873 fix.
- Live Senpi driver QA: no user-facing surface changed, and the hermetic suites already drive the
  real store and real publish path, so a driver run would add no coverage of the minted-id
  contract.
