# QA Evidence - fix(config-migration): keep a category models chain when merging fallback_models (#8191)

## What was tested
- RED -> GREEN on the pure transform `transformReasoningUnification`, which is what the `2026-08-reasoning-unification` plan commits.
- A driver that runs the real CLI entry point `runConfigMigrate` against a throwaway `HOME`, so the plan, the journal, the commit and the target rewrite all execute as they do for a user typing `oh-my-openagent config migrate`.
- Typecheck (`tsgo`) and the suites around config migration, the omo-config-core migration engine, config loading and the config schemas.

## What was observed
### Live surface - real `config migrate` (`driver.ts`, `before-fix.txt`, `after-fix.txt`)
Input category, written to `$HOME/.omo/omo.jsonc` with no `_migrations` marker:

```jsonc
{ "categories": { "quick": { "models": ["primary/model", "second/model"], "fallback_models": ["legacy/fallback"] } } }
```

- Before fix (`origin/dev`): `status: migrated`, and the file on disk becomes `models: ["legacy/fallback"]`. The declared chain is gone and the former fallback is now the primary model.
- After fix: `models: ["primary/model", "second/model", "legacy/fallback"]`. The chain keeps its order and the legacy fallback is appended.

Both runs exit 0 and add the `2026-08-reasoning-unification` marker, so the difference is only in the migrated document.

### RED - unmodified dev (`mutation-red.txt`)
With only the one changed line reverted to `origin/dev`, the two new tests fail (`4 pass / 2 fail`):
- chain plus legacy fallbacks collapses to the fallbacks alone
- chain plus an empty `fallback_models` collapses to `models: []`, leaving the category with no model

### GREEN - with fix (`mutation-green.txt`)
`6 pass / 0 fail`, including the committed 2026-08 fixture test, which is unchanged because that fixture has no category carrying both keys.

### Related suites (`related-suites.txt`)
`bun test` over `packages/omo-opencode/src/config-migration`, `packages/omo-config-core/src/migration`, `packages/omo-opencode/src/startup-migration.test.ts`, `packages/omo-opencode/src/config`, `packages/omo-config-core/src/schema` and the `config-migrate` CLI test: `317 pass / 0 fail`.

### Typecheck (`typecheck.txt`)
`tsgo --noEmit -p packages/omo-opencode/tsconfig.json` exit 0, no output.

## Not covered
No live OpenCode session was driven, so this is not an `opencode-qa` run. The change is confined to the document transform that `config migrate` and the plugin startup migration share, and the driver above exercises that path through the real CLI function rather than through the harness.
