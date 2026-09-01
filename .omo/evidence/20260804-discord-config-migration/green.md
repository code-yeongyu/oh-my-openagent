# Targeted GREEN Evidence

## Migrated canonical agent model chain

Command:

```text
bun test packages/omo-opencode/src/config/validate.test.ts -t 'migrated canonical agent model chain'
```

Observed:

```text
1 pass
0 fail
5 expect() calls
```

The resolved runtime config contains:

- primary `model: "provider/primary"`
- primary `reasoning: "low"`
- `fallback_models: [{ model: "provider/fallback", reasoning: "medium" }]`
- no unknown-key diagnostics for `agents.explore.models`

## Doctor plugin-harness warning behavior

Command:

```text
bun test packages/omo-opencode/src/cli/doctor/checks/deprecated-reasoning-keys.test.ts -t 'ignores plugin-supported'
```

Observed:

```text
1 pass
0 fail
2 expect() calls
```

Doctor continues to report deprecated canonical base keys, but skips OpenCode plugin harness blocks where `variant` and `fallback_models` remain supported.

## Implementation scope

- OpenCode agent override schema accepts the canonical `models` chain.
- Config-chain model input preserves `models` through unified schema resolution.
- Runtime validation materializes the chain to existing `model`, `reasoning`, and `fallback_models` consumers before disabled-provider filtering.
- Doctor deprecation scanning does not recurse into harness blocks.

## Scoped regression suite

Command:

```text
bun test \
  packages/omo-opencode/src/config-migration/reasoning-unification.test.ts \
  packages/omo-opencode/src/config/validate.test.ts \
  packages/omo-opencode/src/cli/doctor/checks/deprecated-reasoning-keys.test.ts \
  packages/omo-opencode/src/startup-migration.test.ts \
  packages/omo-opencode/src/shared/disabled-providers.test.ts
```

Observed:

```text
37 pass
0 fail
116 expect() calls
```

Strict package TypeScript diagnostic:

```text
bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json
exit 0
```

The built-in LSP tool could not inspect the task-owned sibling worktree because it only accepts paths under the session’s original checkout. No LSP-clean claim is made; strict `tsgo` is the recorded substitute.

Pure code-line measurements for every changed TypeScript file are below the 250-line limit. Highest: `config/validate.test.ts` at 238.

## Repository gates

Schema generation:

```text
bun run build:schema
✓ JSON Schemas generated: assets/omo.schema.json, assets/oh-my-opencode.schema.json
```

Full typecheck:

```text
bun run typecheck
exit 0
```

Full build:

```text
bun run build
build: all steps completed
```

The build regenerated unrelated vendored Codex/Senpi artifacts. Those build-only changes were removed from the branch; the final tracked scope contains only the required two schema assets plus six OpenCode source/test files.

## Self-review adjacent-harness GREEN

The doctor exemption was narrowed from every harness block to `[opencode]` only.

Command:

```text
bun test packages/omo-opencode/src/cli/doctor/checks/deprecated-reasoning-keys.test.ts
```

Observed:

```text
2 pass
0 fail
4 expect() calls
```

This proves:

- plugin-supported `[opencode]` tuning keys are ignored;
- canonical `[senpi]` and `[codex]` deprecated keys remain reported.

After that correction:

```text
bun run typecheck
exit 0

bun run build
build: all steps completed
```

The four unrelated rebuild-only Codex/Senpi artifacts were removed from the final diff.
