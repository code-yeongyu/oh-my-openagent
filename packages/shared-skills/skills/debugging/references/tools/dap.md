# DAP Client (`dap.mjs`) — Drive the Debugger's Protocol, Not Its Text

**Design modeled on the `debug` tool of oh-my-pi (https://github.com/can1357/oh-my-pi, branch omp2).** Their harness proved the shape: one structured debug surface with bounded output, stop snapshots, and classified errors. This script brings the same discipline to any agent with a shell — no harness tool registration required.

Debuggers already speak the Debug Adapter Protocol (DAP), a machine-readable JSON protocol. Driving DAP beats screen-scraping a PTY for the same reason an API beats OCR: structured stops, structured variables, structured errors. **If the debugger speaks DAP, use this script instead of parsing `gdb`/`pdb` output.**

The script is at `references/scripts/dap.mjs` — zero dependencies, runs under Bun or Node.

---

## When to use which interface

| Situation | Use |
|---|---|
| Source-level debugging of Python / Go / Node / native code, and you need breakpoints, stepping, variables | `dap.mjs` (this file) |
| Browser-served JS, or anything already in Chrome | Scripted CDP — see `references/runtimes/node.md` |
| Stripped binary, no source, no symbols | Ghidra (static) + Frida (live) — see `references/tools/` |
| The debugger has no DAP mode (plain gdb on an exotic target) | pwndbg, with the output-budget rule from `references/methodology/00-setup.md` |

---

## How to drive it

`dap.mjs` is a **REPL**, not a one-shot command: a debug session is long-lived, so the script runs as a persistent process reading one command per line on stdin and writing bounded text on stdout. Run it as a background shell session, send commands to its stdin, and subscribe to its output.

```
bun references/scripts/dap.mjs
```

Every execution-control answer prints a single snapshot line beginning with `STOP:` — subscribe your watcher to that exact prefix so a breakpoint hit wakes you instead of you polling.

### Commands

| Command | Effect |
|---|---|
| `launch <adapter> <program> [args...]` | Spawn a stdio adapter (path to executable or `.mjs` adapter) and launch the program under it |
| `attach <host:port>` | Connect to a listening adapter over TCP and attach |
| `break <file>:<line>` / `rmbreak <file>:<line>` | Set / remove a source breakpoint |
| `continue` / `step` / `next` / `stepin` / `stepout` / `pause` | Execution control; each prints a `STOP:` snapshot when the debuggee next stops |
| `stack [limit]` | TSV backtrace, bounded |
| `scopes` | Scopes of the top frame with their variablesReferences |
| `vars <ref>` | Variables under a variablesReference from `scopes` — refs are session-scoped; always chain `scopes` first |
| `eval <expr>` | Evaluate in the top frame |
| `threads` / `sessions` | Thread list / session state |
| `terminate` / `quit` | End the debuggee / exit the REPL |

### Output contract (what keeps your context alive)

- Tabular results are TSV with a header row.
- Hard caps: `MAX_ROWS = 100`, `MAX_OUTPUT_BYTES = 32 KB`. Overflow prints an explicit `TRUNCATED: rows dropped=N bytes dropped=M` line — never a silent cut.
- After every continue/step: `STOP: stopped reason=<why> threadId=<id> <frame> at <file>:<line>:<col>`. On debuggee exit: `EXIT: terminated`.
- Errors are one line, classified: `ERR: invalid-args | no-session | adapter-failed | unverified-breakpoint | timeout | terminated | adapter-error`. The token tells you the recovery — see the failure taxonomy in `references/methodology/02-investigate.md`.
- Every request times out after 15 s (override with `DAP_TIMEOUT_MS`) and the session stays alive.
- `DAP_DEBUG=1` logs raw protocol traffic to stderr for diagnosing a misbehaving adapter.

### Adapter quirks this client already handles

- **debugpy** requires `console: "internalConsole"` in the launch request, and withholds the `initialized` event for unrecognized `adapterID`s — the client sends both correctly. It also flushes `initialized` lazily, so the client launches first and awaits the event after.
- **lldb-dap** reports the launch response's `success` unreliably (`false` even when the process started and stopped) and reports `threadId: 0` on the entry stop. The events are the real signal; the client tolerates the response flag.

---

## Adapter matrix

Translated from oh-my-pi's `builtin_adapters()` (omp2 `crates/docserver/src/dap_adapter.rs`). Install the one matching your runtime; the client speaks to all of them the same way.

| Runtime | Adapter | Install | Launch mode |
|---|---|---|---|
| Python | debugpy | `pip install debugpy` | `python -m debugpy.adapter` (stdio) |
| Go | dlv | `go install github.com/go-delve/delve/cmd/dlv@latest` | `dlv dap` (stdio) |
| C/C++/Swift/Rust/Zig | lldb-dap | ships with Xcode CLT / LLVM | `lldb-dap` (stdio) |
| C/C++/Rust/Zig | codelldb | VS Code extension binary | stdio |
| C/C++/Rust | gdb | `brew install gdb` / apt | via gdb's DAP mode where available |
| JS/TS | js-debug | `npm i -g @vscode/js-debug` | stdio |
| .NET | netcoredbg | GitHub releases | stdio |
| Ruby | rdbg | `gem install debug` | stdio |
| Kotlin | kotlin-debug-adapter | GitHub releases | stdio |
| PHP | php-debug-adapter | composer | stdio |
| Bash | bash-debug-adapter | GitHub releases | stdio |
| Dart/Flutter | dart debug adapter | ships with Dart SDK | `dart` (stdio) |
| Elixir | elixir-ls debugger | GitHub releases | stdio |

If an adapter is missing, the install line is the fix — do not fall back to scraping a REPL.

---

## Worked example (Python)

```
launch /path/to/python -m debugpy.adapter myscript.py   # or a wrapper script path
break myscript.py:12
continue
STOP: stopped reason=breakpoint threadId=1 compute at myscript.py:12:1
stack
scopes
vars 6          # the variablesReference scopes just printed for Locals
eval total
continue
terminate
quit
```

Cleanup is part of the session: `terminate` the debuggee, `quit` the REPL, and journal any wrapper scripts you created per the skill's cleanup phase.
