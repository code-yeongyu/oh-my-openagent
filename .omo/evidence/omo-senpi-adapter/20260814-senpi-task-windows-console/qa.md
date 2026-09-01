# Windows RPC child console QA

## Scope

This evidence covers:

- the production Senpi `execution_mode: "process"` route;
- the default RPC child spawn options;
- Windows console allocation with `windowsHide: false`;
- Windows console suppression with production `windowsHide: true`;
- RPC stdio round-trip;
- real credential isolation;
- child/process-tree teardown;
- generated `omo-task.js` delivery.

## Reproducible surfaces

Package-owned console probe:

`packages/senpi-task/src/runners/rpc/__fixtures__/windows-console-probe.ts`

Package-owned console host:

`packages/senpi-task/src/runners/rpc/__fixtures__/windows-console-host.ps1`

Production routing driver:

`packages/omo-senpi/scripts/qa/task-rpc-e2e.mjs`

Exact commands are recorded in:

- `probe-command.txt`
- `routing-command.txt`

## RED progression

| Workflow/job | Observed failure | Root fix |
|---|---|---|
| `31925417976` / `95112165297` | prose-only evidence and no current-head Windows test | checked-in probe and Windows test |
| `31927904705` / `95118244973` | both controls reported `MainWindowHandle: 0`; GUI handle is not a hosted-runner console oracle | use Win32 console attachment |
| `31930067950` / `95118244973` | direct detached topology had no console to attach | add an explicit console host |
| `31931659970` / `95123440107` | redirected PowerShell host deadlocked after allocating a console | event-driven ready/stop files with no redirected host stdio |
| `31932110216` / `95128456220` | `AllocConsole` returned Win32 error 5 because the host already owned a console | accept error 5 as the satisfied precondition |
| `31932110216` / `95128456257` | production route was GREEN, but the child crashed because the QA sandbox mixed `RUNNER~1` with a canonical path | canonicalize the sandbox root using `realpathSync.native` |
| `31933958600` / `95132959708` | both children inherited the explicit host console, so attachment could not distinguish visibility | launch the Bun probe parent with `CreateNoWindow` and inspect the console HWND |
| `31935960840` / `95137818135` | `CreateNoWindow` left a windowless console object that both children inherited | call Win32 `FreeConsole` inside the Bun parent and assert HWND visibility, not console-object existence |
| `31938387966` / `95143900936` | an unrelated Git-backed `MemoryBlockCache` test hit the default 5-second Windows timeout | apply the existing 20-second Windows integration budget to every Git-backed cache test |

Raw failure payloads:

- `windows-console-probe-red.json`
- `windows-console-probe-red-31933958600.json`
- `windows-console-probe-red-31935960840.json`
- `windows-routing-red.json`
- `../../20260816-pr-6858-brutal-review/windows-cache-red.json`

## Local GREEN

- `bun test packages/senpi-task/src/runners`
  - 125 pass, 1 Windows-only skip, 0 fail.
- `bun run --cwd packages/senpi-task typecheck`
  - exit 0.
- `bun run --cwd packages/omo-senpi typecheck`
  - exit 0.
- `bun test`
  - 15,125 pass, 7 intentional platform/TUI skips, 0 fail.
- `bun run typecheck`
  - exit 0 across root, scripts, and packages.
- `bun run test:senpi`
  - 1,568 pass, 1 Windows-only skip, 0 fail.
- `bun run test:codex`
  - 519 pass, 0 fail.
- Bun 1.3.12 `build-extension.mjs --check`
  - all runtimes and extension bundles current.
- Isolated Codex installer QA
  - plugin, config, bins, and agent TOMLs landed in a throwaway `CODEX_HOME`;
  - real `~/.codex/config.toml` unchanged.

The local production driver reached the RPC runner with:

- `wiringFixed: true`
- real process-mode PID and child session JSONL
- steer acknowledgement
- completion delivery
- killed-child classification
- real credentials and full real agent-directory digest unchanged
- `leakedPids: 0`

Its separate reconcile scenario still records an unrelated breadcrumb mismatch while confirming the orphan is dead; the routing-specific checks remain truthful and GREEN.

## Final Windows GREEN payloads

Authoritative workflow:

https://github.com/code-yeongyu/oh-my-openagent/actions/runs/31939507552

`WINDOWS_CONSOLE_PROBE`

- Job: https://github.com/code-yeongyu/oh-my-openagent/actions/runs/31939507552/job/95146554570
- Raw payload: `windows-console-probe-green.json`
- visible control: detached parent, attached console, non-zero console HWND, `consoleWindowVisible: true`
- hidden production child: `consoleWindowHandle: 0`, `consoleWindowVisible: false`, `mainWindowHandle: 0`
- both stdio round trips: `true`
- both children exited: `true`
- credentials untouched: `true`
- temporary root removed: `true`

`WINDOWS_TASK_RPC_E2E`

- Job: https://github.com/code-yeongyu/oh-my-openagent/actions/runs/31939507552/job/95146554538
- Raw payload: `windows-routing-green.json`
- `wiringFixed: true`
- `process_mode_routes_to_rpc_runner: PASS`
- real RPC child PID
- child session JSONL: `true`
- credentials and full agent directory unchanged
- no leaked RPC PIDs

The production-driver payload remains aggregate `FAIL` because two unrelated lifecycle diagnostics fail. The reviewed routing, isolation, and no-leak checks are individually `PASS`; the raw payload is preserved without relabeling.

## Isolation and cleanup

- The console probe uses a fresh `mkdtemp` root and redirects both parent and child Senpi agent/session directories into it.
- The production driver ignores a caller-provided agent directory and creates its own canonical sandbox.
- Credential files are compared by digest only; digest values and credential contents are never printed.
- On timeout, the Windows tests use `taskkill /T /F` and await confirmed process close.
- Probe/driver outputs assert zero live child PIDs before success.
- Headless Parallels recovery never reached VM readiness; the Windows VM was not started and no guest checkout was created.

## Omitted

No provider tokens, auth headers, credential bodies, raw environment dumps, or private configuration contents are retained.
