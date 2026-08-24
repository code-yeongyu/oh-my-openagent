# gpt-5.6 reasoning-effort clamp — QA evidence

Slug: `20260825-gpt56-reasoning-effort`
Change: clamp the reflection launch path's thinking level against model capabilities;
add the `gpt-5-6-plus` family; let provider metadata outrank family aliases.

## Live driver: FAIL (timeout) — NOT attributable to this change

`packages/omo-senpi/scripts/qa/memory-model-fallback-e2e.mjs` is the driver that
covers the changed path. It fails here:

```
error: timed out waiting for reflection completion
  memory-model-fallback-e2e.mjs:156
```

Per the senpi-qa golden rules this is a FAIL, not a pass, and it is recorded as such.

It is pre-existing. The same driver was re-run in the same sandbox with the new
clamp neutered to a pass-through (i.e. exactly the pre-change behaviour):

| run | behaviour | result | elapsed |
|---|---|---|---|
| with clamp | this change | timeout | 98.2s |
| clamp neutered | pre-change | timeout | 95.3s |

Identical outcome either way, so the driver failure does not attribute to this change.
The driver's own config pins `omo-mock/mock-1` with `reasoning: "minimal"`; that model
is an unknown family to model-core, and the clamp deliberately preserves the caller's
level for unknown families. Verified directly: `omo-mock/mock-1` + `minimal` still
resolves to `minimal`.

## Deterministic evidence

Real-world failure this fixes — three consecutive production reflection runs
(`~/.omo/memory/agents/<id>/runtime/reflection/runs/reflection-run-{1,2,3}/child-stderr.log`),
verbatim and identical in all three:

```
OpenAI API error (400): {"message":"Unsupported value: 'minimal' is not supported
with the 'gpt-5.6-luna' model. Supported values are: 'none', 'low', 'medium',
'high', 'xhigh', and 'max'.","type":"invalid_request_error",
"param":"reasoning.effort","code":"unsupported_value"}
```

Regression proof — the new launch-path test was confirmed to FAIL without the fix,
by neutering `clampThinkingToModel` to a pass-through:

```
✗ #given a gpt-5.6 model configured with the removed minimal effort
  #when resolved #then the launch path clamps it
  Expected: not "minimal"
✓ #given a gpt-5 model configured with minimal
  #when resolved #then the still-supported level is preserved
```

Restored: 18 pass / 0 fail.

Family boundary, measured via `resolveCompatibleModelSettings`:

| model | family | `minimal` resolves to |
|---|---|---|
| gpt-5.6-luna | gpt-5-6-plus | none |
| gpt-5.6-terra | gpt-5-6-plus | none |
| gpt-5.10-x | gpt-5-6-plus | none |
| gpt-5 | gpt-5 | minimal |
| gpt-5.1 | gpt-5 | minimal |
| gpt-5.2-codex | gpt-5 | minimal |
| omo-mock/mock-1 | (unknown) | minimal (preserved) |

Unit gates: `bun test` — model-settings-compatibility + remediation + resolve-model:
**107 pass / 0 fail**.

Bundle: `node packages/omo-senpi/plugin/scripts/build-extension.mjs` regenerated
`plugin/extensions/omo.js` (+2/-2 minified lines). The committed bundle previously
carried the stale `reflection-sessions/<runId>` hint; it now carries
`reflection/runs/<runId>` (stale occurrences: 0).
