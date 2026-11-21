# Machines

Everything below was observed between two devices of one account, `device-a` calling `device-b`.

## List them and pick one

```js
const rows = await fleet.listMachines()
// [{ id, alias, os, arch, state: "online" | "offline", unsupported?: true, kind, connection, tags, ... }]
```

The list includes this device. `id` is a 32-character hex string and never changes; `alias` is the device's display name and two devices can share one, so keep the `id` once you have it. A row with `state: "offline"` or `unsupported: true` cannot run operations: read both before you plan work on it.

Run on one machine through `onMachine`, which answers one outcome and never throws:

```js
const r = await relay.onMachine(fleet, "device-b", (m) => m.shell("df -h /"))
if (r.kind === "fulfilled") print(r.value.stdout)
else print(r.kind === "rejected" ? `${r.error.code}: ${r.error.next_action}` : `skipped: ${r.reason}`)
```

Inside the callback `m` is the machine; the calls below are its methods.

## Run a command

| Call | Answers | Use it for |
|---|---|---|
| `m.shell(cmd, { cwd?, env?, timeoutMs? })` | `{ exitCode, stdout, stderr, signal, timedOut, truncated, durationMs }` | One command that finishes. A non-zero `exitCode` is an answer, not a throw: check it. |
| `m.spawn(cmd, { cwd? })` | a handle: `await h.status()` -> `{ state: "running", output, elapsedMs, ... }`; `await h.wait()` -> `{ exitCode, output, durationMs, truncated }` | A job that outlives one call: builds, test runs, installs. Its `output` comes from a terminal, so lines end in `\r\n`. |
| `m.exec_command({ cmd, yield_ms })` | `{ handleId, state, output, ... }` after `yield_ms` (an integer from 250 to 10000) | Start a command and come back to it; stop it with `m.kill_terminal({ handle_id })`, which answers `{ state: "task-failed", reason: "killed" }`. Prefer `spawn` unless you need the handle id. |
| `m.processInfo()` | `{ pid, command, rssBytes, cpuTimeMs, startedAtMs, lastOpAtMs }` of the device service | Checking that the machine's device service is the one you expect. |

## Move and search files

Paths are absolute paths on that machine.

| Call | Answers |
|---|---|
| `m.write(path, textOrBytes, { createParentDirs: true })` | `{ path, bytesWritten }` |
| `m.readText(path)` / `m.read(path)` | the text / the bytes |
| `m.edit(path, { exact, replacement })` | `{ path, content, replacements, writeResult }`; `exact` must occur in the file |
| `m.glob(pattern)` | `{ entries: [path, ...], truncated }` |
| `m.grep(dir, pattern)` | `{ matches: [{ path, line, text }], truncated }` |
| `m.pushTree(localDir, remoteDir)` | `{ fileCount, dirCount, symlinkCount, writtenBytes, verifiedFiles }`: copies a directory of this device to that machine |
| `m.pullTree(remoteDir, localDir)` | `{ fileCount, writtenBytes }`: copies a directory of that machine here |

## Clean up

Put scratch files under one directory you create for the task, remove it in the same callback that finished the work, and read the removal back, because a leftover file on someone's machine is yours:

```js
await relay.onMachine(fleet, "device-b", (m) => m.shell(`rm -rf '${dir}' && test ! -e '${dir}' && echo removed`))
```
