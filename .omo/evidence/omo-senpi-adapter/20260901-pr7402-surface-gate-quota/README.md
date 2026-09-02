# PR 7402 staged Senpi gate quota

## What was tested

- The canonical evidence path was resolved with the `senpi-qa` resolver.
- Bun 1.4.0 rebuilt the staged agent toolkit and all Senpi extension bundles.
- `bun run test:senpi` exercised the packaged adapter and bundle contracts.
- The built staged `omo-agent-toolkit` received alternating generic and
  explicit Senpi gate-review spawns against one goal attempt.
- The Senpi adapter driver self-test and real isolated adapter run were driven.

## What was observed

- Senpi gate: 2461 pass, one Windows-only skip, 0 fail, 7906 assertions across
  327 files; evidence resolver 10 pass, 0 fail.
- All six extension artifacts and staged runtimes were current under Bun 1.4.0.
- Built surface: attempts 1-3 were allowed and attempt 4 was denied as
  `omo-senpi-gate-reviewer 4/3`; one Senpi counter remained at 3 and no
  LazyCodex gate counter existed.
- Real adapter: `result=PASS`, ultrawork injected, comment checker passed,
  caller-provided agent dir ignored, no protected or observed Senpi/OMO path
  changed, and the real credential digest stayed unchanged.

## Why this is enough

The built bundle proof executes the exact distribution boundary named by the
review finding, including its baked `surface.json`. The full gate covers
packaging and adjacent adapter behavior. The real driver proves the locally
built Senpi plugin still loads and operates without writing protected user
state.

## Cleanup

The live sandbox, built-surface fixture, isolated Bun runtime, LSP daemon, and
typings installer were removed. No matching task-owned process survived.
See `cleanup.txt`.

## Cross-surface explicit alias follow-up

All explicit aliases for a reviewer lane now canonicalize through the active
surface. On the rebuilt staged Senpi toolkit, alternating Senpi and LazyCodex
code-review aliases allowed attempts 1-3 and denied attempt 4 as
`omo-senpi-code-reviewer 4/3`; the Senpi counter remained 3 and the LazyCodex
counter was absent. The exact Senpi gate completed with exit 0, Bun 1.4.0
freshness passed, and a fresh real adapter run preserved protected host state.
See `alias-live-adapter.redacted.json`.

## Newest upstream re-verification

After merging upstream through `b5cbae3fb`, Bun 1.4.0 rebuilt and verified the
staged runtimes and all six Senpi extensions. The exact Senpi gate completed
with 2464 pass, one Windows-only skip, zero failures, and 7914 assertions; the
evidence resolver passed 10 tests.

The real driver was then rerun from that exact tree. Its self-test passed and
the live adapter reported `result=PASS`, ultrawork injection, and a passing
comment checker. It reported no protected Senpi/OMO state changes and an
unchanged credential digest. One unrelated OpenClaw session log changed as
volatile background activity and was not attributed to the adapter run.

## What was omitted

Temporary sandbox paths, raw environment values, credentials, authentication
data, private configuration, and unrelated session content are omitted.
