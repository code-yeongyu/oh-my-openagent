# Threads

A thread is an agent session on one device of the account. The thread tools reach every device's threads from a js eval cell, as `tool.thread_*`. Everything below was observed between two devices, `device-a` calling `device-b`; the address forms and the `not_found` answers on omo 5.1.83.

Every call answers `{ kind: "ok", ... }` or `{ kind: "error", error: { code, message, next_action, details? } }`; it does not throw. Branch on `error.code`.

## List

```js
const l = JSON.parse((await tool.thread_list({ all_scope: true })).text)
// { kind: "ok", scope, devices: [...], threads: [...] }
```

- `devices` has one row per device: `{ device, name, platform, online, this_device, listing, threads }`. `listing` is `"listed"` when that device answered in full.
- `threads` has one row per thread: `{ thread, name, device?, status, state, cwd, ... }`. A thread on this device carries no `device`.
- `all_scope: true` widens this device's part of the list from this workspace to every workspace. The other devices' threads are always listed.
- `state` takes a list: `{ state: ["running", "idle", "inactive"] }`. A closed thread is still listed, as `state: "inactive"`, `status: "resumable"`.

## Name a thread

Use the `thread` value of a list row. Each of these forms also found the thread:

| Form | Thread on this device | Thread on another device |
|---|---|---|
| The `thread` value | found | found |
| The thread's name | found | found |
| The first 8 hex characters of the id | found | found |
| `here/<thread name>` | found | |
| `<device name>/<thread name>` or `<device name>/<thread value>` | | found |
| `<first 6 of the device id>/<thread name>` or `/<thread value>` | | found |

A name or a prefix has to be unique among the threads it is matched against. Put a device in front when you know where the thread lives: the lookup then asks that device only, and a miss names it. A thread outside this session's workspace also needs `all_scope: true` on every call; without it the call answers `scope_denied`.

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

`effective_mode: "start"` means the message started a turn on an idle thread. `wait_ms` makes a read wait, up to that long, for the thread's turn to end before it reads; the result's `wait` says how the wait ended.

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

Watch a thread with the monitor tool's session watch, `tool.monitor({ type: "rpc", target, description })`, not with a polling loop. Its registration answers what it matched: a watch on a closed thread here started with "No matching sessions yet", and a watch on a closed thread on another device was refused with `request_gone`. A target that resolves to nothing is refused at registration with its reason. Stop a watch you no longer need.

## What came back, and what to do

| Code | Seen when | Do |
|---|---|---|
| `scope_denied` | The thread is outside this workspace and `all_scope` was not passed. | Retry with `all_scope: true`. |
| `not_found` | Every device answered and none holds a thread under that id, name or prefix. With a device in front, `details` names the device that was asked. | Use a `thread` value from the list. |
| `host_unavailable` (`details.reason: "device_unanswered"`) | A device did not answer the lookup round, so the thread could not be ruled in or out. Seen on a send by bare id while a device was slow. | Retry that target only, addressed as `<device name>/<thread>` so only that device is asked. A send retried this way was delivered. |
| `not_resumable` | Nothing on the device runs the thread and it could not be brought back. Either the session ended or left its host's listing after you listed it ("The thread is not running on device ..."), or the device refused to wake it ("Device ... cannot wake that session"), or a control call reached a thread with no live owner. A thread whose `state` is `idle` is not this case: a send to it starts a turn. | List again to see the thread's current state. For a session that ended or left the listing, retry when it runs again, or send from the machine that holds it. For a refused wake, read the reason in the message: `not_wakeable` means that session cannot be woken from anywhere, so address another thread; `sender_not_admitted` means that device does not take sends from this one, so another thread there fails the same way, and the send has to come from the machine that holds the thread. Do not resend in a loop. |
| `internal_error` ("connection closed before the response arrived") | A create on this device. | List first: if no thread was made, retry once (the retry worked). Never create twice without checking. |

For a code not listed here, do what its `next_action` says.

## Limits

- The thread tools act as this session: every send, create or close is done by this agent, and the receiving agent sees it as a message from this session.
- A program that runs outside an agent session does not have the thread tools; it is not this skill's subject.
