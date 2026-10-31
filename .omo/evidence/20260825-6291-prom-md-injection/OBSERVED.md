# WHAT WAS OBSERVED

## Red phase (before fix, failing-first proof)

New regression tests run against base c7094b8ac + tests only:

```
(fail) delegate-task ... #then child launch prompt contains the planning-context marker
error: expect(received).toContain(expected)
Expected to contain: "<planning-context source=\"prometheus-read-only\">"
Received: "Find auth patterns"

(fail) call-omo-agent ... #then child launch prompt contains the planning-context marker
error: expect(received).toContain(expected)
Expected to contain: "<planning-context source=\"prometheus-read-only\">"
Received: "Find auth patterns"

error: Cannot find module './planning-context-injection' ...
 6 pass / 3 fail / 1 error
```

This reproduces #6291 at the dispatch seam: the prompt object actually handed
to the child launcher lacked the planning-context block.

## Green phase (after fix)

```
bun test <3 new files>            -> 10 pass, 0 fail
bun test prometheus-md-only + delegate-task + call-omo-agent (58 files)
                                  -> 604 pass, 0 fail, 1337 expect() calls
bun run typecheck                 -> tsgo --noEmit (root) +
                                     typecheck:script + typecheck:packages all exit 0
```

Full logs: `green-scoped-tests.log` in this directory.

Behavior after fix:

- Prometheus parent delegating via `task` or `call_omo_agent`: the dispatched
  child prompt now carries `<planning-context source="prometheus-read-only">`.
- Non-prometheus parents: prompts untouched.
- Prompt already containing the marker: unchanged (idempotent; no double
  injection if a future OpenCode propagates hook arg replacement).
- `disabled_hooks: ["prometheus-md-only"]`: dispatch-side injection disabled
  too (parity with the hook kill switch), verified by dedicated tests.
