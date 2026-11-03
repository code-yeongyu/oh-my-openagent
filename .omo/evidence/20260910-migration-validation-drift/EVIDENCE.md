# QA Evidence: migration validation tolerates pre-existing unrecognized keys

Date: 2026-09-10
Branch: fix/migration-validate-tolerate-existing-keys (worktree .local-ignore/wt-migration-validation-fix)

## WHAT WAS TESTED

Fix: `packages/omo-config-core/src/migration/commit.ts` `validateTarget()` now tolerates zod
`unrecognized_keys` issues when every flagged key already exists at the same path in the
migration target (matching `loadOmoConfig` loader semantics, which strips unknown keys with a
diagnostic instead of dropping the layer). Unrecognized keys introduced by migration additions,
unsafe keys (`__proto__`/`constructor`/`prototype`), and prototype-tampered documents stay
fail-closed (`hasTamperedPrototype` moved to `src/internal/plain-object.ts`, shared with loader).

1. Hermetic unit gate:
   - `bun test packages/omo-config-core` -> 206 pass / 0 fail (33 files).
   - New RED->GREEN test in `src/migration/merge-commit.test.ts`: target carrying
     `agents.sisyphus.ultrawork/compaction` + `agents.hephaestus.allow_non_gpt_model` migrates
     successfully and keeps the keys. RED proof: pre-fix run threw
     `MigrationValidationError: ... Unrecognized keys: "ultrawork", "compaction" ...` at commit.ts:39.
   - Pre-existing pinned test (transform-introduced `unsupported_key` still throws
     "Migration validation failed") stayed GREEN.
2. Typecheck: `tsgo --noEmit -p packages/omo-config-core/tsconfig.json` -> exit 0.
3. Real-surface QA (`qa-before-after.txt`): drove the real startup entry
   `runOpenCodeStartupMigration()` (packages/omo-opencode/src/startup-migration.ts, the exact
   function create-plugin-module.ts calls at plugin load) against an isolated replica HOME at
   /tmp/migration-schema-drift-qa/home containing a byte copy of the user's real ~/.omo/omo.jsonc
   plus a synthetic legacy source .config/opencode/oh-my-openagent.jsonc. Run twice from the task
   worktree: once with the fix `git stash`ed (BEFORE), once restored (AFTER).

## WHAT WAS OBSERVED

- BEFORE: error string identical to the user-reported startup warning:
  `Migration validation failed ... agents.sisyphus: Unrecognized keys: "ultrawork", "compaction",
  agents.hephaestus: Unrecognized key: "allow_non_gpt_model", agents.sisyphus-junior: ...`.
- AFTER: `error: null`, both migration plans status `migrated`, `_migrations` markers written,
  and all three unrecognized key groups (`ultrawork`, `compaction`, `allow_non_gpt_model`)
  preserved verbatim in the target.
- Isolation: replica HOME under /tmp only; the real ~/.omo and ~/.config were read (copy) but
  never written. No opencode process spawned, so no session DB impact.

## WHY IT IS ENOUGH

- The warning the user sees is emitted by create-plugin-module.ts printing
  `runOpenCodeStartupMigration().error`; the real-surface run reproduces that exact error pre-fix
  and shows it gone post-fix through the same entry point.
- Fail-closed behavior is pinned by the retained unit test (additions-introduced unknown keys
  still throw) and by the shared `hasTamperedPrototype`/`isUnsafeObjectKey` guards, whose loader
  coverage is unchanged.

## WHAT WAS OMITTED

- No full `opencode run` boot QA: the change lives in omo-config-core (harness-neutral) and the
  affected surface is the startup-migration call, which was driven directly at function level;
  the user's installed plugin is the published beta, not this worktree, so a local opencode boot
  would not exercise the patched code anyway.
- No secrets involved; the user config replica contains only model IDs and comments (no tokens).
