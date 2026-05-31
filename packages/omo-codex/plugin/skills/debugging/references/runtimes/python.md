# Python Debugging

Covers CPython 3.9+, pytest, asyncio, Django, FastAPI. Setup commands, attach mechanisms, state-query patterns, gotchas, silent-failure signatures.

---

## Environment detection (Phase 0)

```bash
# Which Python will actually run the code?
which python; which python3
python --version

# Is there a project env manager in play?
ls poetry.lock uv.lock Pipfile.lock requirements*.txt .python-version 2>/dev/null

# Installed debuggers / profilers in this env?
python -c 'import pdb, sys; print("pdb", "built-in"); print("python", sys.executable)'
pip list 2>/dev/null | grep -iE '^(ipdb|pudb|debugpy|py-spy|memray|rich)\s'

# asyncio debug mode available?
python -c 'import asyncio; print(asyncio.__version__)'
```

**Wrapper gotchas** (these change how flags propagate):

- `poetry run python ...` — args after `python` are fine; args before `poetry run` go to poetry, not python
- `uv run python ...` — similar; prefer `uv run -- python -X dev` if flags collide
- `pipenv run` — same story
- `./manage.py <cmd>` (Django) — shebang resolution; make sure it points to the right venv
- `pytest` — loads `conftest.py` at collection; breakpoints inside collection need `pytest --pdb-trace` not `--pdb`

---

## The four ways to attach

| Method | When to use | Command |
|---|---|---|
| **`breakpoint()` inline** (Python 3.7+) | You can edit the source and restart. Most reliable. | Add `breakpoint()` to source. Run normally. It invokes `pdb` by default. |
| **`python -m pdb <script>`** | No source edit desired. Breaks on entry. | `python -m pdb script.py arg1` |
| **post-mortem `pdb.pm()`** | Exception already happened, you want to inspect state | In an exception-caught REPL: `import pdb; pdb.pm()` after the exception propagates |
| **debugpy (remote / IDE)** | IDE attach, remote host, containerized process | `python -m debugpy --listen 5678 --wait-for-client script.py` then attach from VS Code / PyCharm |

### Prefer `ipdb` or `pudb` over plain `pdb` when available

- **ipdb** — drop-in replacement with tab completion, syntax highlighting. `pip install ipdb`, then `PYTHONBREAKPOINT=ipdb.set_trace` or use `import ipdb; ipdb.set_trace()`.
- **pudb** — full-screen TUI debugger, much faster to navigate stack/locals. `pip install pudb`, then `PYTHONBREAKPOINT=pudb.set_trace`.

### Control `breakpoint()` globally

```bash
# Use ipdb instead of pdb
export PYTHONBREAKPOINT=ipdb.set_trace

# Disable all breakpoint() calls (useful to ship without removing them)
export PYTHONBREAKPOINT=0
```

**Journal this env var** — unset at Phase 9.

---

## pdb / ipdb essentials

At a `(Pdb)` or `ipdb>` prompt:

```
l           list source around current line
ll          list whole function
s           step into
n           step over (next)
r           step out (return)
c           continue
b           list breakpoints
b <line>    breakpoint at line
b <func>    breakpoint at function
cl <n>      clear breakpoint n
w           where (backtrace)
u / d       move up/down the stack
a           args of current frame
p <expr>    print expression
pp <expr>   pretty-print
!<stmt>     execute Python statement (e.g. !x = 5)
interact    drop into a full Python REPL with current frame's locals
q           quit (aborts the program)
```

**`interact` is underused** — it gives you a full IPython-esque REPL with all locals available. Faster than typing `p` for 20 things.

---

## pytest-specific debugging

```bash
# Enter pdb on first failure
pytest --pdb

# Enter pdb at the START of each test (not on failure)
pytest --trace

# Run only the failing test, with -s to show print output
pytest --pdb -x -s path/to/test.py::test_name

# Collect-time debugging (for problems in conftest.py / fixture setup)
pytest --pdb-trace

# Disable capture for this test (so breakpoint prompt is visible)
pytest -s
```

**Common failure**: `breakpoint()` hangs inside a pytest test — that's because pytest captures stdout/stderr by default. Always add `-s` when debugging with breakpoints inside pytest.

---

## asyncio gotchas

Async is where most Python debug sessions go sideways. Know these before attaching.

### Breakpoints inside coroutines

`breakpoint()` works inside an async function, but stepping into another coroutine from `pdb` is awkward. Two techniques:

```python
async def handler():
    result = await some_async_fn()  # add breakpoint ABOVE, not inside, when possible
    breakpoint()
    return result
```

Inside the breakpoint, to inspect a coroutine without actually advancing time:
```
!import asyncio
!loop = asyncio.get_event_loop()
!task = asyncio.ensure_future(some_async_fn())
# Now inspect task state, don't await it
p task
```

### PYTHONASYNCIODEBUG

Enable before running the process:

```bash
PYTHONASYNCIODEBUG=1 python script.py
```

Surfaces: coroutines that were never awaited, slow callbacks, unhandled task exceptions. **Always turn this on** if the bug is timing- or async-related.

### `asyncio.gather` swallows the first exception

By default, `asyncio.gather(t1, t2)` raises the first exception and cancels the rest. If you need all exceptions, use `gather(..., return_exceptions=True)`.

### Unhandled task exceptions are silent

```python
async def main():
    task = asyncio.create_task(broken_coroutine())
    # If task raises and we never await it, the exception is eaten at gc time
    await asyncio.sleep(10)
```

To catch these, set `loop.set_exception_handler(...)` or upgrade to Python 3.12+ which warns louder by default.

---

## debugpy — remote / IDE / container attach

Listen and wait for attach:

```bash
python -m debugpy --listen 0.0.0.0:5678 --wait-for-client script.py
```

Attach from VS Code:
```json
// .vscode/launch.json
{
  "name": "attach",
  "type": "python",
  "request": "attach",
  "connect": { "host": "localhost", "port": 5678 }
}
```

Inside the code, programmatic attach point:
```python
import debugpy
debugpy.listen(5678)
debugpy.wait_for_client()  # blocks until attached
debugpy.breakpoint()        # programmatic breakpoint
```

**Journal**: the port (5678) and the listener file — unset at Phase 9.

---

## Sampling profilers for "why is it slow / stuck"

When the problem is performance or a hang (not a crash), don't attach pdb — it alters timing. Use a sampling profiler that attaches to the running process:

```bash
# py-spy — production-safe, zero code change, works on running process
py-spy top --pid <pid>                       # live top-like view
py-spy record -o profile.svg --pid <pid>     # flamegraph
py-spy dump --pid <pid>                      # stack traces of all threads right now

# memray — memory allocation tracking
memray run script.py
memray flamegraph output.bin
memray stats output.bin
```

`py-spy dump` on a stuck process is often enough to find the hung call — no breakpoints needed.

---

## Silent-failure patterns in Python

Add these to Phase 8's silent-failure check:

| Pattern | Why it's silent |
|---|---|
| `except Exception: pass` or `except: pass` | Catches and discards every error including KeyboardInterrupt |
| `logging.exception(...)` in a logger with no handlers | "Logs" but actually writes nowhere |
| `asyncio.create_task(coro)` without storing the task | Task GC'd before completion, exception swallowed |
| `return x.get("key")` where key is missing | Returns None silently, caller often doesn't check |
| `subprocess.run(..., check=False)` with ignored returncode | Non-zero exit treated as success |
| Django `transaction.atomic()` inside a broader `except` | Rolls back silently |
| `contextlib.suppress(Exception)` | Explicit silencer; easy to leave wider than intended |
| `queue.get(block=False)` with `except queue.Empty: pass` | Polling that silently drops the work |

---

## Phase 9 cleanup specifics

```bash
# Remove breakpoint() / ipdb / pudb lines from source
git diff | grep -E '(breakpoint\(\)|import ipdb|import pudb|import pdb; pdb\.set_trace)'
# If the above has output, revert those files:
git checkout <file>

# Unset the global breakpoint override
unset PYTHONBREAKPOINT

# Kill any leftover debugpy listeners
pkill -f 'debugpy' || true
lsof -iTCP:5678 -sTCP:LISTEN -nP 2>/dev/null    # confirm free
```
