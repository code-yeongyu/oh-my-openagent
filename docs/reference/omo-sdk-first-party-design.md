# The omo SDK as the first-party surface: design

Tracking issue: #14943. Status: design, revision 2, after the first review of #14944. Nothing in this document is implemented by the pull request that adds it.

Source was read at `dev` `2e2a815ac8` and at the engine's `main` `48983b7bf8` on 2026-11-25. No product command was run for this document; every "today" statement is a source reading with its file and line. Path abbreviations: `N/` = `packages/omo-native/`, `T/` = `packages/omo-senpi/src/components/thread/`, `R/` = `packages/omo-senpi/src/components/remote/`, `S/` = `packages/omo-senpi/src/components/omo-sdk/`, `E/` = the engine's `packages/coding-agent/src/`.

## 1. The rule

The owner's rulings on #14943 are the whole requirement:

1. One modular core per domain is the only implementation of that domain.
2. The SDK exposes that core directly. It is the first-party surface.
3. The CLI, the agent thread tools, the desktop app and every other caller are adapters over the SDK. They are third-party consumers of it.
4. **The SDK is the superset: SDK ⊇ CLI and SDK ⊇ tools.** Every capability exists in the SDK, with no exception. An adapter may expose less than the SDK, and each omission carries a written reason. The SDK never exposes less than an adapter. A capability that the CLI or a tool has and the SDK lacks is a defect, and its fix is the SDK call.
5. **Parity is a merge requirement of the same pull request.** A pull request that changes what a CLI verb or a tool does carries the SDK call and the parity test for that capability. It is not a follow-up.

Scope: the `omo` binary of the native edition (`omo-ai`), its thread tools, the SDK entries that ship with it, and, by the scope ruling recorded in section 6.11, every verb of the OpenCode-edition binary that shares a domain core with the native edition.

Three terms are used the same way everywhere below.

- A **capability** is one thing a caller can make omo do or read, with its inputs and its typed outcome. It is a leaf: one operation, with every input that changes its behaviour. A namespace, a wildcard or a set of flags is not a capability.
- A **core** is the module that implements a domain's capabilities: resolution, transport, state, policy, authority checks.
- An **adapter** is a file that turns a surface's input into an SDK call and the SDK's answer into that surface's output. It parses, calls and renders.

## 2. Today

### 2.1 Three SDK entries, three contracts

| Entry | How a caller finds it | What it answers | Result shape |
|---|---|---|---|
| Thread SDK, `createThreadSdk(options)` (declared `T/sdk.ts:119-162`, factory `T/sdk.ts:249`) | A file path inside the installed plugin, `runtime/thread-sdk/sdk.js` (`N/bin/lib/thread.js:163`); no environment variable names it | `list`, `read`, `send`, `locate`, `create`, `interrupt`, `close`, `rename`, `set_model`, `release`, `warmDaemon`, `dispose`, `principal`, the store extension API | `{ kind: "ok", ...fields }` or `{ kind: "error", error }`; `release` and `warmDaemon` answer the engine's own reply; a store extension call can answer `kind: "refused"` (`T/gateway/store-extensions.ts:52-72`) |
| omo SDK, `createOmoSdk(options?)` (`S/index.ts:40-59`) | `OMO_SDK_ROOT` inside a session (`packages/omo-senpi/src/extension/sdk-root-provisioning.ts:8`) | `account.whoami`, `account.signIn`, `devices.list`, `devices.rename`, `deviceService.status`, `config.status`, a synchronous `close()` | `{ kind: "ok", value }` or `{ kind: "error", error }` (`S/result.ts:27`) |
| Remote module, `remoteClientForPerson` and its sibling factories (`R/index.ts`, `R/factories.ts:14-33`, `R/types.ts:402-456`) | Source import only. The package export `omo-ai/remote` is #14881, open | `service.*`, `devices.*`, `sessions.*` (list, resolve, get, open, send, read, follow, wait, interrupt, setModel, setReasoning, close, archive), `attach`, `aliases.*` | `{ kind: "ok", value }` or a flat `{ kind: "error", code, message, ... }` with a branded thread handle and `Opts.deadlineMs` (`R/types.ts:55-74`) |

Each entry was built for one caller. None of them is the place where every capability lives.

### 2.2 Where the superset rule is broken today

SDK ⊉ tools:

- `thread_set_reasoning`, `thread_archive` and `thread_handoff` are registered tools (`T/tools.ts:497-542`) with no thread SDK method (`T/sdk.ts:119-162`).
- `thread_read` takes `wait_ms` and reads a delivery receipt by `delivery_id` (`T/contracts/params.ts:49-81`, `T/tools.ts:189-208`); the SDK's `read` takes neither.
- The tool contract names a message `message` and its lane `delivery` (`T/contracts/params.ts:83-92`); the SDK's `send` names them `text` and `mode`. The two are a projection of each other, not one schema.
- `thread_close` and `thread_rename` take an optional `thread` that defaults to the calling session (`T/contracts/params.ts:106-117`); the SDK acts as itself, so `self` answers `caller_context_missing` (`T/sdk.ts:178-181`).
- The tools call the shared bodies directly (`createGatewayServices`, `locateControl`, `createThread`), so nothing forces a new tool capability through the SDK.

SDK ⊉ CLI:

- `omo remote` session verbs import relay control, the relay session host, the relay transport, the delivery pipeline and the gateway store straight into the CLI file (`N/remote-session-verbs.ts:3-39`). #14890 moves them onto the remote module's person client; it does not put them behind one SDK.
- `omo remote attach`, `status`, `enable`, `disable`, `control`, `wake` and `bootstrap` have no call in either shipped SDK.
- `omo logout`, `omo account show|adopt|token|export|forget|store|devices revoke|retire-sync` and every `omo sync` verb have no SDK call (`N/account-cli.ts:134-211`, `N/sync-cli.ts:208-249`).
- `omo daemon`, `omo doctor`, `omo setup` and `omo update` are implemented in launcher modules under `N/bin/lib/` with no SDK call.
- The engine's one-shot commands are forwarded as argv. `ENGINE_COMMANDS` lists `install`, `remove`, `uninstall`, `update`, `list`, `config`, `auth`, `host`, `schedule`, `session-of-pid` (`N/bin/lib/engine-commands.js:4-16`); `models discover` is a separate branch (`:18-22`); `update` is intercepted as the product's own update unless it names the engine's `--extensions` or `--models` targets (`N/bin/lib/update-args.js:23-34`). No importable call exists for any of them.

Several resolution entries:

- The SDK's `send` resolves through `resolveAddress` and then builds its own delivery target after its owner fast path (#13016, rows OMO-MSG-07 and OMO-CLI-06, PARTIAL in the 2026-11-22 census). Its delivery to another device goes through the person leg (`T/sdk.ts:385-402`) and uses the listed session key directly, so it does not yet have the stale-route recovery the tool gets in #14937 (owner note on #14943, 14:01Z).
- The thread SDK has its own `locate` (`T/sdk.ts:404-447`); `createThread` resolves an existing thread and a fork source itself (`T/control/create.ts:134-153, 477-495`); the remote module has `sessions.resolve` with a cached index, its own incomplete-listing semantics and alias lookup (`R/resolve.ts:241-291`), and its session and attach members canonicalize handles (`R/sessions.ts:377-398`, `R/attach.ts:409-437`); `omo remote` enters through `resolveTypedAddress`.
- `omo remote model|interrupt|close|open` construct relay control outside `locateControl` and skip the ended-session short-circuit (#13016, rows OMO-CTL-26 and OMO-CLI-09).
- `omo thread` and `omo remote` keep two verb tables, two flag sets and opposite wait defaults (#13016, rows OMO-CLI-01, -02, -30). The owner approved one verb table over the ports on 2026-11-10 (step 1 of that ruling); nobody has built it.
- `omo remote` refuses a thread held on this device (`R/device-address.ts:31-41`), and `openRemote()` cannot open, send to, read or close a session on its own device (#14931).

Downstream: the omo-harness skill is moving its `omo` driver and relay listing onto the shipped thread SDK and `createOmoSdk().devices.list` (omo-harness-skill#23). It keeps a CLI call only for a step the SDK does not cover, and each such step is an SDK gap reported on #14943.

## 3. Target architecture

```
          scripts, connectors, other harnesses, the desktop app
                                 |
   CLI adapters      tool adapters      (parse, call, render; nothing else)
        \                 |                 /
         +---------- the omo SDK ----------+     one root, typed, data or a typed refusal
                          |
   threads  devices  account  deviceService  sync  config  daemon  diagnostics  install  engine  toolkit
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
| `threads` | `T/`: `address/` (the resolver over `packages/thread-address-core`), `gateway/` (delivery pipeline, store, decision table), `control/` (`SessionControl`, `SessionHost`, create, close ladder, operations), `tools/read-ops.ts`, `tools/archive-ops.ts`; the cross-device leg is `R/` | Core exists. The SDK, the tools and two CLIs enter it at different depths |
| `devices` | `R/` `devices.*` for the roster; the account service client for rename and revoke | Listing unified by #14881 (open). Revoke lives in a CLI file (`N/account-devices.ts:33-101`) |
| `account` | Session, credential store, device-code flow and device keys, today under `packages/omo-opencode/src/cli/service-auth/` | Core exists but sits under a `cli/` directory and is reached through `service-auth.generated.js` |
| `deviceService` | `R/` `service.*` plus `admin.ts` (bootstrap, cold wake, operator endpoint leg; #14890) | Core exists after #14890 |
| `sync` | `packages/memory-core` (`enableSync`, `disableSync`, `joinAccount`) and the recovery engine under review in #14464 | Core exists; ceremony orchestration is in CLI files |
| `config` | `packages/omo-config-core` | `config.status` shipped; #14366 defines the rest |
| `daemon` | The engine's host commands and the launch spec; omo's part is `N/bin/lib/daemon*.js` | Logic is in launcher modules |
| `diagnostics` | `N/bin/lib/doctor*.js` and the runtime bundles they load | Logic is in launcher modules; the output is prose only |
| `install` | `N/bin/lib/self-update.js`, `N/compiled-update*.ts`, `N/bin/lib/setup-*.js` | Logic is in launcher modules |
| `engine` | The pinned engine's command implementations (packages, settings, provider credentials, schedules, models, session launch options, one-shot queries) | Engine-owned. Reached only by forwarding argv |
| `toolkit` | The agent toolkit SDK (`OMO_AGENT_TOOLKIT_SDK_ROOT`) | Already SDK-only; re-exported under the root |

### 3.2 The adapter rule

An adapter is one **capability descriptor** per executable route, and every route of both entry paths (the npm launcher and the compiled binary) dispatches through the descriptor table:

```ts
{ route: ["remote", "attach"],            // the argv path, or the tool name
  flags: { /* typed: each flag names the SDK input field it fills, or is marked render */ },
  capability: "threads.attach",           // the registry row
  parse: (argv) => input,                 // surface input to SDK input
  call: (sdk, input) => sdk.threads.attach(input),
  render: { human, json, exit } }         // SDK answer to surface output
```

An adapter may contain argument or schema parsing, the SDK call, rendering, and for the tools the schema, the description and the receipt wrapper. It may not contain or import address or device resolution, transport or port construction, account or credential handling, or policy (delivery decisions, admission, idempotency, retries, deadlines).

What can be checked mechanically and what cannot is stated in section 7.5. In short: imports and descriptor shape are checked by CI; that an adapter does not compute a decision inline from plain code is held by the descriptor's structure, by the conformance test on sampled scenarios, and by review. It is not proven by any import rule.

The process-level tail of a few verbs stays in the CLI because it is not a capability: replacing the terminal process with the engine after `daemon adopt` or `remote attach`, re-executing under another runtime, reading a TTY. Everything up to that point, including the plan for what to launch, is SDK data.

## 4. The SDK

### 4.1 One root, and the entries that already shipped

```ts
import { createOmoSdk } from "omo-ai/sdk"

const omo = createOmoSdk()
const sent = await omo.threads.send({ thread: "studio/review", message: "status?" })
if (sent.kind === "error") console.error(sent.error.code, sent.error.next_action)
omo.close()
```

The root is `createOmoSdk`, extended additively: its present options (`api`, `env`, `cwd`, `home`, `ports`) and its synchronous `close()` stay, and it gains the namespaces of 4.2, the thread options (`agentDir`, `uid`, `user`, with today's CLI defaults), `host` (a non-default engine endpoint: socket and credential root), `principal` (4.3) and an asynchronous `dispose()` that also closes the gateway store and remote sessions.

Three shipped contracts are kept as **compatibility facades**: thin modules over the root that preserve their signature, results and lifecycle exactly, each pinned by its existing tests. They are projections, not second implementations.

| Facade | What it preserves | Projection onto the root |
|---|---|---|
| `createThreadSdk(options)` at `runtime/thread-sdk/sdk.js` | Required options; `principal`; `dispose`; `release(thread, request)` and `warmDaemon()` answering the engine's own replies; `set_model`; `send({ text, mode })`; `self` answering `caller_context_missing`; the store extension API with its `refused` branch and its present method names | `text` to `message`, `mode` to `delivery`; snake_case method names to camelCase |
| `createOmoSdk(options?)` at `OMO_SDK_ROOT` | Its four namespaces, their `value` results, synchronous `close()` | Identity: the root is this entry, extended |
| `openRemote(options?)` at `omo-ai/remote` (#14881) | The remote client's member list, the flat failure, the branded thread handle, `Opts.deadlineMs`, `REMOTE_CODES` | Flat failure from the root's nested one; handle from the canonical address of section 5 |

The facades are removed only by a later, announced release, after their callers have moved.

- Package name: `omo-ai/sdk`, added to the `exports` of `N/package.json` beside `./remote`.
- Outside a session with a global install: `omo sdk root` prints the directory of the built entry (an adapter over `install.sdkRoot()`).
- Importing the entry has no side effect: no socket, no file, no process, no network. Each namespace loads its core on first use.

### 4.2 Namespaces

`threads`, `devices`, `account`, `deviceService`, `sync`, `config`, `daemon`, `diagnostics`, `install`, `engine`, `mcp`, `toolkit`, plus `close()` and `dispose()`. Method names are camelCase. The root's input types for the thread calls are the schemas in `T/contracts/params.ts` and `create-params.ts` themselves (field names, optionality, bounds and defaults), not a copy; where the root adds an input a tool lacks, it extends that schema. The method and input list is section 6.

### 4.3 Authority

The SDK is a library in its caller's process. It is never the authority, and nothing in this program makes it one. A private export or an import rule is an architectural boundary; neither is evidence of authorization.

Authority is enforced where it is enforced today, in the core and behind it:

- the engine endpoint: socket credentials, `admitExternalMessage`, the sender kinds the gateway accepts;
- the device service and the relay: same-account admission and the sender kinds each transport accepts;
- the account service: the signed-in device's session.

The principal a root is built for selects which existing leg a call uses and what it stamps on what it sends. The remote module already builds one client per sender (`R/factories.ts:14-33`); the root does the same. Availability of a method on the root is not permission to run it: each core checks the principal against the capability and answers a typed refusal.

What the source fixes today, and what this program preserves without widening:

| Rule | Where |
|---|---|
| A script acts as itself, never as a session: `self` is `caller_context_missing`, and a thread it creates records no creator | `T/sdk.ts:178-181` |
| The local delivery transport refuses a person's prompt | `T/gateway/local-transport.ts:9-25` |
| The relay transport refuses a command-line sender (`unsupported`, `sender_not_allowed`) | `T/remote/relay-transport.ts:895-910` |
| A parked session's intake accepts only an agent sender | `T/gateway/store-worker.ts:134-145` |
| A session or a connector may keep or narrow its own approval mode when it opens a thread, never widen it (`scope_denied`, `permission_preset_wider`) | `T/contracts/create-params.ts:92-99`, `R/types.ts` (`OpenRequest`) |
| `author` on a send is accepted only from a connector | `R/types.ts:124-125` |
| Setting the wake switch is a person's call | `R/types.ts` (`service.setWake`) |
| A store extension's session-callable operation runs only for the session it is authorized for | `T/gateway/store-extensions.ts:107-139` |

Step 2 of the 2026-11-10 ruling on #13016 (both transports accepting both sender kinds) is not approved and stays out of scope.

**Gate before code (slice S0).** A principal-by-capability matrix, every principal (script, person at a terminal, connector, session, service) against every capability row of section 6 with allow or refuse and the place that enforces it, is written and approved as a security design before the root wires any principal (slice P1b). It covers session creation, attach and answering a dialog, connector rights, and the person-only account, device and host administration. The parity migration exposes no authority that a caller does not have today; the matrix is how that is checked, and its refusals are scenarios of the conformance test.

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

- On the root, the error branch has one shape in every namespace. It is the shape the thread tools and the omo SDK already share. The remote module's flat failure is converted at the root's boundary by one function (`uncertain`, `command_id` and `partial` move into `details`) and converted back by the `omo-ai/remote` facade.
- `OmoCode` is one registry: the union of `THREAD_ERROR_CODES`, the omo SDK's codes and `REMOTE_CODES`, one meaning per name.
- The ok branch on the root has two shapes, both already shipped: `threads.*` answers the thread contract (`{ kind: "ok", thread, delivery, ... }`, `T/contracts/results.ts`), and every other namespace answers `{ kind: "ok", value }`. The thread contract is persisted in receipts, replayed and printed by `omo thread --json`, so it does not move. **The delivery result type does not move**: #14941 and the replay fix for a repeated idempotency key build on the present shape. This is a real cost to a generic caller, and the document does not claim one universal result.
- Exit codes are a projection keyed by surface, not one table. Today `internal_error` exits 5 from `omo thread` (`N/bin/lib/thread.js:126-132`) and 1 from `omo remote` (`R/codes.ts:195-213`), and `omo account` and `omo daemon` have their own maps (`N/account-show.ts:24-36`, `N/bin/lib/daemon-args.js:7-13`). Each descriptor's `render.exit` names its surface's map; tests pin both the JSON and the exit outcome of every existing verb before any alias is removed or any wait default changes.
- Streams (`threads.follow`, `threads.attach().events`) are `AsyncIterable` with a `stop()`. A stream ends with one terminal event that carries either the outcome or a failure; it never throws from `next()`, and `stop()` ends it with a terminal `cancelled` outcome.
- Every call that can wait takes `{ signal?, deadline_ms? }`. A call that left this device and got no answer inside its budget answers `delivered_unconfirmed` or `idempotency_uncertain` as it does today, never a generic timeout, and a timeout or an authorization refusal never triggers a second write. A retried create under the original idempotency key returns the original thread, with the original caller identity, and no duplicate (#14560, #14569).

### 4.5 Credentials and custody

Six groups of calls touch a credential or a secret a person must hold:

| Group | Today |
|---|---|
| The omo account's access token and stored credential | `omo account token` and `omo account export` print them with structured metadata (expiry, device, owner) for our own processes (`N/account-cli.ts:118-146`) |
| A sign-in handed over by the desktop app | `omo account adopt` reads a credential |
| The device-code sign-in | An event protocol: `ready`, `code` (verification URL, user code, matching code, expiry), `signed_in` (api, device, replaced device, device-service outcome), `refused` (`N/account-sign-in.ts:37-59, 173-232`) |
| The sync recovery phrase | `omo sync enable` shows it once after an eligibility check that runs before any phrase exists (`N/sync-cli.ts:76-113`); `omo sync recover` takes it |
| Model provider credentials | `omo auth check [--credentials]`, `omo auth print-api-key`, `omo auth print-bearer-token` (`E/cli/auth-command.ts:19-21`) and the launch input `--api-key` |
| The engine endpoint's own credentials | `--rpc-key-root`, a terminal endpoint's socket secret |

The superset rule requires an SDK call for each. The rule of this document is that **no secret is a field of a result, a failure, a stream event, a receipt or a log line**. The proposed carrier is a caller-supplied sink for a secret going out and a readable or a callback for one coming in.

That shape is a proposal, not a custody design, and avoiding a result field does not establish custody. A sink or a callback the caller defines proves nothing about who is entitled to the value. **Slice S0 settles the custody contract as a security design before any of these calls is written**, and it must cover, for every row above:

- who may call it (the matrix of 4.3) and what provenance the core demands of that caller;
- every check that runs before a secret exists or moves (the sync eligibility check is one);
- the structured, non-secret metadata each call keeps returning, and the event order of the sign-in protocol;
- failure paths and partial outcomes: what the sink has received when the call fails halfway, and what the failure says;
- logging, telemetry, receipts and model-facing surfaces, with a non-disclosure test that plants canary secrets in fake ports and scans results, errors, logs, receipts, callback and stream handling;
- the human-mediated steps (comparing codes, holding a phrase), which stay human-mediated.

No tool exposes these calls. Until S0 is approved their registry rows stay recorded defects, and the pull requests of the memory-sync lane that touch recovery (#14464, #14891) carry the typed `sync.recover` call over their one recovery engine on the contract S0 and P1a publish; this program does not write a second recovery implementation.

Error messages are the core's own words. An exception from a lower layer is mapped to a code; its text is not appended (the thread SDK's `thrown` appends it today, `T/sdk.ts:178-203`).

### 4.6 Ports

Every external dependency is behind a port that a test replaces: the engine host socket (`ThreadSdkOptions.host`), the gateway store, the device-service connection, the account session and credential store (`OmoSdkPorts`), the child process, the file system roots, and the clock. Timeouts, TTLs, the close ladder's waits and the device-code polling read the clock port, so their tests run on a virtual clock and inject one fault at a time (a lost reply, a store lock timeout, a 401) without waiting or breaking a real service. No test in this program sleeps for wall time except where time itself is the behaviour.

The per-caller telemetry consent contract for engine open, attach and live updates (the engine's #7446) is an engine-owned dependency: the effective policy is decided in one core, and no adapter or resolver carries a copy of it.

## 5. One resolution contract

A thread is named by one string, `thread`, and every surface accepts exactly the strings every other surface prints (#14044).

Grammar: `self`, a bare address, or `<device>/<thread>`, parsed only by `packages/thread-address-core` `parseAddress` (`parse.ts:26-59`), which excludes path-like text and takes optional scope and prefix controls, so not every string with a slash is a device address. The thread part resolves as durable id, session key, account alias, exact name in scope, then a unique id prefix (`ladder.ts:10-73`). The device part resolves as device id, `here`, device name, then a unique id prefix, with typed refusals for a shared name or prefix (`device.ts:24-76`).

The contract, one function that every entry goes through:

```ts
resolve(address, { operation, principal, scope, need })
  -> { kind: "ok", thread, device, holder, leg }      // thread: the canonical string every surface takes back
   | OmoFailure                                        // not_found, ambiguous_target, scope_denied, device_offline, ...
```

- `operation` is one of `deliver`, `control`, `read`, `attach`, `open_existing`, `fork_source`, `locate`. It decides what the target must be (live for control, listed for read, any for a queued delivery) and which refusal an ended, inactive or offline target gets.
- `principal` and `scope` are part of the input, not ambient. `self` resolves only for a session principal and is `caller_context_missing` for every other. `all_scope` widens this device's workspace scope only. A holder-qualified address (`<device>/<thread>`) is exact; a bare address that two holders answer is `ambiguous_target` with both candidates, never a pick.
- `need` carries the listing requirement (`online`, `any`) and whether an incomplete listing is a refusal or a warning, which is the remote module's present distinction.

Every entry that resolves today enters this function and loses its own ladder:

| Entry today | After |
|---|---|
| Tools: `locate` for delivery, `locateControl` | The two locators call `resolve` with `deliver` and `control` |
| Thread SDK `send`'s own target construction, `locate` (`T/sdk.ts:404-447`) | `resolve` with `deliver`, `locate` |
| `createThread`'s existing-thread and fork-source lookup (`T/control/create.ts:134-153, 477-495`) | `resolve` with `open_existing`, `fork_source` |
| Remote module `sessions.resolve` (`R/resolve.ts:241-291`) and the handle canonicalization in `sessions.ts` and `attach.ts` | The account-side lookup becomes a port under `resolve` and keeps its cached index and incomplete-listing semantics as inputs; the `omo-ai/remote` facade's `sessions.resolve` and `aliases.resolve` call `resolve` |
| CLI `resolveTypedAddress` (`R/device-address.ts`) | Removed; the CLI passes the typed string to the SDK |

What follows from one contract:

- A thread opened over the relay is not special: `threads.create({ device })` answers a `thread` value, and every other call takes it back unchanged from the SDK, the tools and the CLI, on the device that opened it and on any other signed-in device.
- The device is an optional part of the address. On the caller's own device every verb works, not only open: create, send, read, follow, wait, interrupt, set model, set reasoning, rename, archive, attach and close (#14931). The person client is given this device's operator endpoint leg lazily, from the remote module's `admin.ts` entry (#14890).
- A stale route is recovered inside the core, once, by locating the live owner read-only and sending to the resolved key, with separate sender identities and with no second write after a timeout or an authorization refusal. That behaviour comes from #14937, which is held for its SDK-first fix; no adapter re-implements it.

Tests, each as a matched pair for a target on this device and on another, for each principal that may run the operation: ambiguity (bare and holder-qualified), an inactive and an ended session, a stale listing, an alias, `here`, workspace scope with and without `all_scope`, and a relay-opened handle taken through every verb and back. A context-dependent operation asserts its expected refusal for the principals that lack the context; a deliberate principal difference is an expected outcome, not a failure.

## 6. Parity table

Direction: **SDK ⊇ CLI and SDK ⊇ tools.** Every row is a leaf capability with its inputs and has an SDK call.

- **SDK today**: **yes** (the root or a facade answers it with these inputs at the pinned commit), **partial** (one of the three entries answers part of it; the gap is named), **no** (a defect under the rule).
- **Adapter**: for a CLI or tool cell that is empty, either **planned** with the slice that adds it, or **omitted** with the reason it is intentionally narrower. "Not built yet" is never a reason.

### 6.1 Threads: reading

| Capability and SDK inputs | CLI today | Tool | SDK today | Adapter |
|---|---|---|---|---|
| `threads.list({ all_scope?, state?, device?, project?, name?, archived?, idempotency_key? })`. `state` is the thread vocabulary (`opening`, `running`, `idle`, `inactive`, `archived`), repeatable; the remote alias's `ended` is accepted and mapped by a fixed table so that no ended row is dropped | `omo thread list [--all-scope] [--state ...]` (repeatable or comma-separated); `omo remote sessions [--device] [--project] [--state running\|idle\|ended]`; `omo host session list` | `thread_list { all_scope?, state?, idempotency_key? }` | partial: no `device`, `project`, `name`, `archived` filter in the thread SDK (remote module has them, `R/types.ts:233-239`) | Tool omits the four filters: rows carry `device`, `cwd`, `name` and status, and the listing is one bounded payload the model filters |
| `threads.read({ thread, cursor?, max_bytes?, wait_ms?, all_scope?, idempotency_key?, limit? })`: the bounded transcript projection | `omo thread read <t> [--limit] [--max-bytes] [--cursor]` | `thread_read` | partial: no `wait_ms`, no `idempotency_key`; `--limit` is sliced in the CLI (`N/bin/lib/thread.js:92-95`) | None |
| `threads.entries({ thread, since?, before?, tail?, limit?, max_bytes? })`: raw session entries by entry id. `since` is an entry id, not the read cursor | `omo host session read <ref> [--tail N] [--since <entryId>]` | none | partial: remote module `sessions.read(thread, { before, tail })` | Tool omitted: raw entries are unbounded engine records; the tool's read is the budgeted, model-shaped projection. CLI planned (T3) as `omo thread read --entries` |
| `threads.messages({ thread })`: the engine's message list | `omo host session read <ref> --messages` | none | no | Tool omitted: same reason. CLI planned (T3) |
| `threads.receipt({ thread, delivery_id, all_scope? })`: the outcome of the caller's own delivery to that exact thread; reads no conversation, sends nothing, wakes nothing | none | `thread_read { thread, delivery_id }` | no | CLI planned (T3): `omo thread receipt` |
| `threads.get({ thread })`: model, reasoning, approval mode, turn, pending dialogs and queue | `omo host session state <ref>` | none | partial: remote module `sessions.get` | Tool planned (T2): the `thread_list` row gains `reasoning` and `pending`, which it lacks today (`T/contracts/results.ts:89-107`). CLI planned (T3): `omo thread state` |
| `threads.wait({ thread, until?, deadline_ms? })` | `omo host session wait <ref> [--until idle\|done] [--timeout]` | `thread_read { wait_ms }` | partial: remote module `sessions.wait`; the local wait is inside the tool body | CLI planned (T3): `omo thread wait` |
| `threads.follow({ thread, from? })`: status changes, turn ends and the turn's stream, with the promised receipt of the send it follows | `omo remote send` (its default; `--no-wait` and `--timeout` bound it) | none | partial: remote module `sessions.follow` | Tool omitted: a tool result is one bounded payload and nothing streams into a model call; an agent waits with `thread_read { wait_ms }` |
| `threads.locate({ thread, all_scope? })` | none | none | yes | Tool and CLI omitted: resolution is internal to every verb, and the holder is on the list row. Kept for `daemon adopt` and connectors |

### 6.2 Threads: writing and control

| Capability and SDK inputs | CLI today | Tool | SDK today | Adapter |
|---|---|---|---|---|
| `threads.send({ thread, message, delivery?, expected_turn_id?, summary?, idempotency_key?, collapse_key?, all_scope?, attachments?, author? })`. `author` only from a connector | `omo thread send <t> <text> [--mode] [--expected-turn] [--idempotency-key] [--collapse-key]`; `omo remote send <s> <text> [--steer\|--follow-up] [--no-wait] [--timeout]`; `omo host session prompt\|steer <ref> <text\|@file>` | `thread_send` (all fields but `attachments`, `author`) | partial: own target construction (#13016); `summary` and attachments only in the remote module; the facade's names are `text`, `mode` | Tool omits `attachments` and `author`: a session's message is text plus its provenance header, and `author` is a connector's identity field |
| `threads.create({ thread?, device?, alias?, name?, cwd?, worktree?: { branch?, base? }, fork_from?, skills?, model?, reasoning?, permission_preset?, prompt?, delivery?, idempotency_key?, launch_spec? })`. `thread` (open an existing thread on whichever device holds it, optionally with `prompt`) never with `device`; `fork_from` is refused `unsupported` (`fork_unsupported`) until the engine forks on open; a wider `permission_preset` is `scope_denied` | `omo remote open <device> [--project] [--model] [--thinking] [--permission-preset] [--worktree [--branch] [--base]] [--prompt [--steer\|--follow-up]]`; `omo host session open --cwd [--model] [--name] [--prompt] [--launch-spec]` | `thread_create` (all fields but `launch_spec`) | partial: the thread SDK creates; `omo remote open` skips the create orchestration (#13016 OMO-CTL-26); no `launch_spec` | Tool omits `launch_spec`: which launch spec a host starts from is the installation's, not a session's choice. CLI planned (T3): `omo thread create`, with `--thinking` kept as the spelling of `reasoning` |
| `threads.interrupt({ thread, turn_id?, all_scope?, idempotency_key? })` | `omo remote interrupt <s>`; `omo host session abort <ref>` | `thread_interrupt` | partial: no `idempotency_key` contract stated for the script principal | CLI planned (T3): `omo thread interrupt` |
| `threads.close({ thread?, force?, graceful?, wait_ms?, idempotency_key?, all_scope? })`. `thread` omitted or `self` means the calling session and is `caller_context_missing` for any other principal | `omo thread close <t> [--force \| --graceful [--wait-ms]] [--idempotency-key]`; `omo remote close <s> [--force] [--graceful] [--wait-ms]`; `omo host session close <ref>` | `thread_close` | yes | None |
| `threads.unload({ thread, interrupt?, force?, clear_queue?, children?: "refuse" \| "detach" })`: takes the session out of its host and keeps it resumable. It is not a close | `omo host session unload <ref> [--interrupt] [--force] [--clear-queue] [--children refuse\|detach]` | none | no | Tool omitted: an agent ends a peer through the close ladder, which chooses the step and reports what it dropped; choosing the raw step lets a session detach another session's children, which no ruling grants. CLI planned (T3) |
| `threads.setModel({ thread, model, provider?, idempotency_key?, all_scope? })` | `omo remote model <s> <provider/id>`; `omo host session model <ref> <provider/id>` | `thread_set_model` | yes (`set_model` on the facade) | CLI planned (T3): `omo thread model` |
| `threads.setReasoning({ thread, level, scope?, idempotency_key?, all_scope? })` | none | `thread_set_reasoning` | **no** in the thread SDK; remote module only | CLI planned (T3): `omo thread reasoning` |
| `threads.rename({ thread?, name?, alias?, idempotency_key?, all_scope? })`, `thread` optional as for close | none | `thread_rename` | yes | CLI planned (T3): `omo thread rename` |
| `threads.aliases.resolve({ alias })`, `.set({ thread, alias })`, `.clear({ thread })` | none | `thread_rename { alias }`, `thread_create { alias }` | partial: remote module `aliases.*` | CLI planned (T3) through `omo thread rename --alias`. Tool omits a bare `resolve`: every tool input already takes an alias |
| `threads.archive({ thread, archived?, idempotency_key?, all_scope? })` | none | `thread_archive` | **no** in the thread SDK; remote module only | CLI planned (T3): `omo thread archive` |
| `threads.handoff({ thread, match?, message, delivery?, expected_turn_id?, summary?, idempotency_key?, all_scope? })` | none | `thread_handoff` | **no** | CLI planned (T3): `omo thread handoff`, exact unless `--match fuzzy` |
| `threads.attach({ thread })` answering `{ snapshot, events, read, pending, answer, command, serveEndpoint, detach }`; the served endpoint closes when the attach ends, including when the connection drops | `omo remote attach <s>` (TUI); `omo remote answer` arrives with #14890 | none | partial: remote module `attach` | Tool omitted: answering another session's approval dialog is an authority decision, and no ruling gives a session that authority over a peer |
| `threads.adopt({ thread, interrupt?, force? })` answering the release and the launch plan: session path, working directory, and the queued prompts to replay in order | `omo daemon adopt <s> [--interrupt] [--force] [--json]` | none | partial: `locate` and `release`; the launch plan is built in the CLI (`N/bin/lib/daemon-adopt.js:118-155`) | Tool omitted: it ends in replacing a terminal process. That replacement stays in the CLI; the plan is SDK data |
| `threads.extensions.declare(ops)`, `.call({ extension, op, input })`, and the session-callable variant that runs only for its authorized session, with each operation's declared input schema | none | `ext_<extension>_<tool>`, one per declared operation, registered at session start | yes on the facade (`registerStoreExtension`, `extensionCall`) | CLI omitted: an extension declares session tools; no person-facing verb exists or is asked for |

### 6.3 Devices

| Capability and SDK inputs | CLI today | Tool | SDK today | Adapter |
|---|---|---|---|---|
| `devices.list()` | `omo remote devices`; `omo account devices` | `thread_list` (its `devices` block) | yes; one listing after #14881 | None |
| `devices.resolve({ device })` | implicit in every `<device>/...` | none | partial: remote module | Tool and CLI omitted: resolution is part of each verb |
| `devices.rename({ id, name })`, the name bounded as the sign-in bounds it (#14523) | none | none | yes | CLI planned (A1c): `omo account devices rename`. Tool omitted: an account-level change a person makes |
| `devices.revoke({ device, confirm_name })`: by id, name or unique prefix; an ambiguity revokes nothing; never this device | `omo account devices revoke <id>` | none | **no** (#14364 keeps it as its last step) | Tool omitted: it destroys a sign-in and is the person's decision |

`devices.enroll` (#14365) is outside this program; the name is reserved.

### 6.4 Account

| Capability and SDK inputs | CLI today | Tool | SDK today | Adapter |
|---|---|---|---|---|
| `account.whoami()`, `account.show({ account? })` | `omo whoami [--api]`; `omo account show [--account]` | none | partial: `whoami` | Tool omitted: a session reads it from the SDK in an eval cell |
| `account.signIn({ method?, onUserCode, onOpenUrl?, deviceName?, replace?, signal? })` answering the device, the replaced device and the device-service outcome, with the event order `ready`, `code`, `signed_in` or `refused`; `account.signInCheck()`. The service origins come from the root's `api` and `accounts` options. While accounts are closed, only the device-code route is admitted and every other combination is a typed refusal, as the CLI refuses it today | `omo login [--device] [--no-browser] [--replace] [--api] [--accounts]`; `omo account sign-in [--stdin\|--check]` | none | partial: device code only, and it runs the CLI as a child (`S/account/sign-in-process.ts`) | Tool omitted: a sign-in needs a person at a browser. The SDK stops running the CLI; the CLI calls the SDK |
| `account.signOut()`, `account.forget({ device? })` (this device only; another device is `devices.revoke`) | `omo logout [--api]`; `omo account forget [--device <id>]` | none | **no** | Tool omitted: ends the session's own sign-in |
| `account.adopt({ credential, replace? })`, the credential an input, with the keep-current and replace rules of today | `omo account adopt [--replace]` | none | **no**; custody (S0) | Tool omitted: a hand-over between our own processes |
| `account.credentials.handOver({ what: "access_token" \| "stored_credential", sink })`, returning the non-secret metadata the verbs print today (expiry, device, owner) | `omo account token`; `omo account export` | none | **no**; custody (S0) | Tool omitted: section 4.5 |
| `account.store.status()`, `.enable()`, `.disable({ discard? })` | `omo account store status\|enable\|disable [--discard]` | none | **no** | Tool omitted: changes where credentials live on the machine |

### 6.5 Device service (remote switches)

| Capability and SDK inputs | CLI today | Tool | SDK today | Adapter |
|---|---|---|---|---|
| `deviceService.status()` with the local service units; `deviceService.info()` | `omo remote status` | none | partial: the omo SDK's narrower status; remote module `service.status`, `service.info` | Tool omitted: `thread_list` already answers `remote_unavailable` with the reason an agent can act on |
| `deviceService.enable()`, `.disable()`, with the opt-out record and the cold-wake steps the CLI runs around them today | `omo remote enable`; `omo remote disable` | none | partial: remote module `service.setEnabled`, `admin.ts` | Tool omitted: these switches decide what other devices may do on this machine; that consent is the person's |
| `deviceService.control()`, `.setControl(on)` | `omo remote control [on\|off]` | none | partial: remote module | Same reason |
| `deviceService.wake()`, `.setWake(on \| null)`, person only | `omo remote wake [on\|off\|default]` | none | partial: remote module | Same reason |
| `deviceService.bootstrap({ install?, adopt? })` | `omo remote bootstrap` | none | partial: remote module, `admin.ts` | Tool omitted: it downloads and installs a service |

### 6.6 Sync

| Capability and SDK inputs | CLI today | Tool | SDK today | Adapter |
|---|---|---|---|---|
| `sync.enable({ onCode, confirm, phrase: sink, signal? })`, eligibility checked before a phrase exists | `omo sync enable` | none | **no**; custody (S0) | Tool omitted: the ceremony has a person compare codes on two screens and keep a phrase |
| `sync.disable()` | `omo sync disable` | none | **no** | Tool omitted: a person's choice about this device's memory |
| `sync.status()` | `omo sync status [--json]` | none | **no** | Tool omitted: read from the SDK in an eval cell |
| `sync.approve({ id?, confirmCode })` | `omo sync approve [id]` | none | **no** | Tool omitted: the approval is the comparison a person makes |
| `sync.recover({ phrase: readable, confirm })`, over the one recovery engine of #14464 | `omo sync recover` | none | **no**; custody (S0); built in the memory-sync lane's pull requests | Tool omitted: takes the recovery phrase |
| `sync.retirePin({ account })` | `omo account retire-sync --account <id>` | none | **no** | Tool omitted: called by the desktop app when it discards its own sealed session |

### 6.7 Config, daemon and hosts, diagnostics, install

| Capability and SDK inputs | CLI today | Tool | SDK today | Adapter |
|---|---|---|---|---|
| `config.status()` | `omo doctor` (its `WARN config:` lines) | none | yes | CLI planned only if #14366 asks for a verb |
| `config.explain`, `.check`, `.edit`, `.revert`, `.modelSwaps` (#14366) | none | none | no | Owned by #14366; the names are reserved here |
| `daemon.ensure({ policy?, pinned?, launch_spec?, socket?, mcp_presenter_enforcement? })`, then `daemon.warm({ cwd?, kind?, context? })` | `omo daemon run [--no-upgrade] [--pinned] [--json]`; `omo host ensure [--launch-spec] [--policy upgrade\|fallback\|never] [--socket] [--rpc-key-root] [--mcp-presenter-enforcement]` | none | partial: `warmDaemon` only | Tool omitted: host lifecycle of the machine the calling session runs on; a session that stops or hands over its own host ends its own call |
| `daemon.status({ all?, include_workers?, socket? })`, each terminal row with its last activity | `omo daemon status [--include-workers]`; `omo host status [--all] [--include-workers] [--socket]` | none | **no** | Tool omitted: `thread_list` answers the session-level question; endpoint internals stay out of model-facing output (#14044) |
| `daemon.stop({ drain?, instance?, wait_ms?, force?, expected_generation?, socket? })` | `omo daemon stop [--drain]`; `omo host stop [--drain [--instance] [--wait-ms]] [--force] [--expected-generation] [--socket]` | none | **no** | Same reason as ensure |
| `daemon.stopAll({ drain?, wait?, deadline_ms? })` | `omo daemon stop --all [--drain] [--wait [--timeout]]` | none | **no** | Same reason |
| `daemon.handoff({ launch_spec?, socket?, allow_downgrade?, when?: { idle: { operation, if_instance, if_generation, target_build } } })` | `omo daemon handoff`; `omo host handoff [--launch-spec] [--socket] [--allow-downgrade] [--when idle --operation --if-instance --if-generation --target-build]` | none | **no** | Same reason |
| `daemon.gc({ prune_store_index?, agent_dir? })` | `omo daemon gc [--prune-store-index]`; `omo host gc [--agent-dir]` | none | **no** | Same reason |
| `daemon.rollbackPrepare({ stores?, allow_missing_index?, dry_run? })` | `omo daemon rollback-prepare [--store <dir>]... [--allow-missing-index] [--dry-run]` | none | **no** | Same reason |
| `daemon.shardPath({ kind, owner, root? })` | `omo host shard-path --kind p\|i --owner <id> [--root]` | none | **no** | Tool omitted: an endpoint internal |
| `diagnostics.run()` answering findings as data, `.models()`, `.fixReflectionLock({ dry_run? })`, `.reapStaleEngines({ pids })` | `omo doctor`; `--models`; `--fix [--dry-run]`; `--reap` | none | **no** | Tool omitted: it reads and repairs the installation under the running session; `reapStaleEngines` ends processes and takes explicit pids only |
| `install.setup.detect()`, `.plan()` (what `--dry-run` prints), `.apply(plan, { consent })` (asked once, or per stage as `--ask-each` does) | `omo setup [--yes] [--ask-each] [--dry-run]` | none | **no** | Tool omitted: plan, consent, write is a person's flow |
| `install.update({ dry_run? })` | `omo update [--dry-run \| --print] [--self]`, and the `self`, `senpi`, `omo` targets | none | **no** | Tool omitted: replaces the binary the session runs on |
| `install.version()`, `install.sdkRoot()` | `omo --version`, `-v`; `omo sdk root` (new) | none | **no** | Tool omitted: `OMO_SDK_ROOT` is already in a session's environment |
| `toolkit.*` (the agent toolkit SDK) | `omo ulw-loop` answers that it moved to the SDK | n/a | yes | The CLI verb is already retired in favour of the SDK |

### 6.8 Engine commands forwarded by the launcher

The launcher forwards these to the pinned engine unchanged. Their core is the engine's. Under the rule each still needs an SDK call. The engine exports a typed function per leaf operation, with no process exit and no printing, and its own CLI calls the same function; the omo SDK re-exports it. The SDK does not start the engine CLI as a child for them. Forwarding an argv today proves nothing about an importable equivalent, so these functions and their ownership of lifecycle and output are settled in the engine first (slice E1a).

| Capability and SDK inputs | CLI today | Tool | SDK today | Adapter |
|---|---|---|---|---|
| `engine.packages.install({ source, local?, trust? })` | `omo install <source> [-l\|--local] [--approve\|--no-approve]` | none | **no** | Tool omitted: installs code into the engine |
| `engine.packages.remove({ source, local?, trust? })` | `omo remove\|uninstall <source> [-l] [--approve\|--no-approve]` | none | **no** | Same reason |
| `engine.packages.list({ trust? })` | `omo list [--approve\|--no-approve]` | none | **no** | Same reason |
| `engine.packages.update({ source?, all?, trust? })` | `omo update --extensions`, `--extension <source>`, `<source>`, `--all` (its package half) | none | **no** | Same reason. The product half of `--all` and a bare `update` are `install.update`; the launcher's routing between the two is a typed rule in the descriptor, and a combination it refuses today stays refused |
| `engine.models.update()` | `omo update --models` | none | **no** | Tool omitted: `thread_set_model` resolves against the catalog the target already has |
| `engine.models.discover()`, `engine.models.list({ pattern? })` | `omo models discover`; `omo --list-models [pattern]` | none | **no** | Same reason |
| `engine.config.agentDir()` | `omo config agent-dir --json` | none | **no** | Tool omitted: a host integration's lookup |
| `engine.config.resources({ local?, trust? })` read, and `.setResource(...)` write: enabling and disabling package resources | `omo config [-l] [--approve\|--no-approve]` (a TUI) | none | **no** | Tool omitted: #14366 decides what a session may edit. The TUI is a renderer over the two calls |
| `engine.auth.check({ provider?, model?, refresh? })` | `omo auth check --provider <p> [--model] [--json] [--no-refresh]` | none | **no** | Tool omitted: provider credentials |
| `engine.auth.check({ ..., credentials: sink })`, `engine.auth.apiKey({ provider?, model?, sink })`, `engine.auth.bearerToken({ provider?, model?, min_expiry_ms?, sink })` | `omo auth check --credentials`; `omo auth print-api-key`; `omo auth print-bearer-token [--min-expiry]` | none | **no**; custody (S0) | Tool omitted: section 4.5 |
| `engine.schedule.list()` | `omo schedule list [--json]` | none | **no** | Tool omitted: the engine's `schedule_prompt` tool is the session surface for creating one |
| `engine.schedule.cancel({ id })` | `omo schedule cancel <id>` | none | **no** | Same reason |
| `engine.schedule.run({ watch?, exec?, poll_seconds?, timeout_seconds?, concurrency?, signal? })`, a stream of deliveries when watching | `omo schedule run [--watch] [--exec] [--poll-seconds] [--timeout-seconds] [--concurrency]` | none | **no** | Tool omitted: it resumes sessions headlessly on this machine, an operator's runner |
| `engine.sessionOfPid({ pid })` | `omo session-of-pid <pid> --json` | none | **no** | Tool omitted: a host integration's lookup |
| `engine.sessions.exportHtml({ session, out })` | `omo --export <file>` | none | **no** | Tool omitted: writes a file for a person |
| `engine.promptSizes(options)`, `engine.tips()` | `omo --print-prompt-sizes`; `omo --list-tips` | none | **no** | Tool omitted: installation diagnostics |
| Host sessions | `omo host session open\|close\|unload\|model\|prompt\|steer\|abort\|read\|state\|list\|wait [--socket] [--rpc-key-root]` | the thread tools | partial | The `threads.*` rows of 6.1 and 6.2; the endpoint is the root's `host` option |

### 6.9 Launching a session process

`omo [flags] [prompt]` starts an engine process. Its flags are of three kinds, and each flag is its own registry row.

| Kind | Flags (`E/cli/args.ts`) | SDK |
|---|---|---|
| Which session | `--continue`, `--resume` (a picker), `--session <path>`, `--session-id <id>`, `--fork <path\|id>`, `--rebind <path\|id>`, `--no-session`, `--session-dir <dir>`, `--spawned-by <json>`, `--name` | Inputs of `threads.create`: `session: { continue? \| path? \| id? \| fork? \| rebind? \| ephemeral? }`, `session_dir?`, `spawned_by?`, `name?`. The picker is a renderer over `threads.list`. Ancestry (`spawned_by`) is accepted only from the principals that may set it today |
| How the session is set up | `--model`, `--provider`, `--models <patterns>`, `--thinking`, `--system-prompt`, `--append-system-prompt`, `--tools`, `--exclude-tools`, `--no-tools`, `--no-builtin-tools`, `--extension`, `--no-extensions`, `--skill`, `--no-skills`, `--prompt-template`, `--no-prompt-templates`, `--theme`, `--no-themes`, `--use-theme`, `--no-context-files`, `--approve`, `--no-approve`, `--offline`, `--session-runtime`, `--tool-runtime`, `--auto-title-sessions`, `--api-key` | Inputs of `threads.create` under `setup`: `{ model?, provider?, model_patterns?, reasoning?, system_prompt?, append_system_prompt?, tools?: { allow?, deny?, none?, no_builtin? }, extensions?, skills?, prompt_templates?, themes? (each with its discovery switch), context_files?, project_trust?, offline?, session_runtime?, tool_runtime?, auto_title? }`. `--api-key` is a credential input and belongs to the custody design (S0). Themes are a terminal's rendering and are accepted and ignored by a headless create |
| How the process presents the session | `--print`, `--mode text\|json\|rpc`, `--listen <address>`, `--multi-session`, `--hand`, `--headless`, `--attach <socket>`, `--tui-mode`, `--verbose`, `--grok-neo` and other feature-gated modes, `--mcp-presenter-fd`, `--mcp-presenter-enforcement` | Not capabilities of their own: each is a process boundary or a renderer over calls that exist. Print and JSON mode render `threads.create` + `threads.send` + `threads.follow`. `--mode rpc` and `--listen` serve the engine RPC that the SDK's host port speaks; a listening multi-session host is what `daemon.ensure` brings up. `--hand` and `--headless` start the hand and the machine-owned session host that the device service's remote legs reach. `--attach` presents a session another endpoint serves, which is what `omo remote attach` launches over `threads.attach().serveEndpoint`. Each is registered as `process` with the capability it presents, and a new mode needs that classification to pass the check |

An extension can register launch flags of its own (the engine's help names `--plan` from its plan-mode extension as an example). They are session setup inputs owned by that extension: the registry discovers them from a test engine session, as it discovers run-time tools, and each maps to `setup.extension_flags`.

The engine's exported `Args` schema (slice E1a) is the typed source for these inputs; the classification above is from the engine's parser and help text.

### 6.10 Rows that are not capabilities

- **Internal**: entries the binary dispatches for its own processes (`__kill-guard`, `__device-service-bootstrap` from #14890, `remote enable --after-login`, the engine's `--omo-local-update-worker`, and the compiled binary's `loro-smoke` at `N/compile-entry.ts:180-183`, a self-check that the bundled sync runtime initializes and reproduces its committed encodings). Each is registered as `internal` with the capability it serves (`deviceService.bootstrap`, `install.update`, and a finding of `diagnostics.run` for the self-check), so a hidden verb cannot bypass the check by being hidden.
- **Retired**: a verb that only answers where it went (`omo app-server`, `omo ulw-loop`), registered with the call that replaced it.
- **Render**: `--help`, `-h`, `--json`, `--verbose` on any verb.

### 6.11 The OpenCode-edition binary

`packages/omo-opencode` ships a different binary (`oh-my-opencode`, `oh-my-openagent`). The scope ruling on #14943 (2026-11-25, decided on the owner's delegation):

- A verb that shares a domain core with the native edition goes through the **same core and the same SDK call**. The OpenCode-edition CLI becomes one more adapter; it gets no second implementation.
- A verb that exists only in that edition and has no native equivalent is registered as an **edition adapter with no SDK call yet**, with that written reason and its own issue. No slice of this program waits on it, and the zero-gap gate does not cover it.

| Capability and SDK inputs | CLI (OpenCode edition) | SDK today | Adapter |
|---|---|---|---|
| `install.plugin({ interactive?, subscriptions, codex_autonomous?, skip_auth?, platform? })`: writes the plugin's configuration for the chosen provider subscriptions | `install` (alias `setup`) `[--no-tui] [one flag per provider subscription] [--codex-autonomous \| --no-codex-autonomous] [--skip-auth] [--platform]` | **no** | Planned (OC1). The interactive prompts are a renderer over the same call |
| `threads.create({ ..., agent? })` + `threads.send` + `threads.follow`, through a session-host port for that edition's server; the endpoint (`--port`, `--attach <url>`) is the root's `host` option | `run <message> [-a\|--agent] [-m\|--model] [-d\|--directory] [-p\|--port] [--attach <url>] [--session-id] [--on-complete <command>] [--json] [--no-timestamp] [--verbose]` | partial: the calls exist for the native engine only | Planned (OC1). `--on-complete` runs a shell command after the process is done and stays a process-level tail of the CLI |
| `diagnostics.run({ status?, verbose?, platform? })` | `doctor [--status] [--verbose] [--json] [--platform]` | **no** | Planned (OC1), on the findings shape of C1b |
| `install.version()`, `install.localVersion({ directory? })` | `version`; `get-local-version [-d\|--directory] [--json]` | **no** | Planned (OC1) |
| `config.migrate({ dry_run? })` answering the transform, the backup move plan and the conflicts | `config migrate [--dry-run] [--json]` | **no** | Planned (OC1) |
| `config.modelCapabilities.refresh({ directory?, source_url? })`, over `packages/model-core` | `refresh-model-capabilities [-d\|--directory] [--source-url] [--json]` | **no** | Planned (OC1). The ruling does not name this verb; it is classified as shared because its core is a shared package |
| `mcp.oauth.login({ server, server_url?, client_id?, scopes? })`, `.logout({ server, server_url? })`, `.status({ server? })`, over `packages/mcp-client-core`. The tokens are credentials | `mcp oauth login <server-name> [--server-url] [--client-id] [--scopes ...]`; `mcp oauth logout <server-name> [--server-url]`; `mcp oauth status [server-name]` | **no**; custody (S0) | Planned (OC1), after S0 |
| `account.keys.init()`, `.status()`: this device's keyring, answering the device id and the public signing and sealing keys only | `account keys init`; `account keys status` | **no**; custody (S0) | Planned (OC1), after S0 |
| `toolkit.*` | `ulw-loop [args...]` | yes | None: a pass-through to the toolkit |

Edition adapters with no SDK call yet, by the ruling:

| CLI (OpenCode edition) | Reason | Tracking |
|---|---|---|
| `boulder [-d\|--directory] [-w\|--work-id] [--json]` | It reports that edition's own work tracking; the native edition has no equivalent verb and no caller outside that edition asks for it | Its own issue under #14943, opened with the slices |
| `worktree-sweep [--apply] [--older-than <days>] [--repo <path>]... [--json]` | A maintenance command of that edition's worktrees; no native equivalent | Same issue |
| `cleanup` (alias `uninstall`) `[--codex-home] [--project] [--json]` | It removes that edition's installed artifacts; no native equivalent | Same issue |

These three are the only rows in the registry without an `sdk` field. They carry `edition: "opencode"`, `scope: "edition_only"`, the reason and the issue, and a fourth such row cannot be added without a scope ruling recorded the same way.

## 7. Holding parity in CI

The first review showed that a row table, an import guard and sampled scenarios do not enforce the rule by themselves. The checks below say what each one fails on and what it cannot see.

### 7.1 Descriptors: every route is a leaf with typed inputs

- Both entry paths dispatch only through the descriptor table of section 3.2. A test parses `N/bin/omo.js`, `N/bin/lib/launcher.js` and `N/compile-entry.ts` and fails on any comparison of an argv element against a string literal outside the table lookup. Today's early branches (`remote attach` before the remote table, `models discover` outside `ENGINE_COMMANDS`, `loro-smoke` in the compiled entry) become descriptors.
- Every flag of a descriptor names the SDK input field it fills, or is marked `render` or `process`. A flag with no mapping fails.
- For engine-forwarded commands the descriptors are generated from the engine's exported command metadata (E1a). Until that export exists, the baseline of 7.4 lists every engine leaf and flag of sections 6.8 and 6.9 explicitly; a wildcard or a namespace cannot stand for them.

### 7.2 The registry: SDK ⊇ CLI, SDK ⊇ tools

`script/sdk-parity/rows/<domain>.json`, one file per domain. A row:

```json
{ "id": "threads.setReasoning",
  "sdk": "threads.setReasoning",
  "cli": [],
  "tool": "thread_set_reasoning",
  "planned": { "cli": "T3" },
  "omitted": {},
  "projection": {} }
```

- `sdk` is required by the schema for every row in scope. An SDK omission cannot be written. The schema admits a row without it only with `scope: "edition_only"`, a reason and an issue, and a test pins that set to the three rows of 6.11.
- An empty `cli` or `tool` cell needs either `planned` (a slice) or `omitted` (a reason). The two are different fields, so pending work is never recorded as a decision.
- **CLI ⊆ SDK.** Every descriptor has a row, and every mapped flag's field exists in the SDK call's input schema.
- **Tools ⊆ SDK.** Tools are discovered from a test engine session's registry (`getAllTools()` on the pinned engine, as `eval-only.test.ts` already builds one), so a tool registered at run time, such as a store extension's, is seen. For each tool the SDK call's effective input schema is compared recursively with the tool's: every property, nested object, optionality, bound and default. A declared `projection` (for example `text` to `message` on the legacy facade) is the only accepted difference.
- **A row's call is real.** A row without a baseline entry must name at least one conformance scenario (7.3) that passes through the SDK driver. A function that answers `unsupported` is a stub and fails this; being a function on the root is not enough.
- The published table of section 6 is rendered from the rows and compared byte for byte.

### 7.3 One scenario table, three drivers

`sdk-conformance.test.ts` extends `T/route-parity.test.ts` and the device-service conformance owner that #14890's tests run on. Each scenario is driven three ways against the same fake engine endpoints and fake device service: the SDK directly, the tool's `execute`, and the CLI's descriptor with `--json`. The three typed outcomes must be equal after each surface's declared projection, and the fakes must have received the same calls. Scenarios, with a target on this device and on another for each: every address form of section 5; send in each mode; create with a lost acknowledgement and a retry under the same key, keeping caller identity and the original session; every control verb on a live, an ended and an offline target; each refusal code; a timeout and an authorization refusal with no second write; a stream cancelled midway and its terminal outcome; a held delivery, a capped delivery and a repeated key reporting the current kind (#14941); the refusals of the authority matrix. Non-thread domains have the same table with two drivers (SDK and CLI). All of it runs on the virtual clock.

This check sees a behaviour difference only on a sampled scenario. It does not prove an adapter is pure.

### 7.4 The baseline, and the same-pull-request gate

Rule 5 of section 1 is enforced per capability, not per count.

- `script/sdk-parity/baseline.json` freezes today's defects as exact entries: capability id, the missing SDK input or call, and the issue that fixes it. It is written once, in slice P0, and is pinned by hash. Entries can only be removed.
- **Changed-capability gate.** A script compares the descriptors and tool schemas of the pull request's head with its merge base. Any descriptor or schema that was added or changed must have no baseline entry at the head: a pull request cannot add an alias, a flag or a tool field under an existing gap. It adds the SDK call and its scenario in the same pull request, or it fails.
- **Zero-gap gate.** #14943 closes only when the baseline is empty for everything in scope: the native edition, the engine rows, and the shared-domain verbs of the OpenCode edition (6.11). The three edition-only rows of 6.11 are outside it by ruling.

### 7.5 Adapter purity, and what is not provable

- **Imports** (`script/remote-import-guard-*`, one more rule family): an adapter's direct imports, and those of any helper it imports that is not the SDK entry, may reach only the SDK entry, its own parse and render modules, and platform built-ins that are not sockets or `fetch`. Today's violations go into an offender list that only shrinks. This fails on an adapter that imports a resolver or a transport.
- **Descriptor shape**: a lint over the descriptor table requires `call` to be a single SDK invocation whose arguments come from `parse`'s output, with no branch on an SDK result, no loop and no second call. This catches an adapter that composes several calls or decides something from an answer.
- **Not provable by either**: an adapter whose `parse` or `render` computes a decision inline from plain code, importing nothing. The conformance test catches it only where a scenario exercises the difference. The remaining control is review: the pull request template of every slice carries the line "this adapter holds no resolution, transport or policy" for the reviewer to verify against the diff. This document does not claim the four checks prove purity.

### 7.6 Negative controls

The checks are themselves tested. Fixtures add, one at a time: a verb with no row; a flag with no mapping; a tool input field the SDK lacks; a nested field that became required; a branch that dispatches outside the table; an adapter importing the delivery pipeline; a descriptor with two calls; a changed capability under a baseline entry; a stub answering `unsupported` on a row with no baseline entry. Each must fail with a message that names the SDK call, the field or the import to fix.

### 7.7 The real-surface proof

Section 9. It is the only check that needs real devices, so it runs last and only on a build that passed the others.

## 8. Migration slices

Each slice is one issue under #14943 and one pull request with `Fixes #<slice>`, sized to be reviewed as one unit. An existing call keeps working until its replacement has its scenario and its proof.

| Slice | What it does | Issue | Merges after |
|---|---|---|---|
| S0 | Security design, no code: the principal-by-capability matrix of 4.3 and the custody contract of 4.5, approved by a security design review | new | none |
| P0 | Descriptors for today's routes, the registry rows, the frozen baseline, the import and shape rules with their offender lists, the negative controls. No behaviour change | new | none |
| P1a | Typed contracts only: the root's type with every namespace and input schema of section 6, the code registry, the scenario ids. No implementation | new | P0 |
| P1b | The root and the three facades over it, the failure conversion, the surface-keyed exit projection, `omo-ai/sdk`, `omo sdk root`, principals wired per the matrix, the non-disclosure scan | new | P1a, S0, #14881, #14890 |
| T1a | The resolution contract of section 5 and the two locators over it; the ended-session rule (#13016 MSG-07, CLI-06, CTL-26, CLI-09) | #13016 | P1b; #14937 merged with its SDK-first fix |
| T1b | `threads.setReasoning`, `archive`, `get`, `wait`, `receipt`, `entries`, `messages`, `unload`; `read` and `interrupt` inputs | new | T1a |
| T1c | `threads.handoff`, `follow`, `attach`, `aliases`, `adopt`'s launch plan | new | T1a |
| T1d | Every verb on the caller's own device | #14931 | T1a, #14890 |
| D1 | Truthful delivery: `held` with `engineTurnCap` mapped to a parked kind; a repeated key reports the current kind | #14941 | T1a (same files: serialized, not parallel), the engine pin |
| T2 | The thread tools become adapters; `*-ops.ts` bodies move under the core | new | T1b, T1c |
| T3 | One CLI verb table (step 1 of the 2026-11-10 ruling); the `omo thread` verbs planned in section 6; `omo remote` session verbs as aliases | #14202, #13016 | T1b, T1c |
| A1a | The account core moves out of `cli/`; no behaviour change | #14364 | P1b |
| A1b | `account.signOut`, `show`, `forget`, `store.*`, `signIn` without a child process, the origin options | #14364 | A1a |
| A1c | `devices.revoke`, `devices.rename` bounds, the other findings of #14523 | #14523 | A1a |
| A1d | `account.adopt`, `account.credentials.handOver` | new | A1b, S0 |
| A2a | `deviceService.*` and the `omo remote` switch verbs as adapters | new | T3 (both edit `N/remote-cli.ts` and its dispatch) |
| A2b | `sync.status`, `enable`, `disable`, `approve`, `retirePin` | new | A1b (shares account and sync state transitions), S0 for the phrase |
| A2c | `sync.recover` | #14464, #14891 (the memory-sync lane's own pull requests carry it) | P1a, S0 |
| C1a | `daemon.*` | new | P1b |
| C1b | `diagnostics.*` | new | P1b |
| C1c | `install.*` | new | P1b |
| E1a | Engine: a typed function and exported metadata per leaf of 6.8 and 6.9, by group (packages, settings, schedules, queries, launch options; provider credentials after S0) | new, on the engine | none |
| E1b | Engine release and the omo pin | release train | E1a |
| E1c | `engine.*` on the root, generated descriptors, and the engine-and-omo compatibility test, owned by this program | new | E1b, P1b |
| OC1 | The OpenCode-edition CLI becomes an adapter for its shared-domain verbs (6.11): `install.plugin`, the session-host port for `run`, `diagnostics`, `install.version` and `localVersion`, `config.migrate`, `config.modelCapabilities.refresh`; `mcp.oauth.*` and `account.keys.*` after S0 | new | P1b, C1b, C1c, T1c |
| X1a | The thread proof of section 9, recorded on #14943 | new | T1d, T2, T3 |
| X1b | Closure: the zero-gap gate, the non-thread acceptance rows, `docs/reference/omo-sdk.md`, the skills re-pointed at the SDK (#13415, #14932) | new | every slice above |
| X2 | The omo-harness skill: the steps omo-harness-skill#23 left on the CLI move to the SDK | new, on that repository | the release that carries the calls it needs |

Shared state between slices that run at the same time, and who owns it:

- **The root's namespace wiring.** Each namespace is its own module, registered in one array that P1b creates; a slice adds its module and one line. P1b's owner reviews every later edit to the root.
- **The code registry and the exit projection.** Per-domain files, appended to by each slice; a change to an existing code's meaning goes through P1b's owner.
- **The parity rows and the baseline.** Rows are per-domain files; the baseline is only ever shortened, and two slices never own the same entry.
- **Generated bundles** (`service-auth.generated.js`, the thread client and SDK bundles, the bundle inputs). Every slice regenerates them, so they merge through the repository's bundle train.
- **`N/remote-cli.ts` and remote dispatch**: T3 first, then A2a. **Account and sync state transitions** (`retire-sync`, the sign-in's device-service setup): A1b first, then A2b.
- **Delivery handling**: T1a, then D1; the delivery contract is pinned by a shared test before either edits it.

Work already in review is the base, not redone: #14878, #14881 and #14890 (the remote module train) under P1b; #14937 under T1a; the engine fix for #7138 under D1; #14464 and #14891 for recovery.

## 9. The proof

A pass through the CLI alone proves nothing about the other two surfaces. Each matrix row is run three times, each run on its own: (a) a plain bun script importing `omo-ai/sdk`, with no agent session and no `omo` child process; (b) an agent session calling the thread tools in eval cells; (c) `omo thread ... --json`.

Thread matrix, with B another signed-in device and A the caller, and again with A as its own target:

1. Create a thread with a first prompt; read it back: the prompt and its answer are in the transcript of the intended thread.
2. Send a follow-up; wait for the turn to end; read the answer.
3. Send a long-running prompt; steer the running turn; read both.
4. Interrupt the running turn (`interrupted: true`).
5. Set the model and the reasoning level; `get` shows both.
6. Rename it and give it an alias; address it by the alias from the other surface.
7. Read the receipt of one earlier delivery.
8. Open a sibling thread; close the first; the listing shows it closed and the sibling still live.

Acceptance rows outside threads, run through the SDK and the CLI on the caller's device: `devices.list`, `account.whoami`, `deviceService.status`, `sync.status`, `daemon.status`, `diagnostics.run`, `install.version`, and one engine row from each group of 6.8.

Evidence on #14943 for each run: the script or commands, each call's typed result, the transcript read that shows the prompt and the answer on the intended thread (a tool result or an exit code alone does not prove delivery), the final listing, and the build under test. Loss and refusal cases (a dropped acknowledgement, a timeout, an authorization refusal, a cancelled stream) are proven in the conformance test of 7.3, since a real relay cannot be asked to lose a reply.

The runs use a sanctioned test account and a scripted or low-cost model. They make no call on a personal subscription.

## 10. Decisions, after the first review

| # | Decision | Review verdict | Where it stands |
|---|---|---|---|
| 1 | Two ok shapes on the root: the flat thread contract, and `value` elsewhere | Accept conditionally | Kept. The three shipped entry contracts are preserved by explicit facades (4.1), and the document no longer claims one universal result or one exit table (4.4) |
| 2 | Secrets leave through a sink, never a result | Revise | The sink is a proposal only. Custody is a security design, slice S0, approved before any credential-bearing call is written (4.5) |
| 3 | The principal is fixed at construction | Revise | The principal selects a leg; authority is checked in the core against a principal-by-capability matrix, approved in S0 before principals are wired (4.3) |
| 4 | Engine commands get real SDK calls through engine exports | Accept conditionally | Each leaf and flag is a row now (6.8, 6.9); the typed functions are settled in the engine first, with an explicit export, release and pin sequence and a compatibility test this program owns (E1a to E1c) |
| 5 | `omo remote` session verbs become aliases | Accept conditionally | Both historical projections (flags, wait default, JSON, exit codes) are pinned by tests before the implementations converge; an alias is removed only after one release and only when its descriptor's tests show no caller-visible difference; sender admission is not widened |
| 6 | The OpenCode-edition binary | Scope decision required | Ruled on #14943: shared-domain verbs go through the same core and SDK call (slice OC1); three edition-only verbs are registered with a reason and their own issue (6.11) |

## 11. Not in this program

- Step 2 of the 2026-11-10 ruling on #13016: both transports accepting both sender kinds.
- Remote approval-mode enforcement, device enrollment (#14365), configuration editing (#14366) and the session address format of #14044 beyond what section 5 needs. Each has its own issue; this design reserves their SDK names and does not design them.
- The desktop app's own adapters. The app follows the SDK surface this program settles; its migration is tracked in its repository.
- Any change to which capabilities exist or to who may use them. This program moves where they live and adds the SDK calls that are missing; it removes nothing a user can do today and grants nothing a caller cannot do today.
