# dag eval SDK error surfacing — QA evidence (2026-08-21)

Branch: `fix/dag-sdk-error-surfacing` (base `dev`, rebased onto `354ce6326`).

## Root cause

`packages/omo-senpi/plugin/runtime/dag/sdk.js` `start()` read
`response?.details?.run_id ?? response?.run_id` and, when that was absent, threw
`"The dag start response did not include a run_id."`.

The dag tool reports a refusal *in band*: it resolves successfully with an error envelope
(see `packages/omo-senpi/src/components/task/dag-tool-contract.ts`, `failure()`):

```json
{
  "content": [{ "type": "text", "text": "dag run key \"X\" already exists with a different definition" }],
  "details": {
    "kind": "error",
    "error": {
      "code": "definition_conflict",
      "message": "dag run key \"X\" already exists with a different definition",
      "nodes": [], "errors": [], "diagnostics": [], "node_ids": []
    }
  }
}
```

That envelope carries no `run_id`, so the SDK fell through to the generic run_id message and hid the
real `definition_conflict`. In the live incident the operator had to re-probe the raw `tool.dag`
from a Python cell to discover the run key had merely collided. `library.js` `start()` had the same
defect with the message `"dag library: the dag start response did not include a run_id."`.

Only `start()` looked at `run_id`, so every other action (`wait`, `attach`, `snapshot`, `cancel`,
`retry`, `send`, `amend`) silently returned the error envelope as if it were a success.

## Fix

One choke point per file, applied to every action:

- `sdk.js`: `callDag()` is now `async` and routes every response through `throwIfToolError(action, response)`.
  Because all actions already funnel through `callDag`, this covers the whole surface.
- `library.js`: the `start()` round-trip is wrapped in the same helper.

Message format: `dag <action> failed: <code>: <message>` (library: `dag library: <action> failed: ...`).
Fallback order: `code: message` → first `content[].text` → generic `"the dag tool reported an error with no details."`.
The pre-existing run_id throw is retained for well-formed non-error responses that still lack a run_id.

Both files remain import-free (asserted by an existing test), as the eval worker has no
node_modules resolver.

## Verification

| File | Content |
|---|---|
| `red-bun-test.txt` | RED: production code reverted to origin/dev, new tests kept → **7 fail / 24 pass** |
| `green-bun-test.txt` | GREEN: fix applied → **31 pass / 0 fail** in one run |
| `live-message-probe.txt` | Real thrown messages for start/wait/attach + library start |
| `baseline-pristine-dev-unrelated-failures.txt` | The 13 unrelated omo-senpi failures reproduced on pristine origin/dev |
| `typecheck.txt` | `tsgo --noEmit -p packages/omo-senpi/tsconfig.json` → clean |
| `build-extension-check.txt` | `build-extension.mjs --check` → build current |

### Unrelated pre-existing failures

`bun test packages/omo-senpi` reports 13 failures (init-deep-advisor, cli-local,
session-start-ordering, product-identity). These reproduce identically on a pristine
`origin/dev` tree with none of this branch's changes applied — see
`baseline-pristine-dev-unrelated-failures.txt`. They are env-sensitive and out of scope.
