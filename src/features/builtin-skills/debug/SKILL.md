# Debug Skill

Enterprise debugging skill for distributed systems and interactive code debugging. Provides root cause analysis, log aggregation, metrics exploration, profiling through observability platforms, AND interactive debugging with breakpoints, stepping, and variable inspection.

## Part 1: Observability Debugging (Datadog/Sentry)

### `/debug trace <error>`

Analyze an error or stack trace to find root cause across distributed services.

**Arguments:**
- `error` (required): Error message or stack trace
- `--service`: Filter to specific service
- `--time`: Time range (default: 1h)

**Example:**
```
/debug trace "Connection refused to database"
/debug trace "NullPointerException at UserService.java:42" --service user-api
```

### `/debug logs <query>`

Search and aggregate logs across services.

**Arguments:**
- `query` (required): Search query
- `--service`: Filter to specific service
- `--level`: Log level filter (debug, info, warn, error, fatal)
- `--time`: Time range (default: 1h)
- `--limit`: Max results (default: 100)

**Example:**
```
/debug logs "timeout"
/debug logs "payment failed" --service checkout --level error
```

### `/debug metrics <metric>`

Query and visualize metrics.

**Arguments:**
- `metric` (required): Metric name or pattern
- `--service`: Filter to specific service
- `--time`: Time range (default: 1h)
- `--agg`: Aggregation (avg, sum, max, min, p95, p99)

**Example:**
```
/debug metrics "http.request.duration"
/debug metrics "jvm.memory.used" --service api --agg p95
```

### `/debug profile <service>`

Capture performance profiles.

**Arguments:**
- `service` (required): Service to profile
- `--type`: Profile type (cpu, memory, goroutine, block, mutex)
- `--duration`: Profile duration in seconds (default: 30)

**Example:**
```
/debug profile api-gateway --type cpu
/debug profile worker --type memory --duration 60
```

## Part 2: Interactive Debugging (DAP/LLDB/GDB)

### `/debug launch <program>`

Start debugging a program with full control over execution.

**Arguments:**
- `program` (required): Path to program or script
- `--lang`: Language (python, javascript, typescript, rust, cpp, c, go, java, csharp)
- `--args`: Program arguments
- `--cwd`: Working directory
- `--stop-on-entry`: Stop at program entry point

**Example:**
```
/debug launch src/main.py --lang python
/debug launch ./target/debug/myapp --lang rust --args "--config prod.toml"
/debug launch server.js --lang javascript --stop-on-entry
```

### `/debug attach <target>`

Attach debugger to a running process.

**Arguments:**
- `--pid`: Process ID to attach to
- `--port`: Debug port (for Node.js --inspect, etc.)
- `--host`: Remote host (default: localhost)
- `--lang`: Language

**Example:**
```
/debug attach --pid 12345 --lang python
/debug attach --port 9229 --lang javascript
```

### `/debug breakpoint <action>`

Manage breakpoints.

**Actions:**
- `set <file>:<line>`: Set breakpoint at file:line
- `remove <file>:<line>`: Remove breakpoint
- `list`: List all breakpoints
- `clear`: Remove all breakpoints

**Options:**
- `--condition`: Conditional expression (break only when true)
- `--hit-count`: Break after N hits
- `--log`: Log message instead of breaking (logpoint)

**Example:**
```
/debug breakpoint set src/auth.py:42
/debug breakpoint set src/handler.rs:100 --condition "user_id == 123"
/debug breakpoint set server.js:50 --log "Request: {req.method} {req.url}"
/debug breakpoint list
/debug breakpoint remove src/auth.py:42
```

### `/debug step <action>`

Control execution stepping.

**Actions:**
- `into`: Step into function call
- `over`: Step over current line
- `out`: Step out of current function

**Example:**
```
/debug step into
/debug step over
/debug step out
```

### `/debug continue`

Continue execution until next breakpoint or program end.

**Example:**
```
/debug continue
```

### `/debug stacktrace`

View the current call stack.

**Example:**
```
/debug stacktrace
```

**Output:**
```
#0 authenticate() at src/auth.py:42
#1 handle_request() at src/handler.py:156
#2 main() at src/main.py:23
```

### `/debug variables [scope]`

Inspect variables in current scope.

**Scopes:**
- `local`: Local variables (default)
- `global`: Global variables
- `closure`: Closure variables
- `all`: All scopes

**Example:**
```
/debug variables
/debug variables local
/debug variables global
```

### `/debug evaluate <expression>`

Evaluate an expression in the current debug context.

**Options:**
- `--frame`: Stack frame ID (default: current frame)

**Example:**
```
/debug evaluate user.email
/debug evaluate len(items)
/debug evaluate "self.config['timeout'] * 2"
```

### `/debug session <action>`

Manage debug sessions.

**Actions:**
- `list`: List active sessions
- `switch <id>`: Switch to session
- `terminate [id]`: Terminate session (current if no ID)

**Example:**
```
/debug session list
/debug session switch 2
/debug session terminate
```

## Integrations

### Observability Platforms

#### Datadog
Provides metrics, logs, traces, and profiling.

**Required environment variables:**
- `DD_API_KEY`: Datadog API key
- `DD_APP_KEY`: Datadog application key
- `DD_SITE`: Datadog site (default: datadoghq.com)

#### Sentry
Provides error tracking and release management.

**Required environment variables:**
- `SENTRY_AUTH_TOKEN`: Sentry auth token
- `SENTRY_ORG`: Sentry organization slug

### Interactive Debuggers

#### MCP-Debugger (Python, JavaScript, Rust)
Multi-language DAP-based debugger with 1019+ tests.

**Supported languages:** Python (debugpy), JavaScript/Node.js (js-debug), Rust (CodeLLDB)

#### LLDB MCP (C/C++/Rust/Swift)
Full LLDB integration for native debugging.

**Features:** Memory examination, disassembly, watchpoints, core dump analysis

**Required:** LLDB installed on system

#### DevTools Debugger MCP (JavaScript/TypeScript)
Chrome DevTools Protocol integration.

**Features:** Source maps, console capture, network inspection

#### JetBrains MCP (All Languages)
IDE-integrated debugging via JetBrains IDEs 2025.2+.

**Features:** 29 built-in tools including breakpoints, run configurations, error analysis

**Setup:** Built-in for JetBrains 2025.2+, or `npx @jetbrains/mcp-proxy` for older versions

## Language Support Matrix

| Language | Debugger | Features |
|----------|----------|----------|
| Python | debugpy (mcp-debugger) | Full DAP support |
| JavaScript | js-debug (mcp-debugger) | Source maps, async stacks |
| TypeScript | js-debug + DevTools | Full type-aware debugging |
| Rust | CodeLLDB | Memory inspection, disassembly |
| C/C++ | LLDB/GDB | Full native debugging |
| Go | Delve | Goroutine inspection |
| Java | JetBrains/DAP | Full JVM debugging |
| C# | netcoredbg | .NET Core debugging |

## Best Practices

### Observability Debugging
- Start with `/debug trace` for unknown production errors
- Use `/debug logs` to gather context around specific timeframes
- Use `/debug metrics` to identify performance degradation
- Use `/debug profile` for optimization work, not incident response

### Interactive Debugging
- Set breakpoints at suspicious locations before launching
- Use conditional breakpoints to catch specific cases
- Use `/debug evaluate` to test hypotheses without code changes
- Use logpoints for printf-style debugging without stopping execution
- Check `/debug variables` and `/debug stacktrace` together for full context
