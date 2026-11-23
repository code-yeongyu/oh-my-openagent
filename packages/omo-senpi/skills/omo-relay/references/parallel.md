# Parallel work

Every helper answers a `BatchResult`: one outcome per target, in the order you gave the targets (the device list's order for the every-* helpers), and one target's failure never rejects the batch.

```ts
type Settled<Target, Value> =
  | { kind: "fulfilled"; target: Target; value: Value }
  | { kind: "rejected"; target: Target; error: { code: string; message: string; next_action: string; uncertain?: true } }
  | { kind: "skipped"; target: Target; reason: string }
type BatchResult<Target, Value> = { outcomes: Settled[]; fulfilled: Settled[]; rejected: Settled[]; skipped: Settled[]; ok: boolean }
```

`ok` is true only when nothing was rejected or skipped.

## Machines

| Shape | Call | Target in each outcome |
|---|---|---|
| Every machine of the account | `relay.onEveryMachine(fleet, op, { timeoutMs?, concurrency? })` | `{ id, alias, state }` |
| The machines you name (ids or aliases) | `relay.onMachines(fleet, ["device-b", id], op, { timeoutMs?, concurrency? })` | the name you passed |
| One machine | `relay.onMachine(fleet, "device-b", op)` | the name you passed; answers one `Settled`, not a batch |

`op` is `async (m, { signal }) => value`. `timeoutMs` is per machine: when it passes, that machine settles as rejected and the others carry on. Every machine starts at once unless you pass `concurrency`.

Observed on a seven-device account, `onEveryMachine(fleet, (m) => m.shell("uname -s"), { timeoutMs: 30000 })` answered in under a second: five fulfilled (this device among them), one skipped `machine_offline`, one skipped `machine_unsupported`. With a callback that threw on `device-b` only, `device-b` came back rejected with the thrown message and the other outcomes were unchanged.

A name that matches no machine is rejected with `not_found`; an alias two machines share is rejected with `ambiguous` (use the id). Neither runs anything.

## Threads

Bind the port with `relay.threadPortFromTools(tool)`; each helper calls the thread tools for you and turns a tool error into that thread's rejected outcome.

| Shape | Call |
|---|---|
| Send one message to several threads | `relay.sendToThreads(threads, [thread, ...], message, { delivery?, all_scope?, concurrency? })` |
| Read several threads | `relay.readThreads(threads, [thread, ...], { wait_ms?, max_bytes?, all_scope?, concurrency? })` |
| Any thread call on several threads | `relay.onThreads([thread, ...], (thread) => threads.read(thread), { concurrency? })` |
| Every listed thread | `relay.onEveryThread(threads, (row) => ..., { list: { all_scope?, state? }, concurrency? })` |

A thread is named by the `thread` value of a `tool.thread_list()` row. `onEveryThread` lists once and rejects only when that list fails (`ThreadListError` with its `code` and `next_action`): then nothing ran.

## Report the batch

```js
const r = await relay.onEveryMachine(fleet, (m) => m.shell("uname -a"), { timeoutMs: 30000 })
print(r.outcomes.map((o) => `${o.target.alias}: ${
  o.kind === "fulfilled" ? o.value.stdout.trim() : o.kind === "rejected" ? `failed ${o.error.code} (${o.error.next_action})` : `skipped ${o.reason}`
}`).join("\n"))
```

Give the user one line per target, failures and skips included.
