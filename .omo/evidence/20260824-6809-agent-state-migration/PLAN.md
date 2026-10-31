# Plan: Fix #6809 - adoption of legacy flat state skips existing canonical files

## Root cause

`packages/omo-native/bin/lib/agent-dir.js`, `adoptLegacyFlatState()`:

- Line 110-115: when the canonical target file does NOT exist, the flat file is copied. Good.
- Line 116: `if (file !== "settings.json") continue` - when the canonical target DOES exist,
  only `settings.json` is considered; `auth.json`, `trust.json`, `models.json`,
  `models-store.json`, and `mcp.json` are silently skipped.
- Lines 123-126: the `.adopted-from-omo-flat` marker is then written, so the skipped
  credentials are never retried on a later launch.

Net effect (issue #6809 + copycatcode's deterministic repro): a user whose canonical
`~/.omo/agent/auth.json` already exists (created by the beta.7 runtime before/while the flat
migration ran) permanently loses every provider entry that only exists in the migrated flat
`~/.omo/auth.json`. Same loss applies to trust entries and model maps.

Secondary gap: `backfillSettings()` (lines 70-83) only backfills missing TOP-LEVEL keys of
`settings.json`; nested objects that partially overlap (e.g. `tipsHistory.*`) keep losing
their missing leaves.

## Change (single file + tests)

`packages/omo-native/bin/lib/agent-dir.js`:

1. Generalize `backfillSettings()` into a recursive `mergeMissing(source, target, touched,
   rootKey)` deep merge used by one `backfillJsonObject()` helper:
   - copies only properties MISSING from the canonical object, at any depth;
   - never overwrites a present value (canonical file stays the newer truth);
   - plain objects recurse; arrays/scalars/primitives never merge element-wise;
   - skips prototype-dangerous keys (`__proto__`, `constructor`, `prototype`);
   - returns the list of top-level keys that gained additions (insertion order).
2. In the adoption loop, apply `backfillJsonObject()` to EVERY allowlisted file whose
   canonical target already exists (not just `settings.json`). Parse failure of either side
   still sets `parseFailed`, keeping the marker unwritten so a repaired file is adopted later.
3. Reporting contract preserved for `settings.json`: bare top-level key names in
   `result.backfilled`. Map-file merges report `<file>:<key>` entries (e.g.
   `auth.json:legacy-provider`) so multi-file merges stay unambiguous.
4. Marker still written last, only after all merges/copies complete.

`packages/omo-native/test/agent-dir.test.ts` (failing FIRST):

- given existing canonical auth + different legacy provider -> merged, current provider
  survives, marker written after merge (the issue's named regression).
- same shape pinned for trust.json / models.json / models-store.json / mcp.json.
- settings deep backfill: nested missing leaf added, present leaf untouched.
- malformed legacy auth with existing canonical auth -> no crash, no marker, retry possible.

## Verification

1. RED: `bun test packages/omo-native/test/agent-dir.test.ts` fails before the fix.
2. GREEN: same command passes after the fix.
3. Scoped gate: `bun test packages/omo-native/test` (whole package suite).
4. Typecheck: `bunx tsc -p packages/omo-native/tsconfig.json --noEmit`.
5. Real-surface smoke: `node packages/omo-native/bin/omo.js --version`.
6. Evidence written to this directory (WHAT TESTED / OBSERVED / WHY ENOUGH / OMITTED),
   secrets redacted; force-added via `git add -f`.

## Explicitly out of scope

- No changes to `packages/omo-senpi/src/components/agent-home/` (adapter twin resolves the
  directory but performs no flat adoption; grep confirmed adoption logic exists only here).
- No migration of additional files beyond the existing allowlist.
