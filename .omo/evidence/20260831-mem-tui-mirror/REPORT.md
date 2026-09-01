# TuiStateMirror heartbeat lifecycle evidence

Date: 2026-08-31
Branch: fix/mem-tui-mirror-heartbeat

## RED

Command:

```text
bun /tmp/omo-mac-test.mjs fix/mem-tui-mirror-heartbeat -- packages/omo-opencode/src/features/tui-sidebar
```

Result: exit 1; 57 pass, 1 fail.

```text
error: expect(received).toHaveBeenCalledTimes(expected)
Expected number of calls: 1
Received number of calls: 0
(fail) TuiStateMirror > #given a started mirror #when started #then heartbeat handle is unref'd
1 tests failed:
57 pass
1 fail
```

## GREEN

Command:

```text
bun /tmp/omo-mac-test.mjs fix/mem-tui-mirror-heartbeat -- packages/omo-opencode/src/features/tui-sidebar packages/omo-opencode/src/plugin-dispose.test.ts
```

Result: exit 0.

```text
(pass) TuiStateMirror > #given a started mirror #when started #then heartbeat handle is unref'd
(pass) createPluginDispose > #given plugin with a TUI mirror #when dispose() is called #then the mirror is stopped
65 pass
0 fail
124 expect() calls
Ran 65 tests across 11 files.
```

## Changes

- Heartbeat interval calls `unref?.()` after creation.
- Plugin disposal accepts an optional TUI mirror and calls `stop()` inside the idempotent disposal promise.

## Production assembly wiring correction

### RED

Command:

```text
bun /tmp/omo-mac-test.mjs fix/mem-tui-mirror-heartbeat -- packages/omo-opencode/src/features/tui-sidebar packages/omo-opencode/src/plugin-dispose.test.ts packages/omo-opencode/src/testing
```

```text
(fail) createPluginModule() > #given bundled security skills are enabled > #then dispose stops the started TUI state mirror
103 pass
1 fail
```

### GREEN

Same command after wiring the production call site:

```text
104 pass
0 fail
193 expect() calls
Ran 104 tests across 14 files.
```
