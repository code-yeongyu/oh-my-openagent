## Summary

Add an opt-in, experimental Silent Fallback Guard lifecycle hook that detects suspicious fallback logic in agent-generated diffs and surfaces it for review before the task completes. The guard is fail-open, disabled by default, and report/pushback-oriented.

## Changes

- Added `packages/omo-opencode/src/hooks/silent-fallback-guard/` with:
  - `types.ts` — shared risk taxonomy, candidate schema, decision states, and config type.
  - `config.ts` — safe disabled-by-default config and resolver.
  - `normalize.ts` — normalized lexical preprocessing of unified diff added lines.
  - `detectors/js-ts.ts` — JavaScript/TypeScript fallback candidate detector.
  - `detectors/python.ts` — Python fallback candidate detector.
  - `report.ts` — review budgeting, reviewer prompt builder, and saturation summary.
  - `hook.ts` — `createSilentFallbackGuardHook()` factory firing on `session.idle`.
  - `index.ts` — barrel exports.
  - Co-located `*.test.ts` using `bun:test`.
- Added `silent_fallback_guard` config schema in `packages/omo-opencode/src/config/schema/silent-fallback-guard.ts` and wired it into the root config.
- Added `"silent-fallback-guard"` to the hook name allowlist.
- Registered the hook in the session composer and exported it from the hooks barrel.
- Dispatched the hook in the event hook dispatcher.
- Added contribution docs under `docs/proposals/silent-fallback-guard-feature-issue.md` and `docs/proposals/silent-fallback-guard-integration.md`.

## Validation

```bash
bun test packages/omo-opencode/src/hooks/silent-fallback-guard/
bunx tsc --noEmit -p packages/omo-opencode/tsconfig.json
bun run build
```

- 38/38 new hook tests pass.
- `tsc --noEmit` reports no errors.
- `bun run build` completes successfully.

## Backward compatibility

- The hook is disabled by default.
- It only activates when the hook is enabled and `silent_fallback_guard.enabled: true` is set.
- On any error (missing git, unsupported language, candidate overload, prompt dispatch failure), the hook fails open and logs a warning.
- No changes to model/provider fallback behavior.

## Checklist

- [x] Tests added for new code.
- [x] Config schema added.
- [x] Hook registered and dispatched.
- [x] Docs/proposals added.
- [x] No type errors (`tsc --noEmit`).
- [x] Build passes.

## Related

Closes #[issue number to be opened]
