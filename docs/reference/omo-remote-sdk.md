# omo-ai/remote: the remote SDK

`omo-ai/remote` is the remote module of omo, importable from a script. It is the same client `omo remote` and the
TUI's `/remote` use, so a script sees the same devices, sessions and errors they do. Install `omo-ai` (it is the package
that carries the `omo` command) and import it by name:

```ts
import { openRemote } from "omo-ai/remote"

const remote = openRemote()
try {
  const devices = await remote.devices.list()
  if (devices.kind === "error") throw new Error(`${devices.code}: ${devices.next_action}`)
  for (const device of devices.value) console.log(device.name, device.online ? "online" : "offline")
} finally {
  remote.close()
}
```

## Identity

`openRemote()` acts as the person running the script, like the `omo` command does: it uses this OS user's device
service and sign-in. It never runs inside an engine bundle and is not offered to agent sessions; a session reaches other
devices through its thread tools, which act as that session.

## Results and errors

Every member settles with data and never throws:

- `{ kind: "ok", value }` on success;
- `{ kind: "error", code, message, next_action, uncertain?, details? }` on failure. `code` is one of `REMOTE_CODES`
  (exported), and `next_action` names the SDK call that fixes it. `uncertain: true` on a mutating call means the
  remote side may have applied it; read the state before retrying.

Every member takes an optional last argument `{ signal?: AbortSignal, deadlineMs?: number }`. An abort answers
`cancelled`; a member that runs past its deadline answers `timeout`.

## Members

| member | what it does |
|---|---|
| `service.info()`, `service.status()` | this device's service version and state |
| `service.setEnabled(on)`, `service.control()`, `service.setControl(on)` | the service switch and the attach setting |
| `service.wake()`, `service.setWake(on \| null)` | the device's session-wake switch (`null` restores the default) |
| `service.bootstrap(setup)` | installs and connects the device service; a client built without the bootstrap runner answers `unsupported` |
| `devices.list()` | every device on the account, this one marked `self: true`; `online` is a property of the device |
| `devices.resolve(idOrName)` | one device, by id or by the name the list shows |
| `sessions.list(filter?)` | ONE list across every device (`all_scope: true`), each row naming its device; `unanswered` names devices that missed the round |
| `sessions.resolve(address, scope?)` | one address (durable id, alias, name or `<device>/<session>`) to its row |
| `sessions.get(thread)` | one session's detail |
| `sessions.open({ device, workspace?, worktree?, model?, reasoning?, preset?, name?, first? })` | create a session on any device, through the same create path as `thread_create` and `omo remote open` |
| `sessions.send(thread, { text, mode? })`, `sessions.read(thread, { tail? })` | send input, read the transcript |
| `sessions.follow(thread)` | watch: an async stream of status changes and the turn's end; `stop()` ends it |
| `sessions.wait(thread)` | waits for the current turn to end and answers how it ended |
| `sessions.interrupt(thread)`, `sessions.close(thread)`, `sessions.archive(thread, archived)` | session control |
| `sessions.setModel(thread, "provider/id")`, `sessions.setReasoning(thread, level)` | the session's own model and thinking level, never a device default |
| `attach(thread)` | one session's live attach: snapshot, records, pending UI requests and their answers |
| `aliases.resolve(alias)`, `aliases.set(thread, alias)`, `aliases.clear(thread)` | account-wide thread aliases |
| `close()` | closes the client's one connection |

Threads are named `<device>/<session>`, as `sessions.list` returns them. A thread handle is typed: take it from a list
row or `sessions.open`, or build one with `handleOf(device, session)` or `canonicalizeThreadHandle(input, scope)` (both
exported), never by joining strings. Every remote call obeys the target session's own approval mode.

## Two devices from one script

`packages/omo-native/test/remote-sdk-two-device.ts <deviceA> <deviceB> [workspace]` opens a session on each device,
sends, watches to the end of the turn, reads the reply back and closes, timing every call. It is the acceptance check
of omo#13413.
