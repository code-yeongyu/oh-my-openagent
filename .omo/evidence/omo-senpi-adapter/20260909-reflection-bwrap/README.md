# Reflection bwrap directory initialization

## What was tested

The production `buildSandboxTransform` wrapped the real Senpi CLI in Linux
bubblewrap with sandbox policy `required`. The fixture began with missing
`runtime/reflection-sessions` and nested `runtime/reflection/runs` directories.
Senpi used a loopback HTTP model and its real bash tool, with isolated
HOME/XDG/agent directories.

Run from the repository root:

```sh
bun .omo/evidence/omo-senpi-adapter/20260909-reflection-bwrap/live-bwrap.mjs
```

## What was observed

Before the source change, the same driver exited 1 before any HTTP request:
`bwrap: Can't find source path .../runtime/reflection-sessions: No such file or directory`.
The captured baseline is [live-bwrap-before.txt](live-bwrap-before.txt).

After the source change, [live-bwrap.json](live-bwrap.json) reported:

| Check | Result |
| --- | --- |
| Both runtime directories absent before setup | true |
| Actual sandbox enabled | true |
| Real Senpi CLI exit code | 0 |
| Newly created directory modes | 0700 |
| Real bash tool wrote inside the granted directory | true |
| File outside the write grants remained unchanged | true |
| Real HTTP requests completed | 2 |
| Real credential files unchanged | true |
| Owned sandbox removed | true |

Focused regression tests failed before the fix because the declared bind-source
directories did not exist. After the fix, the absent-path suite passed eight
tests, and the existing sandbox suite passed 15 tests with one existing skip.
The adapter package type check passed.
The full `bun run test:senpi` gate also exited 0: runtime/plugin builds and
type checking passed, followed by 3,047 passing adapter tests (three existing
skips, zero failures) and 10 passing evidence-directory resolver tests.
The captured summary is [full-gate.txt](full-gate.txt).

## Why this is enough

This exercises the failure at the real OS boundary, not only generated
arguments. The child then runs through the real Senpi transport and bash tool.
Successful writes inside the grant plus a denied outside write demonstrate
that the repair does not bypass the sandbox or broaden grants to an ancestor.
Unit tests cover nested missing directories and unchanged Darwin, disabled,
missing-bwrap, and unusable-bwrap setup behavior.

## What was omitted

No real model credentials or paid provider calls were used. The fixture does
not load OMO extensions inside the child, matching reflection's normal clean
child launch. Raw user transcript and credential content were not copied.
Darwin behavior was checked through its existing unit seam, not on a Mac.
LSP was unavailable locally; package type checking passed.
