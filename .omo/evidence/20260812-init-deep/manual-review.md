# Manual instruction-surface review

## What was reviewed

- `packages/AGENTS.md`, especially the Core package table.
- `packages/memory-core/AGENTS.md` from top to bottom.
- `packages/memory-core/src/index.ts` to verify the documented public barrel.
- `packages/omo-senpi/src/components/memory/AGENTS.md` to check the adapter/core
  boundary and avoid duplicated adapter instructions.

## Exact checks

```bash
for p in src/git src/identity src/locks src/memfs src/tools src/journal \
  src/reflection src/compile src/search src/sync src/reminders src/seeds \
  src/concurrency src/index.ts src/harness-neutrality.test.ts; do
  test -e "packages/memory-core/$p"
done

for sym in runMemoryTool runMemoryApplyPatch GitMemoryRepo \
  evaluateTransitions reserveTransition completeTransition \
  compileMemoryBlock compileMemoryBlockAtRevision; do
  git grep -q "$sym" -- packages/memory-core/src
done
```

Observed:

```
NAMED_PATHS_OK
NAMED_SYMBOLS_OK
STYLE_OK
```

## Review verdict

- The guide is package-scoped: it maps the 13 source domains, core invariants,
  public surfaces, consumers, package QA, and local anti-patterns.
- It does not restate root OpenCode/Codex QA instructions or the full adapter
  architecture.
- The Senpi component remains the owner of adapter-specific registration and
  lifecycle behavior.
- Every named path and symbol exists in the current source.
- The guide avoids prohibited dash characters and repository-banned filler.
- The package table link is the only ancestor edit.

PASS.
