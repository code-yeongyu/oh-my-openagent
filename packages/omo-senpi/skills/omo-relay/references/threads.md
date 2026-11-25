# Threads

A thread is an agent session on one device of the account. The thread tools reach every device's threads from a js eval cell, as `tool.thread_*`. Everything below was observed between two devices, `device-a` calling `device-b`.

Every call answers `{ kind: "ok", ... }` or `{ kind: "error", error: { code, message, next_action, details? } }`; it does not throw. Branch on `error.code`.

## List

```js
const l = JSON.parse((await tool.thread_list({ all_scope: true })).text)
// { kind: "ok", scope, devices: [...], threads: [...] }
```

- `devices` has one row per device: `{ device, name, platform, online, this_device, listing, threads }`. `listing` is `"listed"` when that device answered in full.
- `threads` has one row per thread: `{ thread, name, device?, status, state, cwd, ... }`. A thread on this device carries no `device`.
- Without `all_scope: true` the list holds only this workspace's threads on this device.
- `state` takes a list: `{ state: ["running", "idle", "inactive"] }`. A closed thread is still listed, as `state: "inactive"`, `status: "resumable"`.

## Name a thread

Use the `thread` value of a list row: it found the thread on either device. These forms were also observed:

| Form | Thread on this device | Thread on another device |
|---|---|---|
| The `thread` value | found | found |
| `<device name>/<thread value>` | | found |
| `<device name>/<thread name>` | | found |
| The thread's name | found | `not_found` |
| `here/<thread name>` | found | |
| The first 8 hex characters of the id | found | `not_found` |
| `<first 6 of the device id>/<thread name>` | | `not_found` |

So for a thread on another device, pass its `thread` value or put the device's name in front. A thread outside this session's workspace also needs `all_scope: true` on every call; without it the call answers `scope_denied`.

## Create, read, send

```js
const a = JSON.parse((await tool.thread_create({ name: "probe-a", cwd: "/tmp/probe" })).text)  // on this device
const b = JSON.parse((await tool.thread_create({ name: "probe-b", device: "device-b" })).text) // on another device
// { kind: "ok", thread, name, status: "live", state: "idle", cwd, device?, link, ... }
```

The thread on another device started in that device's own working directory. A create can answer a scope note (`workspace_scope: "outside"` and a `scope_next_action`) when its `cwd` is outside this workspace: pass `all_scope: true` to reach it afterwards.

```js
await tool.thread_read({ thread, wait_ms: 30000, max_bytes: 4000, all_scope: true })
// { kind: "ok", thread, device?, items: [{ seq, role, content }, ...] }
await tool.thread_send({ thread, message: "...", all_scope: true })
// { kind: "ok", effective_mode: "start" | "steer" | "follow_up", delivery_id, ... }
```

`effective_mode: "start"` means the message started a turn on an idle thread. `wait_ms` lets a read wait for new items.

The receiving agent sees who sent the message. Asked to "reply with the word pong", both test threads sent "pong" back to the calling session, where it arrived as a relayed message. Ask for what you want written in the thread itself if you mean to read it there.

## Interrupt, close

```js
await tool.thread_interrupt({ thread, all_scope: true }) // idle: { kind: "ok", interrupted: false, ... }
await tool.thread_close({ thread, all_scope: true })     // { kind: "ok", closed: true, reason: "closed", dropped_deliveries: [] }
```

Close the threads you created, then read the list back: each should show `state: "inactive"`.

## Several threads at once

`relay.sendToThreads`, `relay.readThreads`, `relay.onThreads` and `relay.onEveryThread`, bound with `relay.threadPortFromTools(tool)`: see [parallel.md](parallel.md). Observed: `sendToThreads(threads, [a, b, missing], "reply with the word pong", { all_scope: true })` answered one outcome per target, so a failed target did not hold back the one that was delivered.

## Watch a thread

Watch a thread with the monitor tool's session watch, `tool.monitor({ type: "rpc", target, description })`, not with a polling loop. Its registration answers what it matched: a watch on a closed thread here started with "No matching sessions yet"; a closed thread on another device answered `request_gone`; an id no device holds answered `host_unavailable`. Stop a watch you no longer need.

## What came back, and what to do

| Code | Seen when | Do |
|---|---|---|
| `scope_denied` | The thread is outside this workspace and `all_scope` was not passed. | Retry with `all_scope: true`. |
| `not_found` | No device listed a thread under that name or prefix. | Use a `thread` value from the list, or `<device name>/<thread>`. |
| `host_unavailable` (`details.reason: "device_unanswered"`) | A device did not answer the lookup round. An id that does not exist answered this too, as did a send by bare id to a thread on a busy device. | Retry that target only, addressed as `<device name>/<thread>` so only that device is asked. A send retried this way was delivered. |
| `not_resumable` | A read of a thread on another device right after a send to it ("The thread has no live owner"). | Read it again by its `thread` value: that read answered. |
| `internal_error` ("connection closed before the response arrived") | A create on this device. | List first: if no thread was made, retry once (the retry worked). Never create twice without checking. |

For a code not listed here, do what its `next_action` says.

## Limits

- The thread tools act as this session: every send, create or close is done by this agent, and the receiving agent sees it as a message from this session.
- A program that runs outside an agent session does not have the thread tools; it is not this skill's subject.
