# Explicit task model suffix regression

## What was tested

The explicit task planner and in-process child start boundary were exercised
through the real Senpi CLI and rebuilt OMO plugin, not a mocked runner.
The local HTTP server returned a scripted `task` call and captured the actual
child request's model and reasoning effort. Each case used its own temporary
HOME, XDG directories, and agent directory with mock credentials only.

Run from the repository root:

```sh
node .omo/evidence/omo-senpi-adapter/20260909-model-suffix/live-model-suffix.mjs
```

## What was observed

All scenarios passed on the final source and generated bundle:

| Scenario | Expected | Observed |
| --- | --- | --- |
| Explicit `omo-suffix/gpt-6-astra:low` | Exact Astra model, low effort | One child HTTP request with `model: gpt-6-astra`, `reasoning_effort: low`; task completed |
| Plain `omo-suffix/gpt-6-astra` | Existing default effort | One child HTTP request with the same model and medium effort; task completed |
| Explicit unregistered model with `:low` | Refuse child execution | Zero child HTTP requests; task record and returned task details both reported `status: error` |

The machine-readable receipt is [live-model-suffix.json](live-model-suffix.json).
It records `realCredentialsUntouched: true` and
`sandboxCleanupComplete: true`. All three CLI processes exited with code 0.
The rejected task is reported through task status, not the parent CLI exit code.

Regression tests were added before the fix. The initial run reported six
expected failures, including a suffix retained in the model ID and an unknown
model reaching `runner.start`. After narrowing the fix to canonicalization at
the planner and exact lookup at the runner boundary, the focused run passed
40 tests with zero failures. Both package type checks passed.

The complete `packages/senpi-task` suite passed 1,977 tests with zero failures.
Its existing Windows-only console suppression test was skipped on Linux.
The full `bun run test:senpi` gate completed with exit code 0, including runtime
and plugin builds, adapter type checking, 3,037 passing adapter tests (three
existing skips), and 10 passing evidence-directory resolver tests. No tests
were newly skipped.

## Why this covers the regression

The HTTP capture independently verifies execution rather than trusting the
requested-model label. The unknown-model case proves a failed lookup cannot
silently start an unrelated default model. The plain-model case protects the
existing no-suffix behavior. Unit coverage also preserves embedded slashes,
non-reasoning colon suffixes, agent persona selection, and reasoning precedence.

## What was omitted

No real provider credentials or paid model requests were used. Raw real-user
session logs were not copied. The fixture uses a local provider with an Astra
model ID so the same planner, registry, child session, and HTTP client paths
execute without accessing OpenAI or Anthropic. LSP diagnostics were unavailable
because `typescript-language-server` was not installed; both package `tsgo`
checks were used instead.
