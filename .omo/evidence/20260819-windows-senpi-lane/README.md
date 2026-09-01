# Windows senpi-compatibility lane repair — QA evidence (2026-08-19)

## What was tested
- `bun test packages/omo-senpi/src/components/memory/commands/doctor.test.ts` (fixture time-bomb fix)
- `bun test packages/omo-senpi/src/components/memory/memory-usage-wiring.test.ts` (POSIX ledger-key fix)
- `bunx tsgo --noEmit -p packages/omo-senpi/tsconfig.json` (exit 0)

## RED (before the fixes)
- Local macOS, post-2026-08-19T02:01Z: doctor.test.ts → 15 pass / 1 fail:
  `/doctor > given repeated model-not-found reflection failures ...` reports
  `streak 0; fingerprint none; [ok]` instead of `streak 3; [warn]`
  (hardcoded 2026-08-12T02:01:00Z fixture vs 7-day REFLECTION_HEALTH_STALE_MS).
- CI windows-latest run 32206408283 (PR #7018) and dev run 32164968608:
  `registerMemoryUsage > ... foo.md.count is 1` fails at memory-usage-wiring.test.ts:25,
  POSIX key lookup `reference/project/foo.md` returns undefined on Windows
  (production stored the backslash form).

## GREEN (after) — see green-local.txt
- 21 pass / 0 fail across both files on macOS (the POSIX path is byte-identical
  pre/post tracker fix on POSIX; Windows equality is CI-verified).

## Why it is enough
- The doctor fix is test-only: production behavior untouched; the fixture now
  lives inside the stale window by construction (now-relative dates).
- The tracker fix only rejoins already-OS-split segments with `/`; on POSIX
  `segments.join("/") === rel` exactly, so mac/ubuntu behavior is unchanged and
  Windows keys normalize to the documented POSIX contract.

## Omitted
- Windows CI leg is the GREEN oracle for the tracker fix (no local Windows box);
  captured as the PR check URL when the lane goes green.
