# Debug Tracing for Crash Investigation

This document explains how to use the debug tracing system to diagnose crashes in oh-my-opencode, particularly on Windows.

## Quick Start

### Enable Tracing

**PowerShell:**
```powershell
$env:OMO_DEBUG = "1"
opencode
```

**CMD:**
```cmd
set OMO_DEBUG=1
opencode
```

**Bash/Linux/macOS:**
```bash
OMO_DEBUG=1 opencode
```

### After a Crash

Create a diagnostic bundle:
```bash
bunx oh-my-opencode debug-bundle
```

This creates a JSON file with trace events, system info, and environment data (redacted for privacy).

## What Gets Traced

When tracing is enabled (`OMO_DEBUG=1`), the following events are captured:

| Category | Events |
|----------|--------|
| **Spawn** | All child process spawns (spawn.start, spawn.exit, spawn.error) |
| **Notifications** | OS notification sends (notification.send, notification.sound) |
| **Subagents** | Background agent lifecycle (subagent.start, subagent.stop, subagent.error) |
| **Background Tasks** | Async task execution (background.start, background.complete, background.error) |
| **LSP** | Language server lifecycle (lsp.*.start, lsp.*.exit) |
| **System** | Init/shutdown events, crash handlers |

## Log File Location

Default: `%TEMP%\oh-my-opencode-trace.jsonl` (Windows)

Override with:
```powershell
$env:OMO_DEBUG_LOG = "C:\path\to\trace.jsonl"
```

## JSONL Format

Each line in the trace file is a JSON object:

```json
{
  "ts": "2026-01-07T10:30:45.123Z",
  "type": "spawn.start",
  "name": "notification.powershell.start",
  "spanId": "abc123def456",
  "data": {
    "command": "powershell",
    "args": ["-Command", "..."]
  },
  "memory": {
    "rss": 150.5,
    "heapUsed": 45.2,
    "heapTotal": 60.0,
    "external": 5.1
  },
  "process": {
    "pid": 12345,
    "platform": "win32",
    "bunVersion": "1.3.5",
    "nodeVersion": "v22.12.0",
    "appVersion": "2.14.1-debug.1",
    "runId": "a1b2c3d4",
    "uptimeSeconds": 1234
  }
}
```

## Crash Handlers

The tracer automatically registers handlers for:

- `uncaughtException` - Synchronous exceptions
- `unhandledRejection` - Promise rejections
- `SIGTERM` / `SIGINT` - Termination signals
- `SIGBREAK` - Windows Ctrl+Break
- `beforeExit` / `exit` - Process exit

When any of these fire, the ring buffer is flushed to disk to preserve trace history.

## Ring Buffer

Events are stored in a 1000-entry ring buffer that:
- Keeps the most recent events in memory
- Survives most crash scenarios
- Flushes to disk every 5 seconds
- Emergency flushes on crash/exit signals

## Privacy & Redaction

The tracer automatically redacts:
- API keys and tokens (patterns like `sk-...`, `Bearer ...`)
- User home paths (replaced with `~`)
- Sensitive environment variables
- Common credential patterns

## Analyzing Traces

### Look for patterns before crash:

1. **High spawn count**: Many `spawn.start` events without corresponding `spawn.exit`
2. **Memory growth**: Increasing `memory.rss` values over time
3. **Long-running operations**: Large `durationMs` in span events
4. **Error accumulation**: Multiple `*.error` events

### Example analysis commands:

```bash
# Count events by type
jq -r '.type' trace.jsonl | sort | uniq -c | sort -rn

# Find events near crash (last 50)
tail -50 trace.jsonl | jq .

# Memory usage over time
jq -r '[.ts, .memory.rss] | @tsv' trace.jsonl

# All spawn events
jq 'select(.type | startswith("spawn"))' trace.jsonl

# Events with errors
jq 'select(.error != null)' trace.jsonl
```

## Overhead

Tracing is **OFF by default** and designed for low overhead:
- Events are buffered in memory
- Disk writes batched every 5 seconds
- Only activated via `OMO_DEBUG=1`
- No impact when disabled

## Creating a Bug Report

1. Enable tracing before the crash occurs
2. Run until crash
3. Create bundle: `bunx oh-my-opencode debug-bundle`
4. Review the bundle for sensitive data
5. Share bundle with issue report

Include:
- The diagnostic bundle JSON
- Bun crash report URL (from crash message)
- Steps to reproduce (if known)
- How long until crash occurred

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OMO_DEBUG` | Enable tracing (`1` or `true`) | Not set (disabled) |
| `OMO_DEBUG_LOG` | Custom log file path | `%TEMP%/oh-my-opencode-trace.jsonl` |

## Version

This tracing system was added in version `2.14.1-debug.1` to help diagnose Windows crashes that persist after the Bun shell GC fix (PR #543).
