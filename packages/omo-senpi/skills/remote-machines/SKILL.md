---
name: remote-machines
description: "Runs commands and jobs on the account's other machines, moves files to them, fans one command out to several at once, and starts or steers agent sessions on another device. Use when work must happen on a machine other than this one, or the user names another device, host or session."
metadata:
  short-description: Run on, copy to, and talk to the account's other machines
---

# remote-machines

Every device signed in to this omo account is reachable from a js eval cell through two surfaces:

- **Machines** (`bunshin`, an SDK imported in the cell): run a command, start a long job, write or list files, fan one callback out over many machines.
- **Sessions** (`tool.thread_*`, eval-only tools): list the agent sessions on every device, create one on another device, send it a message, read its transcript, interrupt or close it.

Both ride this device's device service and the relay. Same-account sign-in is the authorization: there is no consent prompt. A device id is the same 32-hex string on both surfaces, so an id from `bunshin.listMachines()` is a valid `device` for `thread_create`.

## Machines

```js
const sdk = await import(`${env("OMO_BUNSHIN_TS_SDK_ROOT")}/sdk.js`)
const { bunshin } = sdk
const machines = await bunshin.listMachines()  // [{ id, alias, os, arch, state: "online"|"offline", unsupported?, ... }]
const m = await bunshin.getMachine(idOrAlias)  // throws MachineNotFoundError on a miss
```

Read `state` and `unsupported` from the row before calling: an offline or unsupported machine cannot run anything.

| Call | Returns | Use for |
|------|---------|---------|
| `m.shell(cmd, { cwd?, env?, timeoutMs? })` | `{ exitCode, stdout, stderr, signal, timedOut, truncated, durationMs }` | One-shot command. A non-zero `exitCode` is a result, not a throw. |
| `m.exec_command({ cmd, workdir?, yield_ms? })` | `{ handleId, output, state, exitCode?, ... }` | Command that may still be running when `yield_ms` passes; poll with `m.wait_for_command`, feed with `m.write_stdin`, stop with `m.kill_terminal`. |
| `m.spawn(cmd, { cwd? })` | `CommandHandle`: `await h.wait()` -> `{ exitCode, output, durationMs, truncated }`; `h.status()`, `h.output()` (async iterable), `h.write(data)`, `h.kill()` | A job that outlives one call (builds, test runs). |
| `m.write(path, text \| Uint8Array, { createParentDirs? })` | `{ path, writtenBytes }` | File transfer to the machine. Absolute path inside the device's scope root (its home directory). |
| `m.readText(path)` / `m.read(path)` | `string` / `Uint8Array` | File transfer from the machine. See the version note below. |
| `m.glob(pattern, { limit? })` | `{ entries, truncated }` | Find files; a relative pattern resolves against the scope root. |
| `m.grep(path, pattern, { limit? })` | matches | Search file contents. |
| `m.processInfo({ pid? \| handleId? })` | `{ pid, startedAtMs, cpuTimeMs, rssBytes, command }` | Check on a process or a spawned handle. |
| `bunshin.fanout(targets, async (m, { signal }) => ..., { concurrency?, timeoutMs? })` | `{ fulfilled: [{ machine, value }], rejected: [{ machine, error }], skipped?: [{ machine, reason }] }` | Same callback on many machines. `targets` is an array of ids/aliases/machines, `{ tag }`, or `"all"`. |

Version note: on omo 5.1.69 `read` and `readText` fail with `invalid fs.read result: truncated must be a boolean for byte results`; it is fixed in 5.1.70. On 5.1.69 read a text file with `(await m.shell("cat " + path)).stdout` (pipe through `base64` for binary).

`pushTree` / `pullTree` are not part of the relay surface; copy a tree with `write` per file, or pack it (`tar` + `base64`) and unpack it with `shell`.

## Sessions

Each thread tool returns `{ details: { result } }`; `result.kind` is `"ok"` or `"error"`. A failure is data, never a throw: read `result.error.code` and do what `result.error.next_action` says. Pass `all_scope: true` on every call that addresses another device's thread.

```js
const r = (await tool.thread_list({ all_scope: true })).details.result
// r.threads[i]: { thread_id, name, status, cwd, device?, link }; device is set only for threads on another device.
// r.remote_unavailable is set when other devices could not be listed (and their threads are missing).
```

| Call | Use for |
|------|---------|
| `tool.thread_create({ device, cwd?, name?, alias?, skills? })` | New session on another device. Address it afterwards by the `thread_id` that `thread_list({ all_scope: true })` reports for it (match the `name` you gave and the `device`). |
| `tool.thread_send({ thread, message, delivery?: "auto"\|"steer"\|"follow_up", all_scope: true })` | Give it work. `auto` steers a running turn or starts a new one. |
| `tool.thread_read({ thread, max_bytes?, cursor?, all_scope: true })` | Read its transcript; continue a truncated read with `next_cursor`. |
| `tool.thread_interrupt({ thread, all_scope: true })` | Stop its running turn. |
| `tool.thread_close({ thread, all_scope: true })` | End it when the work is done. |

## Errors and what to do

| Where | You see | Do |
|-------|---------|-----|
| fanout | `skipped` with reason `machine_offline` | The device is down. Report it; nothing ran there. Never retry in a loop. |
| fanout | `skipped` with reason `machine_unsupported` | That device's service build cannot run machine operations. If it is THIS device, run the step locally with `tool.bash`; otherwise ask for omo to be updated there. |
| direct call | `CapabilityUnavailableError` (`capability unavailable on machine <id>: shell`) | The machine is offline or unsupported; check its row's `state` / `unsupported`. |
| `getMachine` | `MachineNotFoundError` | Wrong id or alias: call `listMachines()` and use an id it returned. |
| any machine op | `e.code === "policy_denied"` (`... is outside the scope root`) | The path is outside the device's home. Use a path under the home directory (`/tmp` is refused). |
| any machine op | `e.code === "invoke_deadline"` / `"budget_exceeded"` | Too slow for one call: use `spawn` or `exec_command` instead of `shell`. |
| first `bunshin` call | `BunshinSessionError`, `e.code === "no_transport"` | This device's device service is not connected to the relay. Tell the user to sign in and turn remote control on; do not retry. |
| relay | `RelayTransportError`, `e.code` `not_connected` / `closed` / `request_timeout` | The relay link dropped. Retry once; if it repeats, report it. |
| thread tools | `device_offline` | That device is offline; nothing was queued. Retry when it is online. |
| thread tools | `not_found` | Unknown thread or device: call `thread_list({ all_scope: true })` and use an id it returned. |
| thread tools | `scope_denied` | Add `all_scope: true`; if it is already set, the other device does not allow commands from this one. |
| thread tools | `host_unavailable` | The device service or relay is not reachable, or the target device did not answer; follow `next_action`. |
| thread tools | `relay_requires_paid_plan` | The account's plan has no relay; work on this device only. |

Branch on `e.code`, not `instanceof`, for wire errors: errors raised in the relay transport do not share class identity with the SDK's exported `HubTransportError`.

## Worked example: fan a command out

```js
const { bunshin } = await import(`${env("OMO_BUNSHIN_TS_SDK_ROOT")}/sdk.js`)
const targets = (await bunshin.listMachines()).filter((row) => row.state === "online" && !row.unsupported).map((row) => row.id)
const run = await bunshin.fanout(
  targets,
  async (m) => (await m.shell("hostname")).stdout.trim(),
  { timeoutMs: 30_000 },
)
print(JSON.stringify({
  ok: run.fulfilled.map((x) => [x.machine.alias, x.value]),
  failed: run.rejected.map((x) => [x.machine.alias, x.error.code ?? x.error.message]),
  skipped: (run.skipped ?? []).map((x) => [x.machine.alias, x.reason]),
}))
```

Report all three lists: a skipped or rejected machine is part of the answer, not noise.

## Worked example: a session on another device

```js
const { bunshin } = await import(`${env("OMO_BUNSHIN_TS_SDK_ROOT")}/sdk.js`)
const device = (await bunshin.listMachines()).find((row) => row.state === "online" && !row.unsupported)?.id
const name = `disk-check-${Date.now()}`
const created = (await tool.thread_create({ device, name })).details.result
if (created.kind === "error") throw new Error(`${created.error.code}: ${created.error.next_action}`)
// Address the thread by the id thread_list reports, not by created.thread.thread_id: on some builds the id
// thread_create returns for another device is not accepted by the other thread tools.
const listed = (await tool.thread_list({ all_scope: true })).details.result
const thread = listed.kind === "ok" ? listed.threads.find((t) => t.name === name && t.device === device)?.thread_id : undefined
if (thread === undefined) throw new Error(`thread ${name} is not listed on device ${device}`)
const sent = (await tool.thread_send({ thread, message: "Report free disk space on / and stop.", all_scope: true })).details.result
if (sent.kind === "error") throw new Error(`${sent.error.code}: ${sent.error.next_action}`)
// Later, when its turn has finished:
const read = (await tool.thread_read({ thread, all_scope: true })).details.result
// read.items is the transcript; close the thread once the answer is in:
await tool.thread_close({ thread, all_scope: true })
```
