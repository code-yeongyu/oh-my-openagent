# The omo SDK as the first-party surface: design

Tracking issue: #14943. Status: design, under review. Nothing in this document is implemented by the pull request that adds it.

Source was read at `dev` `2e2a815ac8` and at the engine's `main` `48983b7bf8` on 2026-11-25. No product command was run for this document; every "today" statement is a source reading with its file and line.

## 1. The rule

The owner's ruling on #14943 is the whole requirement:

1. One modular core per domain is the only implementation of that domain.
2. The SDK exposes that core directly. It is the first-party surface.
3. The CLI, the agent thread tools, the desktop app and every other caller are adapters over the SDK. They are third-party consumers of it.
4. **The SDK is the superset: SDK ⊇ CLI and SDK ⊇ tools.** Every capability exists in the SDK, with no exception. An adapter may expose less than the SDK, and each omission carries a written reason. The SDK never exposes less than an adapter. A capability that the CLI or a tool has and the SDK lacks is a defect, and its fix is the SDK call.

Three terms are used the same way everywhere below.

- A **capability** is one thing a caller can make omo do or read, with its inputs and its typed outcome: "send a message into a running turn", "revoke another device".
- A **core** is the module that implements a domain's capabilities: resolution, transport, state, policy.
- An **adapter** is a file that turns a surface's input into an SDK call and the SDK's answer into that surface's output. It parses, calls and renders. It holds no resolver, no transport and no policy.

## 2. Today

### 2.1 Three SDK entries, three result shapes

| Entry | How a caller finds it | What it answers | Result shape |
|---|---|---|---|
| Thread SDK, `createThreadSdk` (`packages/omo-senpi/src/components/thread/sdk.ts:249`) | A file path inside the installed plugin, `runtime/thread-sdk/sdk.js`; no environment variable names it (`packages/omo-native/bin/lib/thread.js:163`) | `list`, `read`, `send`, `locate`, `create`, `interrupt`, `close`, `rename`, `set_model`, `release`, `warmDaemon`, store extensions (`sdk.ts:119-162`) | `{ kind: "ok", ...fields }` or `{ kind: "error", error }` |
| omo SDK, `createOmoSdk` (`components/omo-sdk/index.ts:42`) | `OMO_SDK_ROOT` inside a session (`extension/sdk-root-provisioning.ts:8`) | `account.whoami`, `account.signIn`, `devices.list`, `devices.rename`, `deviceService.status`, `config.status` | `{ kind: "ok", value }` or `{ kind: "error", error }` (`omo-sdk/result.ts:27`) |
| Remote module, `remoteClientForPerson` and its sibling factories (`components/remote/index.ts`, `types.ts:402-455`) | Source import only. The package export `omo-ai/remote` is PR #14881, open | `service.*`, `devices.*`, `sessions.*` (list, resolve, get, open, send, read, follow, wait, interrupt, setModel, setReasoning, close, archive), `attach`, `aliases.*` | `{ kind: "ok", value }` or a flat `{ kind: "error", code, message, ... }` (`types.ts:56-65`) |

Each entry was built for one caller. None of them is the place where every capability lives.

### 2.2 Where the superset rule is broken today

SDK ⊉ tools:

- `thread_set_reasoning`, `thread_archive` and `thread_handoff` are registered tools (`thread/tools.ts:497-542`) with no thread SDK method (`sdk.ts:119-162`).
- `thread_read` takes `wait_ms` and reads a delivery receipt by `delivery_id` (`tools.ts:181-199`); the SDK's `read` takes neither (`sdk.ts:124-127`).
- The tools call the shared bodies directly (`createGatewayServices`, `locateControl`, `createThread`), so nothing forces a new tool capability through the SDK.

SDK ⊉ CLI:

- `omo remote` session verbs run on the remote module and on thread internals imported straight into the CLI file: `createRelayControl`, `createRelaySessionHost`, `createRelayTransport`, `createDeliveryPipeline`, the gateway store (`packages/omo-native/remote-session-verbs.ts:3-39`). PR #14890 moves them onto the remote module's person client; it does not put them behind one SDK.
- `omo remote attach`, `status`, `enable`, `disable`, `control`, `wake` and `bootstrap` have no call in either shipped SDK.
- `omo logout`, `omo account show|adopt|token|export|forget|store|devices revoke|retire-sync` and every `omo sync` verb have no SDK call (`packages/omo-native/account-cli.ts:134-211`, `sync-cli.ts:208-245`).
- `omo daemon`, `omo doctor`, `omo setup` and `omo update` are implemented in launcher modules under `packages/omo-native/bin/lib/` with no SDK call.
- The engine's own one-shot commands (`install`, `remove`, `uninstall`, `list`, `config`, `auth`, `host`, `schedule`, `session-of-pid`, `models discover`) are forwarded as argv (`bin/lib/engine-commands.js:4-16`, `launcher.js:296`); no importable call exists for them.

One resolver, several callers of it:

- The SDK's `send` builds its own delivery target after its owner fast path instead of using the locator the tools use (#13016, rows OMO-MSG-07 and OMO-CLI-06, both PARTIAL in the 2026-11-22 census).
- `omo remote model|interrupt|close|open` construct relay control outside `locateControl` and skip the ended-session short-circuit (#13016, rows OMO-CTL-26 and OMO-CLI-09).
- `omo thread` and `omo remote` keep two verb tables, two flag sets and opposite wait defaults (#13016, rows OMO-CLI-01, -02, -30). The owner approved one verb table over the ports on 2026-11-10 (step 1 of that ruling); nobody has built it.
- `omo remote` refuses a thread held on this device (`components/remote/device-address.ts:35-45`), and `openRemote()` cannot open a session on its own device (#14931).

Downstream: the omo-harness skill starts `omo remote open|send|sessions|interrupt|close|model|devices` and `omo thread read|list` as subprocesses and parses their JSON, because no SDK call covers them.

## 3. Target architecture

```
          scripts, connectors, other harnesses, the desktop app
                                 |
   CLI adapters      tool adapters      (parse, call, render; nothing else)
        \                 |                 /
         +---------- the omo SDK ----------+     one entry, typed, data or a typed refusal
                          |
     threads   devices   account   deviceService   sync   config   daemon   diagnostics   install   engine
                          |                                          (one core per domain)
        ports: session host, delivery transport, device service, account service,
               credential store, process, file system, clock
                          |
     this device's engine endpoints      the relay and other devices      the account service
```

Same-device and cross-device differ only in which transport a port resolves to. No layer above the ports branches on locality (#12879, #13414).

### 3.1 Domains and their cores

| Domain | Core (the only implementation) | State today |
|---|---|---|
| `threads` | `components/thread/`: `address/` (the resolver over `packages/thread-address-core`), `gateway/` (delivery pipeline, store, decision table), `control/` (`SessionControl`, `SessionHost`, create, close ladder, operations), `tools/read-ops.ts`, `tools/archive-ops.ts`; the cross-device leg is `components/remote/` | Core exists. The SDK, the tools and two CLIs enter it at different depths |
| `devices` | `components/remote/` `devices.*` for the roster; the account service client for rename and revoke | Listing unified by #14881 (open). Revoke lives in a CLI file (`account-devices.ts:33-101`) |
| `account` | Session, credential store, device-code flow and device keys, today under `packages/omo-opencode/src/cli/service-auth/` | Core exists but sits under a `cli/` directory and is reached through `service-auth.generated.js`; it moves to a core package and keeps its tests |
| `deviceService` | `components/remote/` `service.*` plus `admin.ts` (bootstrap, cold wake, operator endpoint leg; #14890) | Core exists after #14890 |
| `sync` | `packages/memory-core` (`enableSync`, `disableSync`, `joinAccount`), with the ceremony glue now in `packages/omo-native/sync-*.ts` | Core exists; ceremony orchestration is in CLI files |
| `config` | `packages/omo-config-core` | `config.status` shipped; #14366 defines the rest |
| `daemon` | The engine's host commands and the launch spec; omo's part is `bin/lib/daemon*.js` | Logic is in launcher modules |
| `diagnostics` | `bin/lib/doctor*.js` and the runtime bundles they load | Logic is in launcher modules; the output is prose only |
| `install` | `bin/lib/self-update.js`, `compiled-update*.ts`, `setup-*.js` | Logic is in launcher modules |
| `engine` | The pinned engine's command implementations (packages, provider auth, schedules, models) | Engine-owned. Reached only by forwarding argv |

A core may live in any package. What makes it the core is that no second implementation of the same capability exists and that the SDK is its only public way in.

### 3.2 The adapter rule

An adapter file may contain:

- argument or schema parsing, including usage text;
- one or more SDK calls;
- rendering of the SDK's answer (human lines, a JSON projection, exit code lookup, a TUI row);
- for the tools: the tool's schema, description and the receipt wrapper call.

An adapter file may not contain, or import anything that is:

- address or device resolution (`thread/address/**`, `packages/thread-address-core`, `resolveTypedAddress`, `resolveTypedDevice`);
- transport or port construction (`thread/gateway/**`, `thread/control/**`, `thread/remote/**`, `components/remote/**` other than types re-exported by the SDK, `packages/device-service-core`, sockets, `fetch`);
- account, credential or key handling (`service-auth/**`, the credential store);
- policy: delivery decisions, admission, idempotency, retries, deadlines.

Adapter files are: `packages/omo-native/bin/lib/{thread,daemon,doctor,host-status,self-update}*.js`, `packages/omo-native/{remote,account,sync}-*.ts`, `packages/omo-native/service-auth-command.ts`, the verb entry files of `packages/omo-opencode/src/cli/service-auth/commands.ts`, and `packages/omo-senpi/src/components/thread/tools.ts` with `tools/*.ts` minus the `*-ops.ts` bodies, which move under the core. Section 7 says how CI holds this.

The process-level tail of a few verbs stays in the CLI because it is not a capability: replacing the terminal process with the engine after `daemon adopt` or `remote attach`, re-executing under another runtime, reading a TTY. The SDK gives everything up to that point as data.

## 4. The SDK

### 4.1 One entry

```ts
import { createOmoSdk } from "omo-ai/sdk"

const omo = createOmoSdk()
const sent = await omo.threads.send({ thread: "studio/review", text: "status?" })
if (sent.kind === "error") console.error(sent.error.code, sent.error.next_action)
await omo.close()
```

- Package name: `omo-ai/sdk`, added to the `exports` of `packages/omo-native/package.json` beside `./remote` from #14881. `omo-ai/remote` stays and becomes a re-export of the same client the root holds; it is not a second implementation.
- Inside a session: `OMO_SDK_ROOT` already points at the built entry; the root answers every namespace from there. `createThreadSdk` stays exported for one release as a deprecated alias of `createOmoSdk().threads` with its present method names, because a downstream gateway imports it by that name today.
- Outside a session with a global install: `omo sdk root` prints the directory of the built entry (an adapter over `install.sdkRoot()`), so a plain bun script resolves it without knowing the install layout.
- Importing the entry has no side effect: no socket, no file, no process, no network. Each namespace loads its core on first use, as the remote module's `lazy.ts` does for the launcher.

### 4.2 Namespaces

`threads`, `devices`, `account`, `deviceService`, `sync`, `config`, `daemon`, `diagnostics`, `install`, `engine`, and `close()`. Method names are camelCase. Input and result field names keep the wire contract's spelling (`all_scope`, `idempotency_key`, `expected_turn_id`), because the SDK's input types are the tool schemas in `thread/contracts/params.ts`, not a copy of them.

The full method list is the "SDK call" column of section 6.

### 4.3 Who is calling

The SDK does not take a free-form sender. It is built for one principal, the way the remote module already builds one client per sender (`components/remote/factories.ts`):

- `createOmoSdk()` is a **script** principal: `cli:<uid>` on this device and the person leg over the relay, which is what the thread SDK does today (`sdk.ts:351-402`). A connector passes `{ principal: { kind: "connector", id } }`.
- A **session** principal is built only inside the engine extension, from the execution context the engine hands a tool (`sessionManager.getSessionId()`), through an internal factory that the public entry does not export. Receipts, loop guards, reply pinning and the caller's workspace scope hang on it. The import guard lets only the tool adapters import that factory.

Admission does not change in this program. Step 2 of the 2026-11-10 ruling on #13016 (both transports accepting both sender kinds) is not approved and stays out of scope: a `cli` sender is still refused on the relay leg and a person on the local leg, inside the core.

### 4.4 Results

Every call resolves. Nothing is thrown at the caller and no promise rejects for a domain failure.

```ts
type OmoFailure = {
  readonly kind: "error"
  readonly error: {
    readonly code: OmoCode
    readonly message: string
    readonly next_action: string
    readonly details?: Readonly<Record<string, unknown>>
  }
}
```

- The error branch has one shape in every namespace. It is the shape the thread tools and the omo SDK already share. The remote module's flat failure is converted at the SDK boundary by one function; `uncertain`, `command_id` and `partial` move into `details`.
- `OmoCode` is one registry: the union of `THREAD_ERROR_CODES`, the omo SDK's codes and `REMOTE_CODES`, with one meaning per name. A code two domains spell differently for one condition is settled in the registry, with the old spelling accepted on input for one release where a caller can pass one.
- One table maps a code to a CLI exit code. It replaces `THREAD_EXIT`, `REMOTE_EXIT`, `ACCOUNT_EXIT` and the daemon's table with one function, starting from the remote module's `exitCodeOf` (`components/remote/codes.ts:172-192`). Existing exit codes for existing verbs do not change; the test in section 7 pins them.
- The ok branch keeps the two shapes that are already shipped: `threads.*` answers the thread contract (`{ kind: "ok", thread, delivery, ... }`, `thread/contracts/results.ts`), and every other namespace answers `{ kind: "ok", value }`. The thread contract is persisted in receipts, replayed, printed by `omo thread --json` and read by three downstream callers, so it does not move. In particular **the delivery result type does not move**: #14941 and the replay fix for a repeated idempotency key build on the present shape.
- Streams (`threads.follow`, `threads.attach().events`) are `AsyncIterable` with a `stop()`, as `RemoteStream` is today. A stream ends with one terminal event that carries either the outcome or an `OmoFailure`; it never throws from `next()`.
- Every call takes `{ signal?, deadline_ms? }` where it can wait. A call that left this device and got no answer inside its budget answers `delivered_unconfirmed` or `idempotency_uncertain` as it does today, never a generic timeout. A retried create under the original idempotency key returns the original thread and no duplicate (#14560, #14569).

### 4.5 No secret leaves the SDK in a result

A result value, an error message, an error `details` object and a stream event never carry an access token, a refresh token, a private key, a recovery phrase, a socket secret or a device-code that is still valid. The scan that `omo-sdk.test.ts:73-82` runs over returned values today runs over every namespace's results and failures, with fake ports that hold recognisable canary secrets.

Error messages are the core's own words. An exception from a lower layer is mapped to a code; its text is not appended, because a service or store message can carry a credential (`account-sign-in.ts:82`). The thread SDK's `thrown` path, which appends raw exception text today (`sdk.ts:190-216`), is changed to the same rule.

Two CLI verbs print a secret by design, for our own processes: `omo account token` prints the access token and `omo account export` prints the stored credential (`account-cli.ts:118-146`). The superset rule and the no-secret rule both hold through a **sink**:

```ts
account.credentials.handOver({ what: "access_token" | "stored_credential", sink })
//  -> { kind: "ok", value: { delivered: true, device, expires_at } }
```

The SDK writes the secret to a writable the caller supplies and answers only that it did. The CLI adapter passes its stdout. The value never sits in a result, so it cannot be logged with results, stored in a receipt or returned into a model's context. The same shape carries the recovery phrase shown once by `omo sync enable`. No tool exposes these calls. This is a credential-custody surface: its slice goes through the security design gate (threat model and compatibility matrix on the slice's issue) before any code.

Secrets as inputs are allowed where a verb takes one today (`omo account adopt` reads a handed-over credential, `omo sync recover` takes the phrase); the SDK takes them through a callback or a readable, never as a plain string argument that a caller would log.

### 4.6 Ports

Every external dependency is behind a port that a test replaces: the engine host socket (`ThreadSdkOptions.host`), the gateway store, the device-service connection, the account session and credential store (`OmoSdkPorts`), the child process (`SignInProcess`), the file system roots, and the clock. Timeouts, TTLs, the close ladder's waits and the device-code polling read the clock port, so their tests run on a virtual clock and inject one fault at a time (a lost reply, a store lock timeout, a 401) without waiting or breaking a real service. No test in this program sleeps for wall time except where time itself is the behaviour, as `loop-guard.mjs` already declares.

## 5. One address on every surface

A thread is named by one string, `thread`, and every surface accepts exactly the strings every other surface prints (#14044).

- Grammar: `self`, a bare address, or `<device>/<thread>`, parsed only by `packages/thread-address-core` `parseAddress` (`parse.ts:26-59`). The thread part resolves as durable id, session key, account alias, exact name in scope, then a unique id prefix of 8 or more hex characters (`ladder.ts:10-72`). The device part resolves as device id, `here`, device name, then a unique id prefix of 6 or more (`device.ts:24-67`).
- One resolver: `resolveAddress` (`thread/address/resolve.ts`) with one options object. The SDK owns the only call sites: one for delivery (`locateTarget`, shared by `send`, `handoff` and the first prompt of `create`) and one for control (`locateControl`, used by every control verb). `resolveTypedAddress` for `omo remote` stops being a second entry; the CLI passes the typed string to the SDK.
- A thread opened over the relay is not special. `threads.create({ device })` answers a `thread` value; `send`, `read`, `follow`, `wait`, `interrupt`, `setModel`, `setReasoning`, `rename`, `archive` and `close` take it back unchanged from the SDK, from the tools and from the CLI, on the device that opened it and on any other signed-in device of the account.
- The device is an optional part of the address, not a different command. `omo remote <verb>` on a thread this device holds stops answering `not_found` with `on_this_device`, and `threads.create({ device: <this device> })` works (#14931), because the person client is given this device's operator endpoint leg lazily.
- A stale route is recovered inside the core, once, by locating the live owner read-only and sending to the resolved key. That behaviour and its no-owner and authorization-refusal tests come from #14937; no adapter re-implements it.
- Scope is the same input on all three surfaces: `all_scope` widens this device's workspace scope only; other devices' threads are always listed when the account can be reached.

The conformance test in section 7 holds this: one table of address forms, each driven through the SDK, a tool and the CLI against the same fake world, with equal typed outcomes required.

## 6. Parity table

Direction: **SDK ⊇ CLI and SDK ⊇ tools.** Every row has an SDK call. A CLI or tool cell that is empty carries its reason in the last column. "Today" says whether the SDK call exists at the pinned commit: **yes**, **partial** (exists in one of the three entries of section 2.1, or lacks inputs an adapter has), or **no** (a defect under the rule, fixed by the slice named in section 8).

### 6.1 Threads

| Capability | CLI today | SDK call | Tool | SDK today | Adapter omission and its reason |
|---|---|---|---|---|---|
| List threads on this device and the account's others | `omo thread list [--all-scope] [--state]`; `omo remote sessions [--device] [--project] [--state]`; `omo host session list` | `threads.list({ all_scope?, state?, device?, project? })` | `thread_list` | partial: thread SDK lists; device and project filters live in the remote module | Tool has no `device` or `project` filter: rows carry both and the listing is one bounded payload |
| Read a transcript page | `omo thread read <t> [--limit] [--max-bytes] [--cursor]`; `omo host session read` | `threads.read({ thread, cursor?, max_bytes?, limit?, wait_ms?, all_scope? })` | `thread_read` | partial: no `wait_ms`, no `limit` (the CLI slices the result itself, `thread.js:92-95`) | None |
| Read a delivery receipt | none | `threads.receipt({ delivery_id })` | `thread_read { delivery_id }` | no | CLI gains `omo thread receipt <id>` in the verb-table slice |
| Read one thread's state (model, reasoning, turn, pending) | `omo host session state` | `threads.get({ thread })` | none | partial: remote module `sessions.get` only | Tool: the same facts arrive on the `thread_list` row and in `thread_read`'s `wait` block; a third read tool adds prompt weight for no new fact |
| Send: auto, steer, follow-up | `omo thread send <t> <text> [--mode] [--expected-turn] [--idempotency-key] [--collapse-key]`; `omo remote send <s> <text> [--steer\|--follow-up]`; `omo host session prompt\|steer` | `threads.send({ thread, text, mode?, expected_turn_id?, idempotency_key?, collapse_key?, summary?, attachments?, all_scope? })` | `thread_send` | partial: own target construction (#13016); attachments only in the remote module | Tool has no `collapse_key`: it is a connector's de-duplication key for repeated external events, and a session's sends are already keyed by its receipt |
| Follow the answer as it streams | `omo remote send` (default; `--no-wait`, `--timeout` bound it) | `threads.follow({ thread, from? })` | none | partial: remote module `sessions.follow` | Tool: a tool result is one bounded payload and nothing streams into a model call; an agent waits with `thread_read { wait_ms }` |
| Wait until the turn settles | `omo host session wait [--until] [--timeout]` | `threads.wait({ thread, until?, deadline_ms? })` | `thread_read { wait_ms }` | partial: remote module `sessions.wait`; local wait only inside the tool body | CLI gains `omo thread wait` in the verb-table slice |
| Create a thread, here or on a device, with first prompt, model, reasoning, permission preset, worktree, fork, skills, alias | `omo remote open <device> [--project] [--model] [--thinking] [--permission-preset] [--worktree [--branch] [--base]] [--prompt [--steer\|--follow-up]]`; `omo host session open` | `threads.create({ device?, thread?, cwd?, name?, alias?, model?, thinking?, permission_preset?, worktree?, fork_from?, prompt?, delivery?, skills?, idempotency_key? })` | `thread_create` | partial: thread SDK creates; `omo remote open` skips the create orchestration (#13016 OMO-CTL-26) | None after the verb-table slice (`omo thread create`) |
| Open an existing thread on whichever device holds it | none | `threads.create({ thread })` | `thread_create { thread }` | yes | CLI gains it with `omo thread create --thread` |
| Interrupt the running turn | `omo remote interrupt <s>`; `omo host session abort` | `threads.interrupt({ thread, turn_id?, all_scope? })` | `thread_interrupt` | yes (local and relay through `locateControl`) | None after the verb-table slice (`omo thread interrupt`) |
| Close: plain, forced, graceful | `omo thread close <t> [--force \| --graceful [--wait-ms]] [--idempotency-key]`; `omo remote close`; `omo host session close\|unload` | `threads.close({ thread, force?, graceful?, wait_ms?, idempotency_key?, all_scope? })` | `thread_close` | yes | None |
| Set the model | `omo remote model <s> <provider/id>`; `omo host session model` | `threads.setModel({ thread, model, provider?, idempotency_key?, all_scope? })` | `thread_set_model` | yes (`set_model`) | None after the verb-table slice |
| Set the reasoning level | none | `threads.setReasoning({ thread, level, scope?, idempotency_key?, all_scope? })` | `thread_set_reasoning` | **no** in the thread SDK; remote module only | CLI gains `omo thread reasoning` |
| Rename, set or clear an alias | none | `threads.rename({ thread, name?, alias?, idempotency_key?, all_scope? })` | `thread_rename` | yes | CLI gains `omo thread rename` |
| Archive or unarchive | none | `threads.archive({ thread, archived?, idempotency_key?, all_scope? })` | `thread_archive` | **no** in the thread SDK; remote module only | CLI gains `omo thread archive` |
| Hand a task off, exact or fuzzy target | none | `threads.handoff({ thread, match?, message, delivery?, idempotency_key?, all_scope? })` | `thread_handoff` | **no** | CLI gains `omo thread handoff`; fuzzy matching is off unless `--match fuzzy` is given |
| Locate a thread's holder | none | `threads.locate({ thread, all_scope? })` | none | yes | Tool and CLI: resolution is internal to every verb; a caller gets the holder on the `thread_list` row. Kept in the SDK for `daemon adopt` and connectors |
| Attach live: snapshot, records, pending dialogs, answer one, detach | `omo remote attach <s>` (TUI); `omo remote answer` arrives with #14890 | `threads.attach({ thread })` answering `{ snapshot, events, read, pending, answer, command, detach }` | none | partial: remote module `attach` | Tool: answering another session's approval dialog is an authority decision, and no ruling gives a session that authority over a peer. The TUI is rendering over the handle |
| Take a host session into this terminal | `omo daemon adopt <s> [--interrupt] [--force]` | `threads.release({ thread, interrupt?, force? })` | none | yes (`locate` + `release`) | Tool: it ends in replacing a terminal process, which no tool call can do. The process replacement stays in the CLI |
| Start the interactive terminal, resume, or print mode | `omo [flags] [prompt]`, `omo --session`, engine print flags | `threads.create` + `threads.attach`, or `threads.create` + `threads.send` + `threads.follow` | none | partial, as the rows above | The terminal UI is a renderer, not a capability |
| Warm the operator daemon | part of `omo daemon run` | `daemon.warm()` | none | yes (`warmDaemon`) | See 6.5 |
| Declare and call a store extension | none | `threads.extensions.register(...)`, `threads.extensions.call(...)` | `ext_<extension>_<tool>` | yes | CLI: extension ops are session tools by declaration; no person-facing verb is asked for |

### 6.2 Devices

| Capability | CLI today | SDK call | Tool | SDK today | Adapter omission and its reason |
|---|---|---|---|---|---|
| List the account's devices | `omo remote devices`; `omo account devices` | `devices.list()` | `thread_list` (its `devices` block) | yes; one listing after #14881 | None |
| Resolve one device by id, `here`, name or prefix | implicit in every `<device>/...` | `devices.resolve({ device })` | none | partial: remote module | Tool and CLI: resolution is part of each verb |
| Rename a device | none | `devices.rename({ id, name })` | none | yes | CLI gains `omo account devices rename`. Tool: an account-level change a person makes; no ruling asks for it from a session |
| Revoke another device | `omo account devices revoke <id>` | `devices.revoke({ device, confirm_name })` | none | **no** (#14364 keeps it as the last step) | Tool: it destroys a sign-in and is the person's decision |
| Enroll a machine reachable over SSH | none | `devices.enroll(...)` (#14365) | none | no | Outside this program; listed so the namespace is reserved |

### 6.3 Account

| Capability | CLI today | SDK call | Tool | SDK today | Adapter omission and its reason |
|---|---|---|---|---|---|
| Who am I | `omo whoami`; `omo account show [--account]` | `account.whoami()`, `account.show({ account? })` | none | partial: `whoami` | Tool: a session reads it from the omo SDK in an eval cell; no dedicated tool exists or is asked for |
| Sign in: device code, browser callback, replace an earlier device | `omo login [--device] [--no-browser] [--replace] [--api] [--accounts]`; `omo account sign-in [--stdin\|--check]` | `account.signIn({ method?, onUserCode, onOpenUrl?, deviceName?, replace?, signal? })`, `account.signInCheck()` | none | partial: device code only, and it runs the CLI as a child (`omo-sdk/account/sign-in-process.ts`) | Tool: a sign-in needs a person at a browser. The SDK stops running the CLI; the CLI calls the SDK |
| Sign out this device | `omo logout`; `omo account forget [--device <id>]` | `account.signOut()`, `account.forget({ device? })` | none | **no** | Tool: ends the session's own sign-in |
| Take a sign-in handed over by the desktop app | `omo account adopt [--replace]` | `account.adopt({ credential: Readable, replace? })` | none | **no** | Tool: a credential hand-over between our own processes |
| Hand a credential to another of our processes | `omo account token`; `omo account export` | `account.credentials.handOver({ what, sink })` | none | **no** | Tool: section 4.5. Never in a result |
| Credential store location (macOS, opt-in) | `omo account store status\|enable\|disable [--discard]` | `account.store.status()`, `.enable()`, `.disable({ discard? })` | none | **no** | Tool: changes where credentials live on the machine |

### 6.4 Device service (remote switches)

| Capability | CLI today | SDK call | Tool | SDK today | Adapter omission and its reason |
|---|---|---|---|---|---|
| Connection state | `omo remote status` | `deviceService.status()` | none | partial: omo SDK status; the CLI's richer row is remote module `service.status` plus local units | Tool: `thread_list` already answers `remote_unavailable` with the reason an agent can act on |
| Turn remote sessions on or off | `omo remote enable`; `omo remote disable` | `deviceService.enable()`, `.disable()` | none | partial: remote module `service.setEnabled`, `admin.ts` | Tool: these switches decide what other devices may do on this machine; that consent is the person's |
| Let other devices view and command this one | `omo remote control [on\|off]` | `deviceService.control()`, `.setControl(on)` | none | partial: remote module | Same reason |
| Let a message wake a session that is not running | `omo remote wake [on\|off\|default]` | `deviceService.wake()`, `.setWake(on \| null)` | none | partial: remote module | Same reason |
| Install and link this device's service | `omo remote bootstrap` | `deviceService.bootstrap()` | none | partial: remote module, `admin.ts` | Tool: it downloads and installs a service |

### 6.5 Sync

| Capability | CLI today | SDK call | Tool | SDK today | Adapter omission and its reason |
|---|---|---|---|---|---|
| Turn memory sync on, creating or joining | `omo sync enable` | `sync.enable({ onPhrase, onCode, confirm, signal? })` | none | **no** | Tool: the ceremony has a person compare codes on two screens and keep a phrase |
| Turn it off for this device | `omo sync disable` | `sync.disable()` | none | **no** | Tool: a person's choice about this device's memory |
| Status of this device, the account's devices and the engine | `omo sync status [--json]` | `sync.status()` | none | **no** | Tool: read from the SDK in an eval cell |
| Approve a waiting device | `omo sync approve [id]` | `sync.approve({ id?, confirmCode })` | none | **no** | Tool: the approval is the comparison a person makes |
| Recover after losing every device | `omo sync recover` | `sync.recover({ phrase: Readable, confirm })` | none | **no** | Tool: takes the recovery phrase |
| Retire a discarded account's pin | `omo account retire-sync --account <id>` | `sync.retirePin({ account })` | none | **no** | Tool: called by the desktop app when it discards its own sealed session |

### 6.6 Config, daemon, diagnostics, install

| Capability | CLI today | SDK call | Tool | SDK today | Adapter omission and its reason |
|---|---|---|---|---|---|
| Which config files loaded, with diagnostics | `omo doctor` (its `WARN config:` lines) | `config.status()` | none | yes | CLI gains `omo config status` only if #14366 asks for it |
| Explain, check, edit, revert | none | `config.explain`, `.check`, `.edit`, `.revert` (#14366) | none | no | Owned by #14366; the namespace is reserved here |
| Ensure the operator daemon | `omo daemon run [--no-upgrade] [--json]`; `omo host ensure` | `daemon.ensure({ policy? })`, `daemon.warm()` | none | partial: `warmDaemon` only | Tool: host lifecycle of the machine the calling session runs on; a session that stops or hands over its own host ends its own call |
| Who serves, which sessions | `omo daemon status`; `omo host status [--all] [--include-workers]` | `daemon.status({ all?, include_workers? })` | none | **no** | Tool: `thread_list` answers the session-level question; endpoint internals stay out of model-facing output (#14044) |
| Stop, drain, stop all and wait | `omo daemon stop [--drain] [--all [--wait [--timeout]]]`; `omo host stop` | `daemon.stop({ drain?, all?, wait?, deadline_ms? })` | none | **no** | Same reason as ensure |
| Hand the socket to this build | `omo daemon handoff`; `omo host handoff` | `daemon.handoff({ allow_downgrade? })` | none | **no** | Same reason |
| Remove dead endpoint state | `omo daemon gc [--prune-store-index]`; `omo host gc` | `daemon.gc({ prune_store_index? })` | none | **no** | Same reason |
| Prepare a downgrade | `omo daemon rollback-prepare` | `daemon.rollbackPrepare()` | none | **no** | Same reason |
| Name a shard socket | `omo host shard-path --kind --owner` | `daemon.shardPath({ kind, owner, root? })` | none | **no** | Tool: an endpoint internal |
| Diagnose the install | `omo doctor`; `--models`; `--fix [--dry-run]`; `--reap` | `diagnostics.run()` answering findings as data, `.models()`, `.fixReflectionLock({ dry_run? })`, `.reapStaleEngines({ pids })` | none | **no** | Tool: it reads and repairs the installation under the running session; `reapStaleEngines` ends processes and takes explicit pids only |
| Import settings from other harnesses | `omo setup [args]` | `install.setup.detect()`, `install.setup.plan()`, `install.setup.apply(plan)` | none | **no** | Tool: plan, consent, write is a person's flow |
| Update omo | `omo update` and every self-update spelling | `install.update({ channel? })` | none | **no** | Tool: replaces the binary the session runs on |
| Version, SDK location | `omo --version`; `omo sdk root` (new) | `install.version()`, `install.sdkRoot()` | none | **no** | Tool: `OMO_SDK_ROOT` is already in a session's environment |
| The ulw loop | `omo ulw-loop` (answers that it moved) | the agent toolkit SDK, re-exported as `omo.toolkit` | n/a | yes | The CLI verb is already retired in favour of the SDK |

### 6.7 Engine commands forwarded by the launcher

The launcher forwards these to the pinned engine unchanged (`bin/lib/engine-commands.js`). Their core is the engine's. Under the rule they still need an SDK call, so the engine exports each command's function and the omo SDK re-exports it; the SDK does not start the engine CLI as a child for them.

| Capability | CLI today | SDK call | Tool | SDK today | Adapter omission and its reason |
|---|---|---|---|---|---|
| Extension packages | `omo install`, `remove`, `uninstall`, `list` | `engine.packages.install`, `.remove`, `.list` | none | **no** | Tool: installs code into the engine |
| Engine settings | `omo config` | `engine.config.*` | none | **no** | Tool: #14366 decides what a session may edit |
| Model provider credentials | `omo auth` | `engine.auth.*` (status and removal as data; a login takes callbacks; a key is an input, never a result) | none | **no** | Tool: provider credentials |
| Schedules | `omo schedule` | `engine.schedule.*` | none | **no** | Tool: the engine's own schedule tool, where it exists, is the session surface |
| Session of a process | `omo session-of-pid <pid> --json` | `engine.sessionOfPid({ pid })` | none | **no** | Tool: a host integration's lookup |
| Model discovery | `omo models discover` | `engine.models.discover()` | none | **no** | Tool: `thread_set_model` resolves against the target's catalog |
| Host sessions | `omo host session open\|close\|unload\|model\|prompt\|steer\|abort\|read\|state\|list\|wait` | the `threads.*` calls of 6.1 | the thread tools | partial | None: the same capabilities, one address |

The sub-verbs and flags of `install`, `config`, `auth` and `schedule` are enumerated from the engine's dispatch table in that slice; `packages/omo-native/test/engine-commands.test.ts` already checks the forwarded list against the installed engine.

### 6.8 Rows that are not capabilities

Internal entries the binary dispatches for its own processes (`__kill-guard`, `__device-service-bootstrap` from #14890, `remote enable --after-login`) are listed in the registry as `internal`, each with the capability it serves (`deviceService.bootstrap`), so a new hidden verb cannot bypass the check by being hidden.

### 6.9 The OpenCode-edition binary

`packages/omo-opencode` ships a different binary (`oh-my-opencode`, `oh-my-openagent`) with `install`, `run`, `doctor`, `get-local-version`, `config migrate`, `refresh-model-capabilities`, `version`, `boulder`, `worktree-sweep`, `cleanup`, `mcp oauth login|logout|status` and `account keys init|status`. It is not the `omo` command and holds no thread, remote, device or account-service capability of its own beyond the shared `service-auth` core. It is outside this program's slices. The registry lists its verbs with `edition: "opencode"` so that the check is honest about what it does not yet cover, and extending the rule to that binary is one decision for the owner, not an assumption made here.

## 7. Holding parity in CI

Four checks, ordered cheapest first. A later check runs only when the earlier ones pass.

### 7.1 The registry (milliseconds)

`script/sdk-parity/rows/<domain>.json`, one file per domain so that slices working in parallel do not edit the same file. A row:

```json
{ "id": "threads.setReasoning",
  "sdk": "threads.setReasoning",
  "cli": [],
  "tool": "thread_set_reasoning",
  "omitted": { "cli": "arrives with the one verb table" },
  "gap": null }
```

- `sdk` is required by the schema. There is no way to write a row without an SDK call, so an SDK omission cannot be recorded as accepted.
- `omitted.cli` or `omitted.tool` is required and non-empty wherever that cell is empty.
- `gap` names an open issue while the SDK call is not built yet. The list of rows with a `gap` may only shrink: the test fails on a new gap and on a gap whose SDK call now exists, so the pull request that builds a call also clears its row. This is the same only-shrinks discipline `script/remote-import-guard-rules.ts` uses for its offender lists.

`script/sdk-parity.test.ts` asserts:

1. **CLI ⊆ SDK.** Every verb the binary can dispatch has a row. The verbs are read from the tables the dispatchers use, exported as data, never from a hand-kept list: `COMMANDS` (`bin/lib/thread.js`), `VERBS` and `SESSION_VERBS` (`remote-verbs.ts`), the `omo account` switch (turned into a table), the `sync` commander program, `SUBCOMMANDS` (`bin/lib/daemon.js`), `ENGINE_COMMANDS`, and the launcher's top-level commands. After the one-verb-table slice there is one table and each entry carries its own `sdk` function, so the row and the dispatch cannot disagree. A verb added to a table without a row fails the test, with the message naming the SDK call to add.
2. **Tools ⊆ SDK.** Every key of `threadToolParamSchemas` (`thread/contracts/params.ts:224-235`) and every other registered tool of an SDK domain has a row. For each, every property of the tool's input schema is accepted by the SDK call's input schema; the SDK's input types are those schemas, so this is an object-identity or superset check, not a re-description.
3. **The SDK calls exist.** Every `sdk` path of a row without a `gap` is a function on `createOmoSdk()` built with fake ports, and is a key of the `OmoSdk` type (a `satisfies` check, so the compiler fails first).
4. **The published table is current.** Section 6 of this document is rendered from the rows, and the test compares the file byte for byte, as `rpc-relay-parity.test.ts` does for its table.

### 7.2 Adapter purity (the import guard)

`script/remote-import-guard-*` gains one rule family for the adapter files of section 3.2: an adapter's direct imports, and those of any helper it imports that is not the SDK entry, may reach only the SDK entry, its own parse and render modules, and platform built-ins that are not sockets or `fetch`. Reaching `thread/address`, `thread/gateway`, `thread/control`, `thread/remote`, `components/remote` internals, `device-service-core` or `service-auth` from an adapter fails. Today's violations go into an offender list that only shrinks, each row naming the slice that removes it. The guard already scans static imports, `require()` and literal `import()`; the non-literal import in `bin/lib/thread.js` stays frozen in its existing list until that file imports the SDK by name.

### 7.3 One scenario table, three drivers (unit speed, fake world)

`sdk-conformance.test.ts` extends `thread/route-parity.test.ts` and the device-service conformance owner that #14890's tests run on. One table of scenarios (the address forms of section 5; send in each mode; create with a lost acknowledgement and a retry under the same key; interrupt, model, reasoning, rename, archive and close on a live, an ended and an offline target; each refusal code) is driven three ways against the same fake engine endpoints and fake device service: the SDK directly, the tool's `execute`, and the CLI's verb function with `--json`. For each scenario the three typed outcomes must be equal after each surface's declared projection, and the fakes must have received the same calls. Cross-device scenarios run with the virtual clock; none waits.

### 7.4 The real-surface proof (section 9)

Run by a person or a QA lane on two signed-in devices, recorded on #14943. It is the only check that needs real devices, so it runs last and only on a build that passed the other three.

## 8. Migration slices

Each slice is one issue under #14943 and one pull request with `Fixes #<slice>`. An arrow means "merges after". Slices with no arrow between them run in parallel.

| Slice | What it does | Issue | Depends on |
|---|---|---|---|
| P0 | The parity registry, its test and the adapter import rules in only-shrinks mode. Records today's gaps and offenders; changes no behaviour | new | none |
| P1 | The one entry: `createOmoSdk` root with every namespace present (existing calls wired, missing ones answering `unsupported` with their slice in `details`), the principal, the one failure shape and code registry, the exit-code table, `omo-ai/sdk`, `omo sdk root`, the no-secret scan over all namespaces | new | #14881 and #14890 merged |
| T1 | Threads core completion: one `locateTarget` for delivery and `locateControl` for every control verb (#13016 MSG-07, CLI-06, CTL-26, CLI-09); `threads.setReasoning`, `archive`, `handoff`, `get`, `wait`, `follow`, `attach`, `receipt`, `read` with `wait_ms`; create parity with the lost-acknowledgement recovery; this-device open (#14931); the stale-route recovery of #14937 reused | #13016, #14931 | P1 |
| T2 | The thread tools become adapters: each body is one `threads.*` call on the session principal; `*-ops.ts` bodies move under the core | new | T1 |
| T3 | One CLI verb table (step 1 of the 2026-11-10 ruling): one parser, one flag set, one wait default, one exit table; `omo thread` gains `create`, `interrupt`, `model`, `reasoning`, `rename`, `archive`, `handoff`, `wait`, `receipt`, `attach`; `omo remote` keeps its device-service verbs and keeps its session verbs as aliases for one release; a thread on another device is sent to and read through `omo thread` | #14202, #13016 | T1 |
| A1 | Account and devices: the account core moves out of `cli/`; `account.signOut`, `show`, `forget`, `adopt`, `store.*`, `signIn` without a child process; `devices.revoke` with the name as confirmation; the four findings of #14523. `account.credentials.handOver` is its own pull request behind the security design gate | #14364, #14523 | P1 |
| A2 | Device service and sync: `deviceService.*` over the remote module's service client; `sync.*` with the ceremony as callbacks; `omo remote` switches and `omo sync` become adapters | new | P1 |
| C1 | Daemon, diagnostics, install: `daemon.*`, `diagnostics.*` with findings as data, `install.*`; the launcher modules become adapters. `config.*` beyond `status` stays with #14366 | new | P1 |
| E1 | Engine commands: the engine exports the functions behind `install`, `remove`, `list`, `config`, `auth`, `schedule`, `session-of-pid`, `models discover`; omo pins that engine and re-exports them as `engine.*` | new, on the engine and on omo | engine part: none; omo part: P1 and the pin |
| D1 | Truthful delivery: the engine's `held` with `engineTurnCap` mapped to a parked delivery kind (#14941, after the engine fix for its #7138 is released and pinned); a repeated key reports the current kind with `deduplicated: true` | #14941 | the engine pin; no dependency on T1, because the result type does not move |
| X1 | The proof of section 9 recorded on #14943; `docs/reference/omo-sdk.md` replacing the per-entry SDK pages; the skill that teaches it (#13415) | new | T2, T3, A1, A2 |
| X2 | The omo-harness skill's `omo` driver and fleet roster call the SDK instead of the CLI | new, on that repository | T1 released |

Order and parallelism:

```
P0 ─┐
    ├─ P1 ─┬─ T1 ─┬─ T2 ─┐
#14881, #14890      │      └─ T3 ─┤
           ├─ A1 ────────┤
           ├─ A2 ────────┼─ X1
           └─ C1 ────────┘
E1 (engine) ── pin ── E1 (omo)          D1 after its own pin          X2 after T1 ships
```

- T1, A1, A2 and C1 touch disjoint directories (`components/thread`, the account core and `omo-native/account-*`, `components/remote` service and `omo-native/sync-*` and `remote-local`, `omo-native/bin/lib`), so they run at the same time once P1 is in.
- The shared state between parallel slices is small and named: the generated bundles (`service-auth.generated.js`, the thread client and SDK bundles, the bundle inputs), which every slice regenerates and which therefore merge through the repository's bundle train; the code registry and exit table, which P1 owns and later slices only append to; and the parity rows, split per domain file for this reason.
- T2 and T3 both follow T1 and do not touch each other's files; they run in parallel.
- Work already in review is not redone: #14881 and #14890 are P1's base; #14937 is reused by T1; the engine fix for #7138 and #14941 are D1.

Each slice follows the repository's delivery rules: a worktree off `dev`, a failing test first, the whole suite through the receipt path at the top head, and the changelog fragment.

## 9. The proof

One scenario, three times, each on its own. A pass through the CLI alone proves nothing about the other two.

Scenario, between two signed-in devices A (the caller) and B:

1. Create a thread on B with a first prompt; note the `thread` value.
2. Read it from A: the first prompt and its answer are in the transcript.
3. Send a follow-up; wait for the turn to end; read the answer.
4. Send a long-running prompt; steer the running turn; read both.
5. Interrupt the running turn; the answer says `interrupted: true`.
6. Set the model; `get` shows the new model.
7. Open a second thread on B (the sibling).
8. Close the first thread; list from A: the first is closed and the sibling is still listed and live.

Runs:

- (a) **SDK**: a plain bun script importing `omo-ai/sdk`, no agent session, no `omo` child process.
- (b) **Tools**: an agent session on A calling `tool.thread_create`, `thread_read`, `thread_send`, `thread_interrupt`, `thread_set_model`, `thread_close` in eval cells.
- (c) **CLI**: `omo thread ...` with `--json`.

Evidence on #14943 for each run: the commands or script, each call's typed result, the transcript read that shows the prompt and the answer on the intended thread (a tool result or an exit code alone does not prove delivery), the final listing, and the build under test. The create step is also run once with the acknowledgement dropped by the fake relay in the conformance test of 7.3, since a real relay cannot be asked to lose a reply.

The runs use a sanctioned test account and a scripted or low-cost model. They make no call on a personal subscription.

## 10. Decisions this design makes, for the reviewer

1. **Two ok shapes are kept.** `threads.*` keeps the flat thread contract; the other namespaces keep `{ kind: "ok", value }`. One shape for both would break either the persisted thread contract and three downstream callers or the shipped omo SDK and the remote module. The failure branch, the part every caller branches on, is one shape. The alternative, moving everything to the flat shape with a named payload field per call, is cleaner to read and costs one breaking release of the omo SDK and of `omo-ai/remote` before either has outside users.
2. **Secrets leave through a sink, never a result** (section 4.5), so the two credential hand-over verbs satisfy the superset rule without weakening the no-secret rule. The custody surface is gated by a security design before code.
3. **The principal is fixed at construction** (section 4.3), and the session principal is not constructible from the public entry. Admission rules do not change.
4. **Engine commands get real SDK calls through engine exports** (section 6.7), not a child process behind an SDK-shaped function. Until the engine exports them, their rows are recorded gaps.
5. **`omo remote` session verbs become aliases**, as the 2026-11-10 ruling already approved, and the device becomes an optional part of the address.
6. **The OpenCode-edition binary is listed and not migrated** (section 6.9) until the owner says the rule covers it.

## 11. Not in this program

- Step 2 of the 2026-11-10 ruling on #13016: both transports accepting both sender kinds.
- Remote approval-mode enforcement, device enrollment (#14365), configuration editing (#14366) and the session address format of #14044 beyond what section 5 needs. Each has its own issue; this design reserves their SDK names and does not design them.
- The desktop app's own adapters. The app follows the SDK surface this program settles; its migration is tracked in its repository.
- Any change to which capabilities exist. This program moves where they live and adds the SDK calls that are missing; it removes nothing a user can do today.
