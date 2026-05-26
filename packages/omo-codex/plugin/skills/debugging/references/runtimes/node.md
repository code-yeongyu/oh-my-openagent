# Node.js / tsx / ts-node / Bun / Deno Debugging

Covers Node 18+, tsx, ts-node, Bun, Deno. Launch recipes, inspector protocol usage, the `node inspect` CLI, and the **tsx source-map silent-failure** that costs people days.

---

## Environment detection (Phase 0)

```bash
node --version
cat package.json | head -40

# Which JS runtime launches the app? (order them; the first match wins)
ls node_modules/.bin/tsx 2>/dev/null         && echo 'has tsx'
ls node_modules/.bin/ts-node 2>/dev/null     && echo 'has ts-node'
ls node_modules/.bin/vitest 2>/dev/null      && echo 'has vitest'
which bun 2>/dev/null                        && bun --version
which deno 2>/dev/null                       && deno --version

# Source-map situation
grep -E '"sourceMap"|"inlineSources"' tsconfig.json 2>/dev/null
grep -l '//# sourceMappingURL' dist/*.js 2>/dev/null | head -3

# Debug-relevant ports
lsof -iTCP:9229 -sTCP:LISTEN -nP 2>/dev/null
lsof -iTCP:9230 -sTCP:LISTEN -nP 2>/dev/null
```

---

## 🚨 The tsx + `node inspect` CLI silent-failure (READ THIS)

`tsx` transpiles each `.ts` file on the fly and emits an inline source map. V8 Inspector registers the module with its `.ts` path (so it shows up in the debugger's `scripts` list), **but the `node inspect` CLI REPL does not resolve source-map line numbers reliably**. Setting `sb('session.ts', 285)` will show a "pending" breakpoint that **never fires even after the module loads**.

The breakpoint list will happily display it, so you think it's set. It isn't.

### Three reliable workarounds

| Workaround | When to use | Downside |
|---|---|---|
| **`debugger;` statement in source** | You can edit the source, CLI required | Requires source edit + revert |
| **Chrome DevTools GUI** (`chrome://inspect`) | CLI not required, faster iteration | Not usable if user specifically asked for CLI |
| **Debug the built `dist/` JS** | Source maps are working end-to-end | Requires `npm run build` on every source change |

The `debugger;` statement is the most reliable. Journal the edit — revert at Phase 9.

---

## Launch recipes by runtime

### Node (plain JS / compiled TS)

```bash
# Break on first line, wait for debugger to attach
node --inspect-brk=9229 dist/index.js

# Attach immediately, don't block startup — pair with debugger; statements
node --inspect=9229 dist/index.js

# Wait for debugger to attach, THEN run (new in Node 20.15+)
node --inspect-wait=9229 dist/index.js

# Source maps in stack traces (always a good idea in debug builds)
node --enable-source-maps --inspect dist/index.js
```

### tsx

```bash
# The tsx runner is --import-compatible, so these work:
node --inspect-brk=9229 --import tsx index.ts
node --inspect=9229 --import tsx index.ts

# If user prefers invoking tsx directly, this also works but is less explicit:
NODE_OPTIONS='--inspect-brk=9229' npx tsx index.ts

# ⚠️ tsx watch + inspector = inspector reloads per file change
# Debug without watch:
node --inspect=9229 --import tsx index.ts     # (no `watch`)
```

### ts-node (legacy but still encountered)

```bash
node --inspect-brk -r ts-node/register src/index.ts
# ESM (ts-node's ESM loader is fragile — if possible, migrate to tsx):
node --inspect --loader ts-node/esm src/index.ts
```

### Bun (WebKit Inspector Protocol, NOT V8)

```bash
bun --inspect src/index.ts                    # opens debug.bun.sh URL
bun --inspect-brk src/index.ts                # break on start
bun --inspect-wait src/index.ts               # wait for attach
bun test --inspect-brk                        # debug test runner
```

**Critical**: Bun uses WebKit Inspector Protocol, not V8. `chrome://inspect` cannot connect directly. Use `debug.bun.sh` or the (currently buggy, per Bun docs) VS Code extension.

### Deno (native V8, Chrome DevTools / VS Code compatible)

```bash
deno run --inspect-brk --allow-all src/main.ts
deno test --inspect-brk --filter "auth"
```

Deno is the smoothest TS debugging experience — native V8 inspector, no source-map workarounds.

### Vitest

```bash
# Single worker required — inspector can't attach to multiple workers
vitest --inspect-brk --no-file-parallelism
vitest --inspect-brk --browser --no-file-parallelism   # browser mode
```

Without `--no-file-parallelism`, breakpoints won't fire because the process Vitest spawns workers in isn't the one listening on the inspector port.

---

## Attaching with `node inspect` CLI

```bash
node inspect 127.0.0.1:9229         # attach to an existing --inspect process
```

Core commands at the `debug>` prompt:

```
cont, c                  resume until next break / debugger;
next, n                  step over
step, s                  step into
out, o                   step out
pause                    pause a running process
bt                       backtrace
scripts                  list all modules V8 has loaded (incl. tsx-transpiled .ts)
sb(N)                    set breakpoint at line N of current file
sb('file', N)            set breakpoint at line N of matching file (⚠️ unreliable with tsx)
sb(func)                 set breakpoint at function reference
cb(N), cb('file', N)     clear breakpoint
breakpoints              list breakpoints (shows pending ones, doesn't tell you they'll never fire)
watch('expr')            persistent watch expression
watchers                 show watchers
exec('expr')             evaluate expression in paused frame's scope
repl                     drop into full REPL with frame's scope
restart                  restart the debuggee
kill                     kill the debuggee
```

**`exec('expr')` is the most powerful tool in this CLI** — it evaluates any JS in the paused frame and returns the value. Use it heavily.

---

## `exec()` patterns that resolve hypotheses fast

At a breakpoint, these queries resolve most LLM / agent / async bugs in one line each:

```js
// Agent / LLM state
exec('this.agent.state.messages.length')
exec('this.agent.state.messages.map(m => m.role)')
exec('JSON.stringify(this.agent.state.messages.at(-1)).substring(0, 500)')
exec('this.agent.state.messages.at(-1).errorMessage')      // silent-error sentinel
exec('this.agent.state.messages.at(-1).stopReason')
exec('JSON.stringify(this.agent.state.usage)')             // undefined / all-zero = failed call
exec('this.agent.state.model.baseUrl')                     // catch hardcoded vs env-var

// Env / config at runtime
exec('process.env.RELEVANT_VAR')
exec('Object.keys(process.env).filter(k => k.startsWith("ANTHROPIC"))')
exec('this.config')

// Async / timing
exec('Date.now() - this._turnStartedAt')
exec('this._activePromises?.size')

// HTTP request/response in-flight
exec('JSON.stringify(req.body).length')
exec('res.statusCode')
exec('res.headersSent')

// What's actually running
exec('process.version')
exec('process.cwd()')
exec('process.argv')
```

---

## Silent-failure patterns in Node

These are the patterns that most commonly look like success but aren't. Always check when a response is "too fast" or "too empty":

| Signal | What it means |
|---|---|
| HTTP 200 + `content: ""` | Silent error swallowed |
| HTTP 200 + response in <1s for an LLM call | Too fast for a real Claude/GPT call; something short-circuited |
| `usage: { totalTokens: 0 }` | LLM SDK returned a stub without making the call |
| `stopReason: "error" + content: []` | SDK packaged an error into a "success" message |
| Unhandled promise rejection with no log | Caller forgot to `await`, or `.catch(() => {})` |
| `try { await x(); } catch {}` | Error eaten, no log |
| `void somePromise()` | Explicit opt-out of error propagation; often a bug |
| Callback-style API where callback never fires | Error happened before callback scheduled |
| Handler returns `res.json(...)` twice | Second call is silent on some Express versions |

When you find one, add a temporary `console.error('[DEBUG]', ...)` to make it loud — journal it, revert at Phase 9.

---

## tmux session layout (two sessions, one purpose each)

```bash
# Long-running inspected process
tmux new-session -d -s debug-server -c "$PWD"
tmux send-keys -t debug-server 'node --inspect=9229 --import tsx index.ts' Enter

# Interactive debugger client (separate pane for readability)
tmux new-session -d -s debug-client -c "$PWD"
tmux send-keys -t debug-client 'node inspect 127.0.0.1:9229' Enter

# Non-blocking pane inspection from the outside
tmux capture-pane -p -t debug-server -S -50
```

Journal both session names. Kill both at Phase 9:

```bash
tmux kill-session -t debug-server
tmux kill-session -t debug-client
```

---

## When to abandon the CLI and switch to Chrome DevTools

The user's preference for CLI is valid and should be respected. But you may recommend a switch in one short sentence if ANY of these hold:

- You hit source-map resolution failures (`sb('file', line)` not firing) AND the fix is time-sensitive
- You need to watch many values simultaneously (GUI watch panel is faster to scan)
- You're stepping through async-heavy code where CLI step semantics get murky across microtask boundaries

Phrase as a note, not a request: "I can push through with `debugger;` statements in CLI. If we hit three or more of these in a row, switching to `chrome://inspect` GUI would cut cycle time in half — your call."

---

## Phase 9 cleanup specifics

```bash
# Revert source-level debug statements
git diff | grep -E '(debugger;|console\.log\(.*DEBUG|\[ARBITER-DEBUG|\[DEBUG)'
# Revert any matching files:
git checkout <file>

# Kill inspector-attached processes
pkill -f 'node --inspect' || true
pkill -f 'bun --inspect' || true
pkill -f 'deno.*--inspect' || true
lsof -iTCP:9229 -sTCP:LISTEN -nP 2>/dev/null
```
