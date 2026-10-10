# Evidence: 20260824-6809-agent-state-migration

## WHAT WAS TESTED

Surface: `packages/omo-native/bin/lib/agent-dir.js` `adoptLegacyFlatState()` - the one-time
carry-forward from the legacy flat `~/.omo` layout into the canonical `~/.omo/agent`
directory, exercised through its public API exactly as the launcher calls it
(`packages/omo-native/bin/lib/launcher.js:109`), plus the package's sanctioned gates.

Commands (run from repo root of worktree `oom-wt-6809`, branch `issue/6809-agent-state-migration`):

1. RED (before the fix): `bun test packages/omo-native/test/agent-dir.test.ts`
   - 4 new regression tests failed, matching issue #6809's deterministic repro:
     - existing canonical `auth.json` + different legacy flat provider -> adoption skipped it
       (`{"adopted":false,"copied":[],"backfilled":[]}`), canonical auth unchanged;
     - existing canonical `trust.json` / `models.json` / `models-store.json` / `mcp.json` ->
       flat entries silently skipped (only `settings.json` was considered);
     - nested settings leaves (`retry.fallbackChains.secondary`) not backfilled because only
       top-level keys were considered;
     - marker `.adopted-from-omo-flat` written even when the legacy `auth.json` could not be
       parsed, permanently preventing retry.
   - 10 pre-existing tests still passed in the same run.
2. GREEN (after the fix): same command -> 14 pass / 0 fail
   (`green-scoped-agent-dir.log`). The new tests prove a migrated OAuth provider entry that
   exists only in flat `~/.omo/auth.json` is merged into an already-existing canonical
   `~/.omo/agent/auth.json` without touching the current provider, that the marker is written
   only after the merge, and that a second launch is a no-op.
3. Package gate: `bun test packages/omo-native/test` -> 129 pass / 6 skip / 1 fail
   (`package-suite.log`).
4. Typecheck: `bunx tsc -p packages/omo-native/tsconfig.json --noEmit` -> clean
   (`tsc-noemit.log`).
5. Real-surface smoke: `node packages/omo-native/bin/omo.js --version` ->
   `omo 5.0.0-0.beta.18 (engine: senpi 2026.8.23)` (`version-smoke.log`) - the launcher entry
   boots and answers under the omo brand with the fix in place.

## WHAT WAS OBSERVED

- Before: an existing canonical file made adoption skip every allowlisted state file except
  `settings.json` (old line 116: `if (file !== "settings.json") continue`), then wrote the
  adoption marker, so flat-only credentials were never picked up on any later launch.
- After: every allowlisted file whose canonical target exists is merged - missing entries are
  added at any object depth, present values are never overwritten (canonical stays the newer
  truth), prototype-dangerous keys are never copied, and an unparseable file on either side
  keeps the marker unwritten so a repaired file is adopted on the next launch.
- Isolation: all tests run against per-test `mkdtemp` homes; nothing outside the temp dirs or
  this repository was read or written.

## WHY IT IS ENOUGH

- The failing-first tests encode the exact scenario from issue #6809 and its follow-up
  comment (existing canonical auth + legacy provider) for `auth.json` and pin the same merge
  contract for every other allowlisted map file, the recursive settings backfill, parse-
  failure retry semantics, and idempotency via the marker.
- The change is confined to one module (`bin/lib/agent-dir.js`) whose only consumer is
  `launcher.js`; the package suite + typecheck + launcher smoke cover the full blast radius.
  Grep confirmed no other adoption/backfill logic exists (the senpi-side `resolveAgentHome()`
  twin resolves the directory but performs no adoption).
- Residual risk: users whose flat files contain arrays at keys that also exist canonically
  keep the canonical array (deliberate: present values always win); such values remain
  recoverable from the untouched flat originals, which adoption never deletes.

## WHAT WAS OMITTED

- No credential material anywhere: test fixtures use synthetic provider ids
  (`legacy-provider`, `current-provider`) and placeholder values (`flat-only-value`);
  no real tokens, auth headers, or env dumps were captured. Logs contain file paths and
  assertion output only.
- `payload.test.ts` (1 failure in the package suite) is environment-pre-existing and
  unrelated: it shells out to `bun run build:senpi-plugin`, which fails fetching git
  submodules (`packages/shared-skills/upstreams/*`: "Unable to find current revision in
  submodule path") in this sandbox - the same pre-existing prepare/submodule failure observed
  during `bun install`. It does not exercise `agent-dir.js`.
- A live end-to-end `omo` launch against the real pinned senpi engine was omitted: it would
  require network fetches and a staged plugin payload that cannot be built here (same
  submodule failure); the launcher version smoke plus the hermetic unit gate are the
  package's sanctioned verification surface.
