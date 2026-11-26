# The omo SDK as the first-party surface: design

Tracking issue: #14943. Status: design, revision 5, after four reviews of #14944. Nothing in this document is implemented by the pull request that adds it, and nothing in it is a security approval: authority and custody are settled by the separate security design (slice S0, #14945).

Source was read at `dev` `2e2a815ac8` and at the engine's `main` `48983b7bf8` on 2026-11-25. No product command was run for this document; every "today" statement is a source reading with its file and line. Path abbreviations: `N/` = `packages/omo-native/`, `T/` = `packages/omo-senpi/src/components/thread/`, `R/` = `packages/omo-senpi/src/components/remote/`, `S/` = `packages/omo-senpi/src/components/omo-sdk/`, `C/` = `packages/omo-opencode/src/cli/`, `E/` = the engine's `packages/coding-agent/src/`.

## 1. The rule

The owner's rulings on #14943 are the whole requirement:

1. One modular core per domain is the only implementation of that domain.
2. The SDK exposes that core directly. It is the first-party surface.
3. The CLI, the agent thread tools, the desktop app and every other caller are adapters over the SDK. They are third-party consumers of it.
4. **The SDK is the superset: SDK ⊇ CLI and SDK ⊇ tools.** Every capability exists in the SDK, with no exception. An adapter may expose less than the SDK, and each omission carries a written reason. The SDK never exposes less than an adapter. A capability that the CLI or a tool has and the SDK lacks is a defect, and its fix is the SDK call.
5. **Parity is a merge requirement of the same pull request.** A pull request that changes what a CLI verb or a tool does carries the SDK call and the parity test for that capability. It is not a follow-up.

Scope: both editions. The `omo` binary of the native edition (`omo-ai`), its thread tools, the SDK entries that ship with it, and every verb of the OpenCode-edition binary (section 6.11), by the scope decision recorded on #14943. No binary is carved out.

Three terms are used the same way everywhere below.

- A **capability** is one thing a caller can make omo do or read, with its inputs and its typed outcome. It is a leaf: one operation, with every input that changes its behaviour. A namespace, a wildcard or a set of flags is not a capability.
- A **core** is the module that implements a domain's capabilities: resolution, transport, state, policy, authority checks.
- An **adapter** is a file that turns a surface's input into one SDK call and the SDK's answer into that surface's output. It parses, calls and renders.

## 2. Today

### 2.1 Three SDK entries, three contracts

| Entry | How a caller finds it | What it answers | Result shape |
|---|---|---|---|
| Thread SDK, `createThreadSdk(options)` (options `T/sdk.ts:54-80`, declared `:119-162`, factory `:249`) | A file path inside the installed plugin, `runtime/thread-sdk/sdk.js` (`N/bin/lib/thread.js:163`); no environment variable names it | `list`, `read`, `send`, `locate`, `create`, `interrupt`, `close`, `rename`, `set_model`, `release`, `warmDaemon`, `dispose`, `principal`, and the store extension API (`registerStoreExtension`, `extensionCall`) | `{ kind: "ok", ...fields }` or `{ kind: "error", error }`; `release` and `warmDaemon` answer the engine's own reply; a store extension call can answer `kind: "refused"` |
| omo SDK, `createOmoSdk(options?)` (`S/index.ts:40-59`) | `OMO_SDK_ROOT` inside a session (`packages/omo-senpi/src/extension/sdk-root-provisioning.ts:8`) | `account.whoami`, `account.signIn`, `devices.list`, `devices.rename`, `deviceService.status`, `config.status`, a synchronous `close()` | `{ kind: "ok", value }` or `{ kind: "error", error }` (`S/result.ts:27`) |
| Remote module, `remoteClientForPerson` and its sibling factories (`R/index.ts`, `R/factories.ts:14-35`, `R/types.ts:402-456`) | Source import only at the pinned commit. The package export `omo-ai/remote` is #14881, in review, not shipped | `service.*`, `devices.*`, `sessions.*` (list, resolve, get, open, send, read, follow, wait, interrupt, setModel, setReasoning, close, archive), `attach`, `aliases.*` | `{ kind: "ok", value }` or a flat `{ kind: "error", code, message, ... }` with a branded thread handle and `Opts.deadlineMs` (`R/types.ts:55-74`) |

### 2.2 Where the superset rule is broken today

SDK ⊉ tools:

- `thread_set_reasoning`, `thread_archive` and `thread_handoff` are registered tools (`T/tools.ts:497-542`) with no thread SDK method (`T/sdk.ts:119-162`).
- `thread_read` is one tool with three behaviours: a receipt lookup when `delivery_id` is given, which runs before the normal read and its admission (`T/tools.ts:189-208`), a read after a wait when `wait_ms` is given, and a plain read (`T/contracts/params.ts:49-81`). The SDK's `read` has only the last.
- The tool contract names a message `message` and its lane `delivery` (`T/contracts/params.ts:83-92`); the SDK's `send` names them `text` and `mode`.
- `thread_close` and `thread_rename` take an optional `thread` that defaults to the calling session (`T/contracts/params.ts:106-117`); the SDK acts as itself, so `self` answers `caller_context_missing` (`T/sdk.ts:142-146`).
- The SDK's `close` and `set_model` accept the tool schema, `idempotency_key` included, but do not use the key (`T/sdk.ts:488-506`); the tools run the same bodies inside their receipt protocol (`T/tools.ts:199-209`). A field the parser accepts is not the capability.
- A store extension's session-callable operations run through a session channel that the SDK deliberately does not expose, because the caller must be the one the engine resolved (`T/gateway/store-extensions.ts:107-139`).
- The tools call the shared bodies directly, so nothing forces a new tool capability through the SDK.

SDK ⊉ CLI:

- `omo remote` session verbs import relay control, the relay session host, the relay transport, the delivery pipeline and the gateway store straight into the CLI file (`N/remote-session-verbs.ts:3-39`). #14890 moves them onto the remote module's person client; it does not put them behind one SDK.
- `omo remote attach`, `status`, `enable`, `disable`, `control`, `wake` and `bootstrap` have no call in either shipped SDK.
- `omo logout`, `omo account show|adopt|token|export|forget|store|devices revoke|retire-sync` and every `omo sync` verb have no SDK call (`N/account-cli.ts:134-211`, `N/sync-cli.ts:208-249`).
- `omo daemon`, `omo doctor`, `omo setup` and `omo update` are implemented in launcher modules under `N/bin/lib/` with no SDK call.
- The engine's one-shot commands are forwarded as argv. `ENGINE_COMMANDS` lists `install`, `remove`, `uninstall`, `update`, `list`, `config`, `auth`, `host`, `schedule`, `session-of-pid` (`N/bin/lib/engine-commands.js:4-16`); `models discover` is a separate branch (`:18-22`). `update` is the product's own update unless it names an engine target (`N/bin/lib/update-args.js:23-34`). No importable call exists for any of them.
- No verb of the OpenCode-edition binary has an SDK call (section 6.11).

Several resolution entries:

- The SDK's `send` (`T/sdk.ts:351-402`) resolves through `resolveAddress` and then builds its own delivery target after its owner fast path (#13016, rows OMO-MSG-07 and OMO-CLI-06). Its delivery to another device goes through the person leg (`:385-402`) and uses the listed session key directly, so it does not have the stale-route recovery the tool gets in #14937 (owner note on #14943).
- The thread SDK has its own `locate` (`T/sdk.ts:404-447`); `createThread` resolves an existing thread and a fork source itself (`T/control/create.ts:134-153, 477-495`); the remote module has `sessions.resolve` with a cached index, its own incomplete-listing semantics and alias lookup (`R/resolve.ts:241-291`), and its session and attach members canonicalize handles (`R/sessions.ts:377-398`, `R/attach.ts:409-437`); `omo remote` enters through `resolveTypedAddress`.
- The tools' delivery locator carries policy the others lack: exact or fuzzy matching, reply pinning and the reply grant (`T/tools.ts:583-678`).
- `omo remote model|interrupt|close|open` construct relay control outside `locateControl` and skip the ended-session short-circuit (#13016, rows OMO-CTL-26 and OMO-CLI-09).
- `omo thread` and `omo remote` keep two verb tables, two flag sets and opposite wait defaults (#13016, rows OMO-CLI-01, -02, -30). The owner approved one verb table over the ports on 2026-11-10 (step 1 of that ruling).
- `omo remote` refuses a thread held on this device (`R/device-address.ts:31-41`), and `openRemote()` cannot open, send to, read or close a session on its own device (#14931).

Downstream: the omo-harness skill is moving its `omo` driver and relay listing onto the shipped thread SDK and `createOmoSdk().devices.list` (omo-harness-skill#23). It keeps a CLI call only for a step the SDK does not cover, and each such step is an SDK gap reported on #14943.

## 3. Target architecture

```
          scripts, connectors, other harnesses, the desktop app
                                 |
   CLI adapters (both editions)      tool adapters      (parse, one call, render)
        \                                 |                 /
         +------------------ the omo SDK ------------------+     one root, typed, data or a typed refusal
                                 |
   threads  devices  account  deviceService  sync  config  daemon  diagnostics  install  engine  mcp  boulder  worktrees  toolkit
                                 |                                 (one core per domain)
        ports: session host, delivery transport, device service, account service,
               credential store, phrase terminal, process, file system, clock
                                 |
     this device's engine endpoints      the relay and other devices      the account service
```

Same-device and cross-device differ only in which transport a port resolves to. No layer above the ports branches on locality (#12879, #13414).

### 3.1 Domains and their cores

| Domain | Core (the only implementation) | State today |
|---|---|---|
| `threads` | `T/`: `address/` (the resolver over `packages/thread-address-core`), `gateway/` (delivery pipeline, store, decision table), `control/` (`SessionControl`, `SessionHost`, create, close ladder, operations), `tools/read-ops.ts`, `tools/archive-ops.ts`; the cross-device leg is `R/` | Core exists. The SDK, the tools and two CLIs enter it at different depths |
| `devices` | `R/` `devices.*` for the roster; the account service client for rename and revoke | Listing unified by #14881 (in review). Revoke lives in a CLI file (`N/account-devices.ts:33-101`) |
| `account` | Session, credential store, device-code flow and device keys, today under `C/service-auth/`; the device keyring under `C/account-keys/` | Core exists but sits under a `cli/` directory |
| `deviceService` | `R/` `service.*` plus `admin.ts` (bootstrap, cold wake, operator endpoint leg; #14890) | Core exists after #14890 |
| `sync` | `packages/memory-core` and the recovery engine under review in #14464 | Core exists; ceremony orchestration is in CLI files |
| `config` | `packages/omo-config-core`; `packages/model-core` for model capabilities | `config.status` shipped; #14366 defines the editing calls |
| `daemon` | The engine's host commands and the launch spec; omo's part is `N/bin/lib/daemon*.js` | Logic is in launcher modules |
| `diagnostics` | `N/bin/lib/doctor*.js`, the OpenCode edition's doctor, and the runtime bundles they load | Logic is in launcher and CLI modules; the output is prose only |
| `install` | `N/bin/lib/self-update.js`, `N/compiled-update*.ts`, `N/bin/lib/setup-*.js`; the OpenCode edition's install, cleanup and version checks | Logic is in launcher and CLI modules |
| `engine` | The pinned engine's command implementations (packages, settings, provider credentials, schedules, models, process launch, one-shot queries) | Engine-owned. Reached only by forwarding argv |
| `mcp` | `packages/mcp-client-core` | Reached only from the OpenCode edition's CLI |
| `boulder`, `worktrees` | `packages/boulder-state`; the OpenCode edition's worktree sweep | Reached only from that edition's CLI |
| `toolkit` | The agent toolkit SDK (`OMO_AGENT_TOOLKIT_SDK_ROOT`) | SDK exists for the native edition; the OpenCode edition delegates to a separately installed CLI (6.11) |

### 3.2 The adapter rule

An adapter is one **capability descriptor** per executable route, and every route of both editions' entry paths dispatches through its descriptor table:

```ts
{ route: ["remote", "attach"],            // the argv path, or the tool name
  when: (input) => true,                  // which branch of a multi-behaviour route this is
  flags: { /* typed: each flag names the SDK input field it fills, or is marked render or process */ },
  call: sdkCall("threads.attach"),        // the one SDK member this branch invokes; it IS the registry key
  parse: (argv) => input,                 // surface input to SDK input
  render: { human, json, exit } }         // SDK answer to surface output
```

- `call` is not a free function. `sdkCall("threads.attach")` is a typed reference to one member of the root, so the capability a row names and the member the adapter invokes are one value, and a test runs the descriptor against a recording root to confirm the member invoked.
- A route with several behaviours has several descriptors, told apart by `when`. `thread_read` is three: a receipt lookup (`delivery_id` present), a read with a wait, and a plain read. Each branch has its own input projection and its own registry row.
- An adapter never composes SDK calls. Where a surface does two things today, the two things become one named SDK operation in the core: `daemon.run` (ensure, then warm), `threads.sendAndFollow` (send, then follow the answer), `threads.adopt` (release, then the launch plan), `engine.launch.print` (create, send, follow in a new process). The policy of the composition lives in the core, not in `parse` or `render`.
- An adapter may contain argument or schema parsing, the one call, rendering, and for the tools the schema, the description and the receipt wrapper. It may not contain or import address or device resolution, transport or port construction, account or credential handling, or policy.

What CI can check of this and what it cannot is section 7.5.

The process-level tail of a few verbs stays in the CLI because it is not a capability: replacing the terminal process with the engine after `daemon adopt` or `remote attach`, re-executing under another runtime, reading a TTY. Everything up to that point, including the plan for what to launch, is SDK data.

## 4. The SDK

### 4.1 One root, and the entries that exist

```ts
import { createOmoSdk } from "omo-ai/sdk"

const omo = createOmoSdk()
const sent = await omo.threads.send({ thread: "studio/review", message: "status?" })
if (sent.kind === "error") console.error(sent.error.code, sent.error.next_action)
await omo.dispose()
```

The root is `createOmoSdk`, extended additively.

| Root option | Meaning |
|---|---|
| `api`, `accounts` | The account service origin and the sign-in page origin; else `OMO_SERVICE_API_URL` and `OMO_SERVICE_ACCOUNTS_URL`, else production |
| `env`, `cwd`, `home` | As today |
| `agentDir`, `uid`, `user` | The thread options, defaulting as the CLI defaults them today |
| `endpoint` | A selector for a non-default engine endpoint: `{ socket?, key_root? }`. Paths only. Its contract is part of the security design |
| `principal` | Section 4.3 |
| `ports` | Injected dependencies for tests: today's `session`, `credentialStore`, `deviceServiceStatus`, `signInProcess`, and the thread SDK's `host`, `store`, `remote`, `now`. An injected `ports.host` replaces the engine host port; it is a different thing from the `endpoint` selector |

Lifecycle: `close()` stays synchronous and does what it does today, aborting account and device requests in flight. `dispose()` is asynchronous: it calls `close()`, then closes the gateway store and the remote sessions. A caller that used a thread call awaits `dispose()`; a caller that used only account calls may keep calling `close()`.

Two shipped contracts and one in review are kept as **compatibility facades**: thin modules over the root that preserve their signature, results and lifecycle exactly, each pinned by its existing tests. They are projections, not second implementations.

| Facade | What it preserves | Projection onto the root |
|---|---|---|
| `createThreadSdk(options)` at `runtime/thread-sdk/sdk.js` | Every option of `T/sdk.ts:54-80`: `agentDir`, `cwd`, `uid`, `user`, `env` map to the root's options of the same name; `host`, `store`, `remote`, `now` map to `ports.*`; `provenanceWorkspaces`, `engineStatusAll`, `workerModuleUrl`, `firstPromptWaitMs` map to thread-namespace options of the same meaning. It also keeps `principal`; `dispose`; `release(thread, request)` and `warmDaemon()` answering the engine's own replies; `set_model`; `send({ text, mode })`; `self` answering `caller_context_missing`; `registerStoreExtension` and `extensionCall` with their `refused` branch | `text` to `message`, `mode` to `delivery`; snake_case method names to camelCase; `release` to `threads.release`; the extension pair to `threads.extensions.register` and `.call` |
| `createOmoSdk(options?)` at `OMO_SDK_ROOT` | Its four namespaces, their `value` results, synchronous `close()` | Identity: the root is this entry, extended |
| `openRemote(options?)` at `omo-ai/remote` (#14881, once it ships) | The remote client's member list and input types, the flat failure, the branded thread handle, `Opts.deadlineMs`, `REMOTE_CODES` | Each member to the root call section 6 names for it; the flat failure from the root's (4.4); the handle from the canonical address of section 5 |

Every input and result field of the facades has a root field it projects from. Section 6 carries them, so a facade never implements one independently. The facades are removed only by a later, announced release, after their callers have moved.

- Package name: `omo-ai/sdk`, added to the `exports` of `N/package.json`.
- Outside a session with a global install: `omo sdk root` prints the directory of the built entry (an adapter over `install.sdkRoot()`).
- Importing the entry has no side effect: no socket, no file, no process, no network. Each namespace loads its core on first use.

### 4.2 Namespaces

`threads`, `devices`, `account`, `deviceService`, `sync`, `config`, `daemon`, `diagnostics`, `install`, `engine`, `mcp`, `boulder`, `worktrees`, `toolkit`, plus `close()` and `dispose()`. Method names are camelCase.

The root's input types for the thread calls are the schemas in `T/contracts/params.ts` and `create-params.ts` themselves (field names, optionality, bounds and defaults). Where one tool schema serves several behaviours, the root has one call per behaviour and each takes the part of the schema that behaviour reads; section 7.2 compares per branch. Where the root adds an input a tool lacks, it extends that schema.

### 4.3 Authority

The SDK is a library in its caller's process. It is never the authority, and nothing in this program makes it one. A private export or an import rule is an architectural boundary; neither is evidence of authorization.

Authority is enforced where it is enforced today, in the core and behind it: the engine endpoint (socket credentials, `admitExternalMessage`, the sender kinds the gateway accepts), the device service and the relay (same-account admission, the sender kinds each transport accepts), and the account service (the signed-in device's session). The principal a root is built for selects which existing leg a call uses and what it stamps on what it sends. Availability of a method on the root is not permission to run it.

A pre-review inventory of the rules the source enforces today, which this program preserves without widening. The complete matrix is the security design's, not this table's:

| Rule | Enforced at |
|---|---|
| A script acts as itself, never as a session: `self` is `caller_context_missing`, and a thread it creates records no creator | `T/sdk.ts:142-146, 305-312` |
| The local delivery transport refuses a person's prompt | `T/gateway/local-transport.ts:12-20` |
| The relay transport refuses a command-line sender (`unsupported`, `sender_not_allowed`) | `T/remote/relay-transport.ts:899-907` |
| A parked session's intake accepts only an agent sender | `T/gateway/store-worker.ts:134-145` |
| A session or a connector may keep or narrow its own approval mode when it opens a thread, never widen it (`scope_denied`, `permission_preset_wider`) | `R/sessions.ts:556-570` |
| `author` on a send is accepted only from a connector | `R/sessions.ts:468` |
| The device-service mutators (`setEnabled`, `setControl`, `setWake`) are a person's; bootstrap is a person's or the service's | `R/client.ts:395-431` |
| A store extension's session-callable operation runs as the caller the engine resolved, never one named in its arguments | `T/gateway/store-extensions.ts:107-139` |
| The sync phrase is written to and read from the controlling terminal only, and an agent harness is refused before anything secret exists | `N/sync-phrase-tty.ts:10-16` |

Step 2 of the 2026-11-10 ruling on #13016 (both transports accepting both sender kinds) is not approved and stays out of scope.

**Gate before the contracts are fixed (slice S0, #14945).** The security design settles, for both editions and for every present caller and surface: the threat model; a principal-by-capability matrix with allow or refuse and the place that enforces it; the contract of the `endpoint` selector, the launch options, the extension session operations, attach and the answering of a dialog; trusted caller provenance; rollout and rollback criteria. Its approval is a recorded artifact, and its refusal rows are reused as acceptance scenarios by every slice they touch. No schema, export or adapter that carries a principal, a credential, an endpoint or a launch option is fixed before that approval (section 8).

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
    readonly uncertain?: boolean     // carried exactly as the remote module gives it: true, false or absent
    readonly command_id?: string     // the relay's id for a command that left this device
    readonly partial?: unknown       // what was done before the failure
  }
}
```

- On the root, the error branch has one shape in every namespace. It is the shape the thread tools and the omo SDK already share, with the remote module's three extra fields carried as optional first-class fields with their types and values unchanged (`R/types.ts:55-64`), not folded into `details`. The conversion to and from the remote module's flat failure is therefore lossless and cannot collide with a key an existing `details` object uses.
- `OmoCode` is one registry: the union of `THREAD_ERROR_CODES`, the omo SDK's codes and `REMOTE_CODES`, one meaning per name. `not_implemented` is reserved for a call whose slice has not landed; it is never a valid outcome of a row counted as built (7.2). A code a shipped call returns today is registered, with a scenario, even when a later slice removes it: it is marked with that slice and a test fails if it is still reachable afterwards. A code is held, outside the registry with its reason, only when no shipped call can produce it.
- The ok branch on the root has two shapes, both already shipped: `threads.*` answers the thread contract (`{ kind: "ok", thread, delivery, ... }`, `T/contracts/results.ts`), and every other namespace answers `{ kind: "ok", value }`. The thread contract is persisted in receipts, replayed and printed by `omo thread --json`, so it does not move. **The delivery result type does not move**: #14941 and the replay fix for a repeated idempotency key build on the present shape. This is a real cost to a generic caller, and the document does not claim one universal result. Calls that answer an engine reply today (`threads.release`, `daemon.warm`) keep that reply as their `value`.
- Exit codes are a projection keyed by surface, not one table. Today `internal_error` exits 5 from `omo thread` (`N/bin/lib/thread.js:126-132`) and 1 from `omo remote` (`R/codes.ts:195-213`), and `omo account` and `omo daemon` have their own maps (`N/account-show.ts:24-36`, `N/bin/lib/daemon-args.js:7-13`). Each descriptor's `render.exit` names its surface's map; tests pin both the JSON and the exit outcome of every existing verb before any alias is removed or any wait default changes.
- Streams (`threads.follow`, `threads.sendAndFollow`, `threads.attach().events`, `engine.launch.print`) are `AsyncIterable` with a `stop()`. A stream ends with one terminal event that carries either the outcome or a failure; it never throws from `next()`, and `stop()` ends it with a terminal `cancelled` outcome.
- Every call that can wait takes `{ signal?, deadline_ms? }`. A call can wait when it waits on a host, the relay, the account service, a process or the clock; a call that returns at once (`install.version`, `install.sdkRoot`, `toolkit.help`) takes no options, and the root's type has them only where the registry marks the call as waiting. The type must not promise what a core ignores: per waiting call the registry records whether its core honours `signal` and `deadline_ms` today (the remote module's members and `deviceService.status` do), and where it does not, that is an entry of the baseline, cleared by the slice that wires it with a cancellation scenario and a deadline scenario. A call whose input already names `deadline_ms` takes only `signal` as an option.
- Bytes are `Uint8Array` on the root, as the remote module's attachment has them (`R/types.ts:114-116`), and never a text form: no caller uses one today. The scenario table, which is JSON, names bytes by a fixture reference with its length and digest; that reference is a table encoding and not an input form of the SDK. A call that left this device and got no answer inside its budget answers `delivered_unconfirmed` or `idempotency_uncertain` as it does today, never a generic timeout, and a timeout or an authorization refusal never triggers a second write. A retried create under the original idempotency key returns the original thread, with the original caller identity, and no duplicate (#14560, #14569).
- An `idempotency_key` on a control call means on the root what it means on the tool: a repeat under the same key answers the stored result and does not repeat the side effect. Accepting the field without honouring it does not count.

### 4.5 Credentials and custody

Eight groups of calls touch a credential or a secret a person must hold:

| Group | Today |
|---|---|
| The omo account's access token and stored credential | `omo account token` and `omo account export` print them with structured metadata (expiry, device, owner) for our own processes (`N/account-cli.ts:118-146`) |
| A sign-in handed over by the desktop app | `omo account adopt` reads a credential |
| The device-code sign-in | `omo account sign-in` emits JSON events: `code` (verification URL, user code, matching code, expiry), then `signed_in` (api, device, replaced device, device-service outcome) or `refused`; `--check` is a separate no-op that answers `ready` (`N/account-sign-in.ts:37-59, 173-232`). `omo login` prints the same codes as lines for a person |
| The sync recovery phrase | Shown and typed on the controlling terminal only, after an eligibility check that runs before any phrase exists (`N/sync-phrase-tty.ts:10-16`, `N/sync-cli.ts:76-113`) |
| Model provider credentials | `omo auth check [--credentials]`, `omo auth print-api-key`, `omo auth print-bearer-token` (`E/cli/auth-command.ts:19-21`) and the launch input `--api-key` |
| MCP OAuth tokens | The OpenCode edition's `mcp oauth login|logout|status` (`C/mcp-oauth/index.ts`) |
| This device's keyring | The OpenCode edition's `account keys init|status`, which print the device id and public keys (`C/account-keys/commands.ts`) |
| The engine endpoint's own credentials | `--rpc-key-root`, a terminal endpoint's socket secret |

The superset rule requires an SDK call for each. The rule of this document is that **no secret is a field of a result, a failure, a stream event, a receipt or a log line**.

How each secret may move is not decided here. A caller-defined callback or sink proves nothing about who is entitled to the value, and this document claims no approval for any such carrier. **Slice S0 settles the custody contract before any of these calls, or the schema of any of them, is fixed.** Its draft takes the narrower rule the source already has for the phrase: the destination of a secret is fixed by the core (the controlling terminal for the phrase), or is a handle the caller already holds. Until S0 is approved the registry rows of these calls stay recorded defects, their input columns in section 6 name the non-secret inputs only, and the memory-sync lane's pull requests that touch recovery (#14464, #14891) carry `sync.recover` over their one recovery engine on the contract S0 approves; this program writes no second recovery implementation.

Error messages are the core's own words. An exception from a lower layer is mapped to a code; its text is not appended (the thread SDK's `thrown` appends it today, `T/sdk.ts:178-203`).

No result type on the root has a field whose purpose is to hold a credential or a transport setting: a header map, an API key, a token, a base URL, an environment map. `engine.models.list` therefore answers a listing whose entries are a projection of the model without its headers and its base URL; the command prints neither, so its output is unchanged. A string a user supplied, such as a package source or a resource path, can embed a credential and cannot be typed away: every such result field is listed in one exported table, and the root reads that table for the security design's rule that a session's read of those calls waits on a canary scan of their output.

### 4.6 Ports

Every external dependency is behind a port that a test replaces: the engine host socket, the gateway store, the device-service connection, the account session and credential store, the phrase terminal, the child process, the file system roots, and the clock. Timeouts, TTLs, the close ladder's waits and the device-code polling read the clock port, so their tests run on a virtual clock and inject one fault at a time (a lost reply, a store lock timeout, a 401) without waiting or breaking a real service. No test in this program sleeps for wall time except where time itself is the behaviour.

The per-caller telemetry consent contract for engine open, attach and live updates (the engine's #7446) is an engine-owned dependency with its own milestone in section 8: the effective policy is decided in one core, and no adapter or resolver carries a copy of it.

## 5. One resolution contract

A thread is named by one string, `thread`, and every surface accepts exactly the strings every other surface prints (#14044).

Grammar: `self`, a bare address, or `<device>/<thread>`. `parseAddress` takes the string alone and excludes path-like text (`packages/thread-address-core/src/parse.ts:26-59`), so not every string with a slash is a device address. The thread part resolves as durable id, session key, account alias, exact name in scope, then a unique id prefix; the scope and prefix controls are the ladder's options (`ladder.ts:10-73`, options at `:24-27, 66-73`). The device part resolves as device id, `here`, device name, then a unique id prefix, with typed refusals for a shared name or prefix (`device.ts:24-76`).

The contract, one function that every entry goes through:

```ts
resolve(address, {
  operation,        // deliver | control | read | attach | open_existing | fork_source | locate
  principal, scope: { all_scope?, workspace? },
  need,             // online | any; whether an incomplete listing is a refusal or a warning
  match,            // exact | fuzzy            (fuzzy only for handoff)
  reply,            // the delivery being answered, when the send is a reply
  id_prefix,        // true | false | { exclude: caller }
  unique_holder,    // a bare address must have exactly one holder on the account
  probe })          // confirm the holder is reachable before answering
  -> { kind: "ok", thread, device, holder, leg, all_scope }   // thread: the canonical string every surface takes back
   | OmoFailure                                                // not_found, ambiguous_target, scope_denied, device_offline, ...
```

The policy that today lives in the tools' delivery locator (`T/tools.ts:583-678`) is the contract's, owned by the core, with its present results:

| Policy | Rule |
|---|---|
| Exact and fuzzy | `match: "fuzzy"` ranks partial names and workspace basenames and answers the leader only at the accept floor and margin the thread contract documents; every other operation is exact |
| A reply | A send approved as a reply resolves only to the sender of the delivery it answers: by that sender's exact id or stated name, never by an id prefix; on this device among this device's entries; on another device pinned to that device. A hit that is not that sender is refused by name without sending |
| The reply grant | A reply to a sender on this device in another workspace is answered without `all_scope`; only a scope refusal is widened, and the widened hit must still be that sender |
| A sender this device does not hold | Looked up account-wide by exact id or name with `unique_holder`; a copy of the id on a second device makes it ambiguous |
| A renamed sender | A stated name nobody carries any more is answered through the sender's recorded id |
| The caller | A send never targets its own caller by an id prefix; `self` resolves only for a session principal and is `caller_context_missing` for every other |
| Scope | `all_scope` widens this device's workspace scope only |
| Text with a slash | Two readings, as the resolver has them today (`T/address/resolve.ts:181-244`). The device reading is taken only when the first part names a device on the roster. When it names no device, or the device does not hold the thread part, the whole text is resolved as a bare address, because a thread name may contain a slash, and the device's refusal answers only when that also misses. An id-shaped thread part is the named device's to answer, with no whole-text reading. When the device holds the thread part and this device's book also holds a different thread literally named by the whole text, the answer is `ambiguous_target` with both |
| One holder | `unique_holder` is an input a few operations set, not a property of every call: with it, a bare address that resolves is also checked for a second holder on the account, and a second holder is `ambiguous_target` (`T/address/resolve.ts:198-204`). Without it the ladder's order decides, as today. The operations that set it are the ones that set it today: the reply to a sender this device does not hold, and the typed address of the `omo remote` aliases |

Caller-specific defaults are inputs each caller's SDK operation sets, not branches inside adapters: `threads.send` from a session sets `id_prefix: { exclude: caller }` and passes `reply` when the engine's reply allowance approved the send; from a script it sets neither. These defaults are rows of the security design's matrix and scenarios of the conformance test.

Every entry that resolves today enters this function and loses its own ladder:

| Entry today | After |
|---|---|
| The tools' delivery locator (`T/tools.ts:583-678`) and `locateControl` | They call `resolve` with `deliver` and `control`; the policy above moves into it |
| Thread SDK `send`'s own target construction (`T/sdk.ts:351-402`) | `resolve` with `deliver` |
| Thread SDK `locate` (`T/sdk.ts:404-447`) | `resolve` with `locate` |
| `createThread`'s existing-thread and fork-source lookup (`T/control/create.ts:134-153, 477-495`) | `resolve` with `open_existing`, `fork_source` |
| Remote module `sessions.resolve` (`R/resolve.ts:241-291`) and the handle canonicalization in `sessions.ts` and `attach.ts` | The account-side lookup becomes a port under `resolve` and keeps its cached index and incomplete-listing semantics as inputs; the facade's `sessions.resolve` and `aliases.resolve` call `resolve` and keep their result contract (the session row) |
| CLI `resolveTypedAddress` (`R/device-address.ts`) | Removed; the CLI passes the typed string to the SDK |

What follows from one contract:

- A thread opened over the relay is not special: `threads.create({ device })` answers a `thread` value, and every other call takes it back unchanged from the SDK, the tools and the CLI, on the device that opened it and on any other signed-in device.
- The device is an optional part of the address. On the caller's own device every verb works, not only open (#14931). The person client is given this device's operator endpoint leg lazily, from the remote module's `admin.ts` entry (#14890).
- A stale route is recovered inside the core, once, by locating the live owner read-only and sending to the resolved key, with separate sender identities and with no second write after a timeout or an authorization refusal. That behaviour comes from #14937, which is held for its SDK-first fix; no adapter re-implements it.

Tests, each as a matched pair for a target on this device and on another, for each principal that may run the operation: ambiguity (bare and holder-qualified), an inactive and an ended session, a stale listing, an alias, `here`, workspace scope with and without `all_scope`, every row of the policy table, and a relay-opened handle taken through every verb and back. A context-dependent operation asserts its expected refusal for the principals that lack the context; a deliberate principal difference is an expected outcome, not a failure.

## 6. Parity table

Direction: **SDK ⊇ CLI and SDK ⊇ tools.** Every row is a leaf capability with its inputs and has an SDK call.

- **SDK today**: **yes** (the root or a facade answers it, with these inputs honoured, at the pinned commit), **partial** (one of the entries answers part of it; the gap is named), **no** (a defect under the rule).
- **Adapter**: for a CLI or tool cell that is empty, either **planned** with the slice that adds it, or **omitted** with the reason it is intentionally narrower. "Not built yet" is never a reason.
- **Slice**: the slice of section 8 that builds the row's SDK call. Every row that counts toward closure has one. A `reserved` name (6.7) is not such a row.

### 6.1 Threads: reading

| Capability and SDK inputs | CLI today | Tool | SDK today | Adapter | Slice |
|---|---|---|---|---|---|
| `threads.list({ all_scope?, workspace?, state?, device?, project?, name?, archived?, idempotency_key? })` | `omo thread list [--all-scope] [--state ...]` (repeatable or comma-separated); `omo remote sessions [--device] [--project] [--state running\|idle\|ended]`; `omo host session list` | `thread_list { all_scope?, state?, idempotency_key? }` | partial: no `workspace`, `device`, `project`, `name`, `archived` in the thread SDK (remote module has them, `R/types.ts:68, 233-239`) | Tool omits the five filters: rows carry `device`, `cwd`, `name` and status, and the listing is one bounded payload the model filters | T1b |
| `threads.resolve({ address, all_scope?, workspace? })` answering the session row | none (implicit in every verb) | none | partial: remote module `sessions.resolve` | Tool and CLI omitted: resolution is part of each verb; kept because the remote facade has it | T1a |
| `threads.read({ thread, cursor?, max_bytes?, all_scope?, idempotency_key?, limit? })`: the bounded transcript projection | `omo thread read <t> [--all-scope] [--limit] [--max-bytes] [--cursor]` | `thread_read` (plain branch) | partial: no `idempotency_key`; `--limit` is sliced in the CLI (`N/bin/lib/thread.js:92-95`) | None | T1b |
| `threads.readAfterWait({ thread, wait_ms, cursor?, max_bytes?, all_scope?, idempotency_key? })`: wait for the turn to end, then read, with the `wait` block | none | `thread_read { wait_ms }` (wait branch) | **no** | CLI planned (T3): `omo thread read --wait-ms` | T1b |
| `threads.receipt({ thread, delivery_id, all_scope? })`: the outcome of the caller's own delivery to that exact thread; reads no conversation, sends nothing, wakes nothing, and runs before read admission | none | `thread_read { thread, delivery_id }` (receipt branch) | **no** | CLI planned (T3): `omo thread receipt` | T1b |
| `threads.entries({ thread, since?, before?, tail?, limit?, max_bytes? })`: raw session entries by entry id. `since` is an entry id, not the read cursor | `omo host session read <ref> [--tail N] [--since <entryId>]` | none | partial: remote module `sessions.read(thread, { before, tail })` | Tool omitted: raw entries are unbounded engine records; the tool's read is the budgeted, model-shaped projection. CLI planned (T3) | T1b |
| `threads.messages({ thread })`: the engine's message list | `omo host session read <ref> --messages` | none | **no** | Tool omitted: same reason. CLI planned (T3) | T1b |
| `threads.get({ thread })`: model, reasoning, approval mode, turn, pending dialogs and queue | `omo host session state <ref>` | none | partial: remote module `sessions.get` | Tool planned (T2): the `thread_list` row gains `reasoning` and `pending`, which it lacks today (`T/contracts/results.ts:89-107`); until then the tool surface is narrower and the conformance test does not claim three-way equality for this row. CLI planned (T3): `omo thread state` | T1b |
| `threads.wait({ thread, from?, until?, deadline_ms? })`; `from` is a send's receipt and anchors the wait on the turn that answers it | `omo host session wait <ref> [--until idle\|done] [--timeout]` | none (the wait branch of `thread_read` is its own row) | partial: remote module `sessions.wait`; the local wait is inside the tool body | CLI planned (T3): `omo thread wait` | T1b |
| `threads.follow({ thread, from? })`: status changes, turn ends and the turn's stream | none by itself | none | partial: remote module `sessions.follow` | Tool omitted: a tool result is one bounded payload and nothing streams into a model call. CLI planned (T3): `omo thread follow` | T1c |
| `threads.locate({ thread, all_scope? })` | none | none | yes | Tool and CLI omitted: resolution is internal to every verb, and the holder is on the list row | shipped |

The `state` filter, as a fixed table. The thread vocabulary is `opening`, `running`, `idle`, `inactive`, `archived` (`T/contracts/params.ts:20-44`); the remote vocabulary is `running`, `idle`, `ended` with a separate `archived` flag on each row (`R/types.ts:87-104`).

| Filter value | Rows on this device it keeps | Rows on other devices it keeps |
|---|---|---|
| `opening` | Rows a local engine handoff lists as opening | None: the remote row has no such state |
| `running` | Running | State `running`, not archived |
| `idle` | Idle | State `idle`, not archived |
| `inactive` | No engine holds it, not archived | State `ended`, not archived |
| `archived` | Archived | `archived: true`, whatever the state |
| none given | Every state but `archived` | Every row with `archived: false` |
| several | The union | The union |

`ended` is not a root input. It is the alias `omo remote sessions --state ended`, which its descriptor maps to `state: ["inactive"]` with `device` scoped to other devices; the alias's rows keep their present shape, `state: "ended"` included, through its render projection. Before the alias converges, a golden test pins its present output; where this table and that output differ, the alias keeps its output and the table is corrected.

### 6.2 Threads: writing and control

| Capability and SDK inputs | CLI today | Tool | SDK today | Adapter | Slice |
|---|---|---|---|---|---|
| `threads.send({ thread, message, delivery?, expected_turn_id?, summary?, idempotency_key?, collapse_key?, all_scope?, attachments?, author? })`. `author` only from a connector | `omo thread send <t> <text> [--all-scope] [--mode] [--expected-turn] [--idempotency-key] [--collapse-key]`; `omo remote send <s> <text> [--steer\|--follow-up] --no-wait`; `omo host session prompt\|steer <ref> <text\|@file>` | `thread_send` (all fields but `attachments`, `author`) | partial: own target construction (#13016); `summary` and attachments only in the remote module; the facade's names are `text`, `mode` | Tool omits `attachments` and `author`: a session's message is text plus its provenance header, and `author` is a connector's identity field | T1a (locator), T1b (inputs) |
| `threads.sendAndFollow({ ...send inputs, deadline_ms? })`: one operation that sends and streams the answer, the receipt first | `omo remote send <s> <text> [--steer\|--follow-up] [--timeout]` (its default) | none | partial: remote module `sessions.send` then `follow` with the promised receipt (`R/follow.ts`) | Tool omitted: nothing streams into a model call; an agent sends, then reads after a wait | T1c |
| `threads.create({ thread?, device?, alias?, name?, cwd?, worktree?: { branch?, base? }, fork_from?, skills?, model?, reasoning?, permission_preset?, prompt?, delivery?, idempotency_key?, launch_spec? })`. `prompt` is a string, or `{ message, delivery?, expected_turn_id?, summary?, attachments?, author? }` (the remote module's `first`). `thread` (open an existing thread on whichever device holds it, optionally with `prompt`) never with `device`; `fork_from` on a host open is refused `unsupported` (`fork_unsupported`) until the engine forks on open (a terminal process forks through `engine.launch`, 6.9); a wider `permission_preset` is `scope_denied` | `omo remote open <device> [--project] [--model] [--thinking] [--permission-preset] [--worktree [--branch] [--base]] [--prompt [--steer\|--follow-up]]`; `omo host session open --cwd [--model] [--name] [--prompt] [--launch-spec]` | `thread_create` (all fields but `launch_spec` and the object form of `prompt`) | partial: the thread SDK creates; `omo remote open` skips the create orchestration (#13016 OMO-CTL-26); no `launch_spec`, no prompt metadata | Tool omits `launch_spec` (which launch spec a host starts from is the installation's choice) and the prompt's attachments and author (as for send). CLI planned (T3): `omo thread create`, with `--thinking` kept as the spelling of `reasoning` | T1b |
| `threads.interrupt({ thread, turn_id?, all_scope?, idempotency_key? })` | `omo remote interrupt <s>`; `omo host session abort <ref>` | `thread_interrupt` | partial: the key is accepted and not honoured outside the tool's receipt | CLI planned (T3): `omo thread interrupt` | T1b |
| `threads.close({ thread?, force?, graceful?, wait_ms?, idempotency_key?, all_scope? })`. `thread` omitted or `self` means the calling session and is `caller_context_missing` for any other principal | `omo thread close <t> [--all-scope] [--force \| --graceful [--wait-ms]] [--idempotency-key]`; `omo remote close <s> [--force] [--graceful] [--wait-ms]`; `omo host session close <ref>` | `thread_close` | partial: the key is accepted and not honoured (`T/sdk.ts:488-495`) | None | T1b |
| `threads.unload({ thread, interrupt?, force?, clear_queue?, children?: "refuse" \| "detach" })`: takes the session out of its host and keeps it resumable. It is not a close | `omo host session unload <ref> [--interrupt] [--force] [--clear-queue] [--children refuse\|detach]` | none | **no** | Tool omitted: an agent ends a peer through the close ladder, which chooses the step and reports what it dropped; choosing the raw step lets a session detach another session's children, which no ruling grants. CLI planned (T3) | T1b |
| `threads.release({ thread, interrupt?, force?, move?: { id, target } })`, answering the engine's release reply (session path, attachments, what was dropped) | part of `omo daemon adopt` | none | yes on the facade (`release(located, request)`, `T/sdk.ts:153-156, 508-517`) | Tool omitted: it takes a session away from its host. CLI: reached through adopt | T1c |
| `threads.adopt({ thread, interrupt?, force? })`: one operation that releases and answers the launch plan: session path, working directory, and the queued prompts to replay in order | `omo daemon adopt <s> [--interrupt] [--force] [--json]` | none | partial: `locate` and `release`; the launch plan is built in the CLI (`N/bin/lib/daemon-adopt.js:118-155`) | Tool omitted: it ends in replacing a terminal process. That replacement stays in the CLI; the plan is SDK data | T1c |
| `threads.setModel({ thread, model, provider?, idempotency_key?, all_scope? })` | `omo remote model <s> <provider/id>`; `omo host session model <ref> <provider/id>` | `thread_set_model` | partial: `set_model` on the facade; the key is accepted and not honoured (`T/sdk.ts:501-506`) | CLI planned (T3): `omo thread model` | T1b |
| `threads.setReasoning({ thread, level, scope?, idempotency_key?, all_scope? })` | none | `thread_set_reasoning` | **no** in the thread SDK; remote module only | CLI planned (T3): `omo thread reasoning` | T1b |
| `threads.rename({ thread?, name?, alias?, idempotency_key?, all_scope? })`, `thread` optional as for close | none | `thread_rename` | yes | CLI planned (T3): `omo thread rename` | shipped; key semantics T1b |
| `threads.aliases.resolve({ alias })`, `.set({ thread?, alias })` with `thread` optional as for close, because the tool lets a session omit it, `.clear({ thread })` | none | `thread_rename { alias }`, `thread_create { alias }` | partial: remote module `aliases.*` | CLI planned (T3) through `omo thread rename --alias`. Tool omits a bare `resolve`: every tool input already takes an alias | T1c |
| `threads.archive({ thread, archived?, idempotency_key?, all_scope? })` | none | `thread_archive` | **no** in the thread SDK; remote module only | CLI planned (T3): `omo thread archive` | T1b |
| `threads.handoff({ thread, match?, message, delivery?, expected_turn_id?, summary?, idempotency_key?, all_scope? })` | none | `thread_handoff` | **no** | CLI planned (T3): `omo thread handoff`, exact unless `--match fuzzy` | T1c |
| `threads.attach({ thread })` answering `{ snapshot, events, read, pending, answer, command, serveEndpoint, detach }`; the served endpoint closes when the attach ends, including when the connection drops | `omo remote attach <s>` (TUI); `omo remote answer` arrives with #14890 | none | partial: remote module `attach` | Tool omitted: answering another session's approval dialog is an authority decision, and no ruling gives a session that authority over a peer | T1c, after S0 |
| `threads.extensions.register({ name, migrations, moduleUrl, sessionCallable?, wakeDir? })` answering `{ version }`; `.call({ name, op, args })` | none | none | yes on the facade (`T/gateway/store-extensions.ts:42-49`) | CLI and tool omitted: a connector registers its extension from its own process | shipped; root wiring P1b |
| `threads.extensions.sessionOps()` listing the declared session operations with their input schemas; `.sessionCall({ name, op, args })`, which runs the operation as the root's session principal, the caller the engine resolved, and then its declared await. Refused for every other principal | none | `ext_<extension>_<tool>`, one per declared operation, registered at session start | **no**: the session channel is reachable only from the session's own extension tools today (`T/gateway/store-extensions.ts:107-139`) | CLI omitted: a session operation has no caller outside a session | T1e, after S0 |

### 6.3 Devices

| Capability and SDK inputs | CLI today | Tool | SDK today | Adapter | Slice |
|---|---|---|---|---|---|
| `devices.list()` | `omo remote devices`; `omo account devices` | `thread_list` (its `devices` block) | yes; one listing after #14881 | None | shipped |
| `devices.resolve({ device })` | implicit in every `<device>/...` | none | partial: remote module | Tool and CLI omitted: resolution is part of each verb | T1a |
| `devices.rename({ id, name })`, the name bounded as the sign-in bounds it (#14523) | none | none | yes | CLI planned (A1c): `omo account devices rename`. Tool omitted: an account-level change a person makes | A1c |
| `devices.revoke({ device, confirm_name })`: by id, name or unique prefix; an ambiguity revokes nothing; never this device | `omo account devices revoke <id>` | none | **no** (#14364 keeps it as its last step) | Tool omitted: it destroys a sign-in and is the person's decision | A1c |

`devices.enroll` (#14365) is outside this program; the name is reserved.

### 6.4 Account

Both editions register `login`, `logout` and `whoami` over the same core (`C/cli-program.ts:236-238`, `C/service-auth/commands.ts:234-315`), each with its own hooks. Each edition has its own descriptor rows over the calls below and keeps its present admission, help and refusal outcomes, including the hidden routes that exist while accounts are closed.

| Capability and SDK inputs | CLI today | Tool | SDK today | Adapter | Slice |
|---|---|---|---|---|---|
| `account.whoami()`, `account.show({ account? })` | `omo whoami [--api]`; `omo account show [--account]` | none | partial: `whoami` | Tool omitted: a session reads it from the SDK in an eval cell | A1b |
| `account.signIn({ method: "device_code" \| "browser", open_browser?, onUserCode, onOpenUrl?, deviceName?, replace?, signal? })`. The codes go to `onUserCode` in a `code` event; the result is the `signed_in` content (api, device, replaced device, device-service outcome) or a typed refusal. `method: "browser"` is the callback flow of `omo login`; `open_browser: false` is `--no-browser`. While accounts are closed only `device_code` is admitted and every other combination is the refusal the CLI gives today. Two CLI projections of the one call: `omo login` renders the `code` event as its three lines; `omo account sign-in` renders each event as one JSON line | `omo login [--device] [--no-browser] [--replace] [--api] [--accounts]`; `omo account sign-in [--stdin]` | none | partial: device code only, and it runs the CLI as a child (`S/account/sign-in-process.ts`) | Tool omitted: a sign-in needs a person at a browser. The SDK stops running the CLI; the CLI calls the SDK | A1b, after S0 |
| `account.signInCheck()` answering `{ ready: true }`: a probe that the sign-in call exists; it touches nothing | `omo account sign-in --check` | none | **no** | Tool omitted: a driver's probe | A1b |
| `account.signOut()`, `account.forget({ device? })` (this device only; another device is `devices.revoke`) | `omo logout [--api]`; `omo account forget [--device <id>]` | none | **no** | Tool omitted: ends the session's own sign-in | A1b |
| `account.adopt({ replace? })`, the credential an input whose carrier S0 fixes, with the keep-current and replace rules of today | `omo account adopt [--replace]` | none | **no**; custody (S0) | Tool omitted: a hand-over between our own processes | A1d |
| `account.credentials.handOver({ what: "access_token" \| "stored_credential" })`, the destination fixed by S0, returning the non-secret metadata the verbs print today (expiry, device, owner) | `omo account token`; `omo account export` | none | **no**; custody (S0) | Tool omitted: section 4.5 | A1d |
| `account.store.status()`, `.enable()`, `.disable({ discard? })` | `omo account store status\|enable\|disable [--discard]` | none | **no** | Tool omitted: changes where credentials live on the machine | A1b |
| `account.keys.init()`, `.status()`: this device's keyring, answering the device id and the public signing and sealing keys only, with the typed refusal for a missing key | OpenCode edition: `account keys init`; `account keys status` | none | **no**; custody (S0) | Tool omitted: creates key material | OC1c |

### 6.5 Device service (remote switches)

| Capability and SDK inputs | CLI today | Tool | SDK today | Adapter | Slice |
|---|---|---|---|---|---|
| `deviceService.status()` with the local service units; `deviceService.info()` | `omo remote status` | none | partial: the omo SDK's narrower status; remote module `service.status`, `service.info` | Tool omitted: `thread_list` already answers `remote_unavailable` with the reason an agent can act on | A2a |
| `deviceService.enable()`, `.disable()`, with the opt-out record and the cold-wake steps the CLI runs around them today, as one operation each | `omo remote enable`; `omo remote disable` | none | partial: remote module `service.setEnabled`, `admin.ts` | Tool omitted: these switches decide what other devices may do on this machine; that consent is the person's | A2a |
| `deviceService.control()`, `.setControl(on)` | `omo remote control [on\|off]` | none | partial: remote module | Same reason | A2a |
| `deviceService.wake()`, `.setWake(on \| null)`, person only | `omo remote wake [on\|off\|default]` | none | partial: remote module | Same reason | A2a |
| `deviceService.bootstrap({ account?, install?, adopt? })` (`R/types.ts:218-222`) | `omo remote bootstrap` | none | partial: remote module, `admin.ts` | Tool omitted: it downloads and installs a service | A2a |

### 6.6 Sync

| Capability and SDK inputs | CLI today | Tool | SDK today | Adapter | Slice |
|---|---|---|---|---|---|
| `sync.enable({ onCode, confirm, signal? })`, eligibility checked before a phrase exists; the phrase's surface is fixed by S0 | `omo sync enable` | none | **no**; custody (S0) | Tool omitted: the ceremony has a person compare codes on two screens and keep a phrase | A2b |
| `sync.disable()` | `omo sync disable` | none | **no** | Tool omitted: a person's choice about this device's memory | A2b |
| `sync.status()` | `omo sync status [--json]` | none | **no** | Tool omitted: read from the SDK in an eval cell | A2b |
| `sync.approve({ id?, confirmCode })` | `omo sync approve [id]` | none | **no** | Tool omitted: the approval is the comparison a person makes | A2b |
| `sync.recover({ confirm, signal? })`, over the one recovery engine of #14464; the phrase's surface is fixed by S0 | `omo sync recover` | none | **no**; custody (S0); built in the memory-sync lane's pull requests | Tool omitted: takes the recovery phrase | A2c |
| `sync.retirePin({ account })` | `omo account retire-sync --account <id>` | none | **no** | Tool omitted: called by the desktop app when it discards its own sealed session | A2b |

### 6.7 Config, daemon and hosts, diagnostics, install

| Capability and SDK inputs | CLI today | Tool | SDK today | Adapter | Slice |
|---|---|---|---|---|---|
| `config.status()` | `omo doctor` (its `WARN config:` lines) | none | yes | CLI planned only if #14366 asks for a verb | shipped |
| `config.explain`, `.check`, `.edit`, `.revert`, `.modelSwaps`: **reserved names, not a parity row**. No CLI verb and no tool has them today, so nothing here is a gap and the zero-gap gate does not count them. The registry lists them as `reserved`; when #14366 adds a surface for any of them, rule 5 applies to that pull request | none | none | no | Not applicable | reserved (#14366, outside this program) |
| `daemon.run({ policy?, pinned? })`: one operation that ensures the operator daemon and then warms it; a refused or failed warm is reported in the value and the run still succeeds, as today | `omo daemon run [--no-upgrade] [--pinned] [--json]` | none | partial: `warmDaemon` only | Tool omitted: host lifecycle of the machine the calling session runs on; a session that stops or hands over its own host ends its own call | C1a |
| `daemon.ensure({ policy?, pinned?, launch_spec?, mcp_presenter_enforcement? })`, the endpoint from the root's `endpoint`; `daemon.warm({ cwd?, kind?, context? })` | `omo host ensure [--launch-spec] [--policy upgrade\|fallback\|never] [--socket] [--rpc-key-root] [--mcp-presenter-enforcement]` | none | partial: `warmDaemon` | Same reason | C1a, after S0 |
| `engine.trust.ensure({ wait?, lease_pid? })` answering the JSON record the command prints: it imports the engine's trust material within the launch budget, writes the private generation and leases it, for the caller or for another process | `omo trust ensure --json [--wait] [--lease-pid <pid>]` (`N/trust-stage.ts:68-91`, `N/compile-args.ts:41-42`) | none | **no** | Tool omitted: a host integration's call that writes the trust store | C1a, after S0 |
| `daemon.status({ all?, include_workers? })`, each terminal row with its last activity | `omo daemon status [--include-workers]`; `omo host status [--all] [--include-workers] [--socket]` | none | **no** | Tool omitted: `thread_list` answers the session-level question; endpoint internals stay out of model-facing output (#14044) | C1a |
| `daemon.stop({ drain?, instance?, wait_ms?, force?, expected_generation? })` | `omo daemon stop [--drain]`; `omo host stop [--drain [--instance] [--wait-ms]] [--force] [--expected-generation] [--socket]` | none | **no** | Same reason as run | C1a |
| `daemon.stopAll({ drain?, wait?, deadline_ms? })` | `omo daemon stop --all [--drain] [--wait [--timeout]]` | none | **no** | Same reason | C1a |
| `daemon.handoff({ policy?, launch_spec?, allow_downgrade?, when?: { idle: { operation, if_instance, if_generation, target_build } } })`. `policy` is `upgrade`, `fallback` or `never`; omo's verb takes it from the config's `task.host_engine_policy`, and `--no-upgrade` is `never` (`N/bin/lib/daemon.js:61-66, 236-246`) | `omo daemon handoff [--no-upgrade]`; `omo host handoff [--launch-spec] [--policy] [--socket] [--allow-downgrade] [--when idle --operation --if-instance --if-generation --target-build]` | none | **no** | Same reason | C1a |
| `daemon.gc({ prune_store_index?, agent_dir? })` | `omo daemon gc [--prune-store-index]`; `omo host gc [--agent-dir]` | none | **no** | Same reason | C1a |
| `daemon.rollbackPrepare({ stores?, allow_missing_index?, dry_run? })` | `omo daemon rollback-prepare [--store <dir>]... [--allow-missing-index] [--dry-run]` | none | **no** | Same reason | C1a |
| `daemon.shardPath({ kind, owner, root? })` | `omo host shard-path --kind p\|i --owner <id> [--root]` | none | **no** | Tool omitted: an endpoint internal | C1a |
| `diagnostics.run({ status?, verbose?, platform? })` answering findings as data; `.models()`; `.fixReflectionLock({ dry_run? })`; `.reapStaleEngines({ pids })` | `omo doctor`; `--models`; `--fix [--dry-run]`; `--reap`. OpenCode edition: `doctor [--status] [--verbose] [--json] [--platform]`, keeping its platform selection and its output-mode precedence | none | **no** | Tool omitted: it reads and repairs the installation under the running session; `reapStaleEngines` ends processes and takes explicit pids only | C1b; OC1a |
| `install.setup.detect()`, `.plan()` (what `--dry-run` prints), `.apply(plan, { consent: "all" \| "each" })`: `--yes` and the command with neither flag are both `all`, the second with the adapter rendering one confirmation whose refusal makes no call (`N/bin/lib/setup-import.js:72-96`); `--ask-each` is `each` | `omo setup [--yes] [--ask-each] [--dry-run]` | none | **no** | Tool omitted: plan, consent, write is a person's flow | C1c |
| `install.update({ dry_run? })`. Flags it does not know are a usage refusal today (`--all`, `--force` alone), and stay one | `omo update [--dry-run \| --print] [--self]`, and the `self`, `senpi`, `omo` targets (`N/bin/lib/update-args.js:23-52`) | none | **no** | Tool omitted: replaces the binary the session runs on | C1c |
| `install.version()`, `install.sdkRoot()` | `omo --version`, `-v`; `omo sdk root` (new) | none | **no** | Tool omitted: `OMO_SDK_ROOT` is already in a session's environment | C1c |

### 6.8 Engine commands forwarded by the launcher

The launcher forwards these to the pinned engine unchanged. Their core is the engine's. Under the rule each still needs an SDK call. The engine exports a typed function per leaf operation, with no process exit and no printing, and its own CLI calls the same function; the omo SDK re-exports it. The SDK does not start the engine CLI as a child for them. An exported function takes no principal: the principal is fixed on the omo root (4.3), which enforces the security design's refusals before it calls the engine. An exported function never reads terminal state either: where an operation needs the project-trust decision and `trust` is omitted, it answers a typed refusal that names the input and never defaults to trust, and the CLI adapter owns the prompt. Forwarding an argv today proves nothing about an importable equivalent, so these functions and their ownership of lifecycle and output are settled in the engine first (slice E1a). `trust` below is the project-trust choice of `--approve` and `--no-approve`. Each row has two phases: the Slice column names the engine slice that exports the function, and the row becomes a call on the omo root, with its descriptor migrated and its unresolved entry cleared, only in E1c.

Where an operation has inputs that the security design gates (the endpoint selector, a key root, a presenter channel, the launch `setup`), there is still one implementation: one internal core function that takes every input, which the engine's CLI command calls. Slice E1a exports that function with the gated inputs left at their defaults, and slice E1a-s adds them to the exported signature. The exported function is never a second body. The exported command metadata lists the gated flags from the start, each marked as an input that E1a-s adds, so the registry sees them as recorded gaps and not as unmapped flags.

| Capability and SDK inputs | CLI today | Tool | SDK today | Adapter | Slice |
|---|---|---|---|---|---|
| `engine.packages.install({ source, local?, trust? })` | `omo install <source> [-l\|--local] [--approve\|--no-approve]` | none | **no** | Tool omitted: installs code into the engine | E1a |
| `engine.packages.remove({ source, local?, trust? })` | `omo remove\|uninstall <source> [-l\|--local] [--approve\|--no-approve]` | none | **no** | Same reason | E1a |
| `engine.packages.list({ trust? })` | `omo list [--approve\|--no-approve]` | none | **no** | Same reason | E1a |
| `engine.packages.update({ source?, trust? })`: every installed package, or one | `omo update --extensions`; `omo update --extension <source>`; `omo update <source>`; each with `[--approve\|--no-approve]` | none | **no** | Same reason. These are the engine targets the launcher forwards today. `omo update --all` is not one of them: the launcher takes it as a product update with an unknown flag and refuses it, and that refusal is kept | E1a |
| `engine.models.update()` | `omo update --models` | none | **no** | Tool omitted: `thread_set_model` resolves against the catalog the target already has | E1a |
| `engine.models.discover({ provider })`: fetches one provider's model list and adds it to that provider's entry; a call without a provider is refused, as the command refuses it (`E/cli/models-command.ts:13, 84-88`) | `omo models discover <provider>` | none | **no** | Same reason | E1a |
| `engine.models.list({ pattern?, setup? })`. `setup` is the launch setup of 6.9, because the command builds its model runtime from the launch flags given with it (`E/main.ts:1431-1456`) | `omo --list-models [pattern]` with any launch setup flags | none | **no** | Same reason | E1a for the call over the default runtime; E1a-s for `setup` |
| `engine.config.agentDir()` answering the versioned record the command prints | `omo config agent-dir --json` | none | **no** | Tool omitted: a host integration's lookup | E1a |
| `engine.config.resources({ local?, trust? })` answering the resolved package resources with whether each is enabled; `engine.config.setResource(...)` answering the changed entry, with two typed forms, because the two settings files do not hold the same thing. Global: `{ source, resource: { type, path }, enabled: boolean }`. Project-local: `{ local: true, trust?, source, resource: { type, path }, state: "inherit" \| "load" \| "unload" }`, the three states the project override has (`E/modes/interactive/components/config-selector.ts:30, 671-740`); a boolean cannot express `inherit`. The resource type is the engine's own (`E/core/package-manager.ts:82-97`) | `omo config [-l\|--local] [--approve\|--no-approve]` (a TUI) | none | **no** | Tool omitted: #14366 decides what a session may edit. The TUI is a renderer over the two calls | E1a |
| `engine.auth.check({ provider?, model?, refresh? })` answering status only | `omo auth check --provider <p> [--model] [--json] [--no-refresh]` | none | **no** | Tool omitted: provider credentials | E1a-s |
| `engine.auth.credentials({ provider?, model?, refresh? })`, `engine.auth.apiKey({ provider?, model? })`, `engine.auth.bearerToken({ provider?, model?, min_expiry_ms? })`; where the credential goes is fixed by S0 | `omo auth check --credentials`; `omo auth print-api-key`; `omo auth print-bearer-token [--min-expiry]` | none | **no**; custody (S0) | Tool omitted: section 4.5 | E1a-s |
| `engine.schedule.list()` | `omo schedule list [--json]` | none | **no** | Tool omitted: the engine's `schedule_prompt` tool is the session surface for creating one | E1a |
| `engine.schedule.cancel({ id })` | `omo schedule cancel <id>` | none | **no** | Same reason | E1a |
| `engine.schedule.run({ watch?, exec?, poll_seconds?, timeout_seconds?, concurrency?, signal? })`, a stream of deliveries when watching | `omo schedule run [--watch] [--exec] [--poll-seconds] [--timeout-seconds] [--concurrency]` | none | **no** | Tool omitted: it resumes sessions headlessly on this machine, an operator's runner | E1a |
| `engine.sessionOfPid({ pid })` | `omo session-of-pid <pid> --json` | none | **no** | Tool omitted: a host integration's lookup | E1a |
| `engine.sessions.exportHtml({ session, out? })` answering the written path; `out` omitted lets the engine choose it, as today | `omo --export <file> [<out>]` | none | **no** | Tool omitted: writes a file for a person | E1a |
| `engine.promptSizes({ setup? })`, taking the same `setup` object as a launch (6.9) and answering the size of each prompt part; `engine.tips()` | `omo --print-prompt-sizes` with any launch setup flags; `omo --list-tips` | none | **no** | Tool omitted: installation diagnostics | E1a for the calls over the default runtime; E1a-s for `setup` |
| Host sessions | `omo host session open\|close\|unload\|model\|prompt\|steer\|abort\|read\|state\|list\|wait [--socket] [--rpc-key-root]` | the thread tools | partial | The `threads.*` rows of 6.1 and 6.2; the endpoint is the root's `endpoint` | T1b |

### 6.9 Launching an engine process

`omo [flags] [prompt]` starts an engine process. That is a different capability from opening a thread on a host (`threads.create`), and it is where a fork is supported today: the terminal process forks a session (`E/main.ts:438-445`), while a host open refuses `fork_from`. The launch is its own set of SDK operations, one per mode. Each takes the parts of one `LaunchOptions` type that its mode admits and refuses the rest with the parser's own refusals; the engine exports the type as its `Args` schema (slice E1a-s). The classification below is from the engine's parser and help text (`E/cli/args.ts`).

`LaunchOptions`:

| Part | Fields | Flags |
|---|---|---|
| `session` | One of `{ continue: true }`, `{ path }`, `{ id }` (created if missing), `{ fork }` (never with the others), `{ rebind }`, `{ ephemeral: true }`; plus `dir?`, `spawned_by?: { parentSessionId, rootSessionId, taskId }`, `name?` | `--continue`, `--session <path>`, `--session-id <id>`, `--fork <path\|id>`, `--rebind <path\|id>`, `--no-session`, `--session-dir <dir>`, `--spawned-by <json>`, `--name`. `--resume` is a picker: a renderer over `threads.list` that fills `session.path` |
| `setup` | `model?`, `provider?`, `model_patterns?`, `reasoning?`, `system_prompt?`, `append_system_prompt?`, `tools?: { allow?, deny?, none?, no_builtin? }`, `extensions?: { paths?, none? }`, `skills?: { names?, none? }`, `prompt_templates?: { paths?, none? }`, `themes?: { paths?, none?, use? }`, `context_files?: boolean`, `project_trust?: boolean`, `offline?`, `session_runtime?: "in-process" \| "worker"`, `tool_runtime?: "in-process" \| "child"`, `auto_title?`, `extension_flags?` | `--model`, `--provider`, `--models`, `--thinking`, `--system-prompt`, `--append-system-prompt`, `--tools`, `--exclude-tools`, `--no-tools`, `--no-builtin-tools`, `--extension`, `--no-extensions`, `--skill`, `--no-skills`, `--prompt-template`, `--no-prompt-templates`, `--theme`, `--no-themes`, `--use-theme`, `--no-context-files`, `--approve`, `--no-approve`, `--offline`, `--session-runtime`, `--tool-runtime`, `--auto-title-sessions`; a flag an extension registers (the engine's help names `--plan`) fills `extension_flags` and is discovered from a test engine session |
| `input` | `messages?: string[]` in the order given, `files?: string[]`, `stdin?: boolean`. Several messages and files are kept as given; the parser's selection among them and its refusals are the contract | Positional arguments, each `@<file>` argument, `-` to read stdin, everything after `--` (`E/cli/args.ts:155-160, 374-400`); `--print [message]` adds its message to the list (`:268-273`) |
| `presenter` | `{ bootstrap_fd: 4, enforcement?: boolean }`. Its contract is the security design's; until that approval these two inputs are a recorded gap, not a flag classified away | `--mcp-presenter-fd 4`, `--mcp-presenter-enforcement` (`E/cli/args.ts:347-351`) |
| `gated` | `{ grok_neo?: boolean }`: an input the engine's parser accepts only while its feature gate is on. With the gate off the same text is not this input and falls to the unknown-flag path, as today (`E/cli/args.ts:339-340`). The row exists now, with that availability rule; each later gated input needs its own | `--grok-neo` |
| A credential | A provider API key for the run. The registry records it as an `api_key` input of each launch operation, a recorded gap that only slice E1a-s can clear; its SDK name and its carrier are fixed by S0 | `--api-key` |

Operations:

| Capability | CLI today | Outcome | Tool | SDK today | Slice |
|---|---|---|---|---|---|
| `engine.launch.interactive({ session?, setup?, input?, gated?, tui_mode?, verbose?, attach?: { socket, session } })`: starts the terminal UI on the caller's terminal | `omo [flags] [messages] [@files] [-]`, `--tui-mode regular\|fullscreen`, `--verbose`, `--attach <socket>` (what `omo remote attach` launches over `threads.attach().serveEndpoint`) | Resolves when the process exits: `{ exit_code, session? }`. `session` is the id the caller named; an ephemeral launch answers none; with no selector it is absent, because the engine has no channel that tells a parent which session a child opened | none; omitted: a session has no terminal to give it | **no** | E1a-s, E1c |
| `engine.launch.print({ session?, setup?, input, gated?, mode: "text" \| "json" })`: runs the input to the end in a new process | `omo --print [flags] [messages] [@files] [-]`, `--mode text\|json` | A stream of the run's events, then `{ exit_code, session? }`: the id the caller named, else the id in the json stream's session header, else absent; an ephemeral launch answers none | none; omitted: a session delegates through its task tools | **no** | E1a-s, E1c |
| `engine.launch.rpc({ session?, setup?, gated?, listen?, multi_session?, presenter? })`: starts an engine that serves its RPC on stdio or on an address | `omo --mode rpc`, `--listen <address>`, `--multi-session`, `--mcp-presenter-fd`, `--mcp-presenter-enforcement` | `{ address, pid }` and a handle whose `stop()` ends it; on stdio the handle is the duplex stream | none; omitted: the host a session runs on is not the session's to start | **no** | E1a-s, E1c |
| `engine.launch.hand({ session?, setup? })`: starts a hand that runs tool calls for a remote loop, on its own endpoint, in RPC mode. It refuses `input`, print, a mode other than `rpc`, `listen` and `multi_session`, and is never combined with headless (`E/cli/engine-mode-args.ts:8-24`) | `omo --hand [setup flags]` | `{ socket, pid }` and a stop handle | none; omitted, same reason | **no** | E1a-s, E1c |
| `engine.launch.headless({ session?, setup?, listen? })`: starts the machine-owned session host, in RPC mode and always multi-session. It refuses `input`, print and a mode other than `rpc`, and is never combined with hand (`E/cli/engine-mode-args.ts:8-24`) | `omo --headless [setup flags] [--listen]` | `{ socket, pid }` and a stop handle | none; omitted, same reason | **no** | E1a-s, E1c |

A launch function starts the engine entry as a new process: that is what a launch is, and the rule of 6.8 against starting the CLI as a child is for the forwarded commands. Its argv is derived from the exported command metadata run backwards, with a round-trip test per field, and the parser's refusals run in-process before anything is started. The launch function does not choose a session id for the caller: an id no project session has makes the engine print a warning line, which would change what a person sees. The credential input is a readable handle, delivered to the started process on a private inherited descriptor, never in its argv or its environment (the security design's row for a provider key at launch).

Which `setup` fields each mode admits, beyond the refusals named in its row, is read from the engine's exported schema in slice E1a-s. A field a mode's parser accepts and its operation lacks fails the flag check of section 7.1.

### 6.10 Rows that are not capabilities

- **Internal**: entries the binary dispatches for its own processes (`__kill-guard`, `__device-service-bootstrap` from #14890, `remote enable --after-login`, the engine's `--omo-local-update-worker`, the compiled binary's `--internal-rpc-host-supervisor` at `N/supervisor-fast-path.ts:10`, and the compiled binary's `loro-smoke` at `N/compile-entry.ts:180-183`, a self-check that the bundled sync runtime initializes and reproduces its committed encodings). Each is registered as `internal` with the capability it serves (`deviceService.bootstrap`, `install.update`, `daemon.ensure` for the supervisor flag, the launch operations of 6.9 for `__kill-guard`, which is the judge a running session's shell shims ask before a kill and is anchored on the interactive launch row, and a finding of `diagnostics.run` for the self-check), so a hidden verb cannot bypass the check by being hidden.
- **Retired**: a verb that only answers where it went (`omo app-server`, the native `omo ulw-loop`), registered with the call that replaced it.
- **Render**: `--help`, `-h`, `--json`, `--verbose`, `--no-timestamp` on any verb.

### 6.11 The OpenCode-edition binary

`C/` ships a different binary (`oh-my-opencode`, `oh-my-openagent`). The scope decision on #14943 (2026-11-25, made for the owner under his standing order, his to override) is **both editions**: everything a CLI can do works through the SDK, with no carve-out by binary.

- A verb that shares a domain core with the native edition goes through the same core and the same SDK call. The OpenCode-edition CLI becomes one more adapter; it gets no second implementation.
- A verb that exists only in that edition gets an SDK call of its own.
- Order: the native-edition slices first, then the OpenCode-edition slices. #14943 closes only when both editions are at zero gaps.

Its routes are Commander registrations; the registry reads them from the program object (commands, aliases, options, hidden routes, root options), not from this table.

| Capability and SDK inputs | CLI (OpenCode edition) | SDK today | Adapter | Slice |
|---|---|---|---|---|
| `install.plugin({ interactive, platform?, claude?, openai?, copilot?, opencodeZen?, zaiCodingPlan?, kimiForCoding?, opencodeGo?, bailianCodingPlan?, vercelAiGateway?, and the three further provider inputs of `InstallArgs`, codex_autonomous?, skip_auth })`. `claude` is `no`, `yes` or `max20`; every other provider input is `no` or `yes`; each is its own typed field. The registry holds no placeholder for them: it enumerates the twelve provider keys of `InstallArgs` (`C/types.ts:3-21`) mechanically, checks each against its Commander option (`C/cli-program.ts:57-76`) and its mapping (`C/install-command-options.ts:38-55`), freezes all twelve as rows in P0's baseline, and requires a scenario per key and value. This document's prose abbreviates three of the twelve names; the registry does not. `platform` is `opencode`, `codex`, `both`, `native` or `native-dev`; it defaults to `codex` when the binary is invoked as that edition, and `native-dev` is refused unless the release enables it (`C/install-command-options.ts:23-36`). `codex_autonomous` has three input cases, kept as they are today: `true` configures that platform's autonomous permissions; `false` leaves the existing permission settings unchanged (`C/cli-program.ts:74-76`); absent takes the mode's default, which in a non-interactive install for that platform is to configure them (`C/install-validators.ts:244`) and in an interactive one is the prompt's answer. Each case is a scenario, and the contract is one the security design reviews. The call answers what it installed and wrote per platform | `install` (alias `setup`) `[--no-tui] [one flag per provider input] [--codex-autonomous \| --no-codex-autonomous] [--skip-auth]`, with the root option `--platform` | **no** | Planned (OC1a). The interactive prompts are a renderer over the same call | OC1a |
| `threads.runToCompletion({ message, agent?, model?, directory?, session_id?, endpoint?: { port } \| { attach_url }, on_complete?: { command }, signal? })`: one operation that opens or reuses a session on that edition's server, sends the message, and waits until the run is complete by that edition's rule (the todos and child sessions are done and the run did meaningful work), then runs `on_complete`. It streams the run's events and answers `{ session_id, success, duration_ms, message_count, summary }` (`C/run/types.ts:4-29`, `C/run/runner.ts:145-177`). `port` and `attach_url` exclude each other. `on_complete` runs a command as the caller's OS user after completion; it is an effect of the operation, so who may pass it is a row of the security design | `run <message> [-a\|--agent] [-m\|--model] [-d\|--directory] [-p\|--port] [--attach <url>] [--session-id] [--on-complete <command>] [--json] [--no-timestamp] [--verbose]` | **no** | Planned (OC1b). The existing exit mapping and cancellation are the descriptor's projection | OC1b, after S0 |
| `diagnostics.run({ status?, verbose?, platform? })` | `doctor [--status] [--verbose] [--json] [--platform]` | **no** | Planned (OC1a), on the findings shape of C1b | OC1a |
| `install.version()` | `version`; the root option `--version`, `-v` | **no** | Planned (OC1a), with the edition's own version projection | OC1a |
| `install.localVersion({ directory? })` answering the installed version, the latest published one, whether it is up to date, and the local-development or pinned mode | `get-local-version [-d\|--directory] [--json]` | **no** | Planned (OC1a) | OC1a |
| `config.migrate({ dry_run? })`: with `dry_run`, the transform, the backup move plan and the conflicts; without, what was applied | `config migrate [--dry-run] [--json]` | **no** | Planned (OC1a) | OC1a |
| `config.modelCapabilities.refresh({ directory?, source_url? })`, over `packages/model-core` | `refresh-model-capabilities [-d\|--directory] [--source-url] [--json]` | **no** | Planned (OC1a) | OC1a |
| `mcp.oauth.login({ server, server_url?, client_id?, scopes? })`, `.logout({ server, server_url? })`, `.status({ server? })`, over `packages/mcp-client-core` | `mcp oauth login <server-name> [--server-url] [--client-id] [--scopes ...]`; `mcp oauth logout <server-name> [--server-url]`; `mcp oauth status [server-name]` | **no**; custody (S0) | Planned (OC1c) | OC1c |
| `account.keys.*`, and `account.signIn`, `signOut`, `whoami` | `account keys init\|status`; `login`, `logout`, `whoami` | 6.4 | 6.4 | OC1c |
| The loop's ten operations and five hook entries, enumerated in the table below | `ulw-loop [args...]`, which starts a separately installed component's CLI as a child with the arguments unchanged (`C/runtime-commands.ts:99-107`, `C/codex-ulw-loop.ts:31-73`) | partial: see below | Planned (OC2) | OC2 |
| `boulder.status({ directory?, work_id? })`, over `packages/boulder-state` | `boulder [-d\|--directory] [-w\|--work-id] [--json]` | **no** | Planned (OC2) | OC2 |
| `worktrees.sweep({ apply?, older_than_days?, repos? })`: a plan unless `apply` is set, with today's refusals and deletion guard | `worktree-sweep [--apply] [--older-than <days>] [--repo <path>]... [--json]` | **no** | Planned (OC2) | OC2 |
| `install.cleanup({ platform?, codex_home?, project? })`, answering what it removed; `platform` is `codex`, the sub-command's value before the root option's | `cleanup` (alias `uninstall`) `[--platform] [--codex-home] [--project] [--json]` | **no** | Planned (OC2) | OC2 |

`ulw-loop [args...]` reaches the component's own dispatch (`packages/omo-codex/plugin/components/ulw-loop/src/cli.ts:8-44`, `cli-commands.ts:39-101`). That component already runs every sub-command through its own SDK (`cli-subcommands.ts:204`), whose manifest names one method per operation (`src/sdk/manifest.ts`). What is missing is the root: the OpenCode binary starts a child process, and `toolkit` on the root does not reach this component. Each leaf, with its flags as the component's usage gives them (`cli-output.ts:4-20`); `--json` on any of them is rendering.

Every state sub-command runs against exactly one loop session, and that shared input has one typed binding on the root: `toolkit.forSession({ cwd, session_id? })` answers the operations bound to that session, and the rows below are methods of what it answers. The core resolves the session, not the adapter: an explicit `session_id` (the `--session-id` flag; present but empty is refused `ULW_LOOP_SESSION_ID_REQUIRED`), else the first of the session environment keys the component reads, else the refusal `ULW_LOOP_SESSION_SCOPE_REQUIRED` with the existing session ids in its details. The unscoped root is never used implicitly (`cli-commands.ts:110-131`, `cli-subcommands.ts:204-216`). An adapter passes the flag's value or nothing and never reads the environment or builds a loop context itself. Which principal may bind which session is a row of the security design; this design proposes no new authority there: a person or a script names the session as the flag does today, and a session is bound to its own. `help` needs no session:

| Sub-command and flags | Root call | SDK today |
|---|---|---|
| `help` | `toolkit.help()` | partial: in the component's SDK, not on the root |
| `create-goals [--brief \| --brief-file \| --from-stdin \| positional text] [--codex-goal-mode aggregate\|per_story] [--validation-batch-json] [--force]` | `createGoals({ brief, codexGoalMode?, validationBatchesJson?, force? })`. The brief has four sources that all fill the one `brief` field, taken in this order: `--brief`, then the file of `--brief-file`, then stdin with `--from-stdin`, then the positional words not consumed by a flag, joined by spaces. A brief that is empty after that is refused `ULW_LOOP_BRIEF_REQUIRED` (`cli-subcommands.ts:29-41`, `cli-arg-parser.ts:44-54`). The order and the refusal are the descriptor's parse, pinned by scenarios. The parser also accepts `--after-json`, `--directive-json`, `--directive-file` and `--target-goal-id` (`cli-arg-parser.ts:8`) only to keep their values out of the positional brief; nothing reads them. They are adapter parse flags with no SDK input and the written reason "its value is removed from the positional brief; nothing reads it", with one scenario that shows the brief excludes the value | same |
| `status` | `toolkit.status()` | same |
| `complete-goals [--retry-failed]` | `toolkit.completeGoals({ retryFailed? })` | same |
| `criteria --goal-id` | `toolkit.criteria(...)` | same |
| `record-evidence --goal-id --criterion-id --status pass\|fail\|blocked --evidence [--notes]` | `toolkit.recordEvidence(...)` | same |
| `checkpoint --print-template [--goal-id]`; `checkpoint --goal-id --status complete\|failed\|blocked --evidence --codex-goal-json [--quality-gate-json] [--no-advance]` | `toolkit.checkpoint(...)`, two branches. The second branch takes `advance?`, which `--no-advance` sets to false (`checkpoint-continuation.ts:51`); the component's manifest does not carry it in the checkpoint arguments today, so it is an entry of the baseline | same, without `advance` |
| `steer --kind <kind> --evidence --rationale [--proposals-json]`, with the flags each of the seven kinds requires (`cli-steering.ts:84-90`) | `toolkit.steer(...)`, one branch per kind | same |
| `add-goal --title --objective` | `toolkit.addGoal(...)` | same |
| `record-review-blockers --goal-id --title --objective --evidence --codex-goal-json` | `toolkit.recordReviewBlockers(...)` | same |
| `hook user-prompt-submit [--with-ultrawork]`, `hook pre-tool-use`, `hook stop`, `hook post-tool-use-spawn`, `hook pre-tool-use-spawn` | Internal: hook entries that read a hook payload on stdin for that edition's plugin. Registered `internal`, each serving `toolkit.forSession`. Slice OC2 re-maps a hook that drives exactly one loop operation when it puts those operations on the root | n/a |

The argument object of each method is the manifest's `args` for that operation, and the registry takes it from the manifest, not from this table. Each of the ten operations is an entry of P0's baseline until OC2 wires the root to this component, and the command keeps its present behaviour until then. P0 registers the manifest's argument shapes and checks them against the descriptors, and the baseline of this delegated registry includes the two shared-input scenarios: the brief's four sources with their order and the empty refusal, and the session binding with its flag, environment and two refusals.

The OpenCode-edition binary has no thread tools of its own in this table: its agent-facing tools are that edition's plugin tools, outside the three surfaces this issue names.

## 7. Holding parity in CI

Two reviews showed what a row table, an import guard and sampled scenarios cannot do. The checks below say what each one fails on and what it cannot see.

### 7.1 A complete route inventory, for both editions

- Each binary has one dispatch function that looks up the descriptor table and does nothing else. The delegated parsers that decide a route today become descriptors or are generated from them: the remote verb table and its parser (`N/remote-cli.ts:43-86`, `N/remote-local.ts:127-164`), `remote attach` before that table, the engine-command predicate and its `models discover` branch (`N/bin/lib/engine-commands.js`), the compiled entry's early branches, and the OpenCode edition's Commander registrations.
- Three inventories are compared with the descriptors, and each must match exactly: (1) a scan of every module reachable from each binary's entry points for a comparison of an argv element against a string literal outside the dispatch function; (2) for the Commander program, a walk of the program object at run time: every command, alias, option, hidden route and root option; (3) for the engine, its exported command metadata (E1a), and until that export exists a pinned snapshot of the engine's leaf commands and flags written into the baseline by hand from sections 6.8 and 6.9.
- Every flag of a descriptor names the SDK input field it fills, or is marked `render` or `process`. A flag with no mapping fails.

### 7.2 The registry: SDK ⊇ CLI, SDK ⊇ tools

`script/sdk-parity/rows/<domain>.json`, one file per domain. A row:

```json
{ "id": "threads.setReasoning",
  "sdk": "threads.setReasoning",
  "cli": [],
  "tool": "thread_set_reasoning",
  "planned": { "cli": "T3" },
  "omitted": {},
  "projection": {},
  "scenarios": { "effect": ["set-reasoning-turn", "set-reasoning-session"], "refusal": ["level-unsupported"] } }
```

- `sdk` is required by the schema for every row, in both editions. An SDK omission cannot be written.
- An empty `cli` or `tool` cell needs either `planned` (a slice) or `omitted` (a reason). They are different fields, so pending work is never recorded as a decision.
- **The descriptor and the row are one value.** A descriptor's `sdkCall` key is its row's `sdk`; a test runs each descriptor against a recording root and fails when the member invoked is not that key or when more than one member is invoked.
- **CLI ⊆ SDK.** Every descriptor has a row, and every mapped flag's field exists in the SDK call's input schema.
- **Tools ⊆ SDK.** Tools are discovered from a test engine session's registry, so a tool registered at run time is seen. Store-extension tools are declared at run time by whoever registers the extension, so their check sits at the declaration: `threads.extensions.register` refuses a session operation whose input schema is not the one `sessionCall` validates, and a fixture extension drives it. For each static tool, each descriptor branch's projected schema is compared recursively with the SDK call's: every property, nested object, optionality, bound and default. A declared `projection` (for example `text` to `message` on the legacy facade) is the only accepted difference.
- **A row's call is real.** A row counts as built only with, for each input that changes behaviour, a scenario whose expected outcome is an effect the fake ports observed, plus its declared refusals. What counts is a record that the scenario ran at the head and that what it observed equals the scenario's expected effect, never a field of the row that is merely filled in and never an observation with nothing to compare it to: a scenario id or a description written into a row builds nothing, and a run whose scenario states no expected effect builds nothing. The shape of an expected effect has one definition, in the registry's schema, and the scenario table conforms to it. Equality means the trace is complete: each port operation is classified once, as an effect (it writes, sends or starts something) or as a read, and an effect operation the scenario did not state fails the run, as a missing one does. Arguments are compared for the fields the scenario states, because ids and times are generated; what a fake is told to answer is the scenario's stimulus and is never part of the effect, so two scenarios that differ only in stimulus do not show that an input is honoured. A scenario's kind is checked against the row's own split into effects and refusals, and a row is built only with a passing effect scenario. A tool field named in a branch's presence condition is required for that branch, whatever the tool's shared schema says, and the row carries it as required. `not_implemented` is the only code a stub may answer, and a scenario that expects it fails; a context-dependent refusal such as `fork_unsupported` is a declared `refusal` scenario and is not mistaken for a stub. A refusal scenario alone never certifies an input the SDK ignores.
- The published table of section 6 is rendered from the rows and compared byte for byte.

### 7.3 One scenario table, the drivers that apply

`sdk-conformance.test.ts` extends `T/route-parity.test.ts` and the device-service conformance owner that #14890's tests run on. A scenario is driven through every surface that has the capability: the SDK directly, always; the tool's `execute` where the row has a tool; the CLI's descriptor with `--json` where the row has a verb in that edition. A row with an omitted surface names it in `omitted`, and the test does not invent a driver for it. Where two or more drivers apply, their typed outcomes must be equal after each surface's declared projection, for comparable inputs and principals, and the fakes must have received the same calls.

Scenarios, with a target on this device and on another for each where the capability has a target: every address form and every policy row of section 5; send in each mode; a receipt for a named delivery and for one that is not the caller's; raw entry paging by `since`, `before` and `tail`; a wait anchored on a send and one that is not; an alias that two threads would answer; a repeated `idempotency_key` on every control call; every option of close (`force`, `graceful`, `wait_ms`) and of unload; create with a lost acknowledgement and a retry under the same key, keeping caller identity and the original session; every control verb on a live, an ended and an offline target; each refusal code; a timeout and an authorization refusal with no second write; a stream cancelled midway and its terminal outcome; a held delivery, a capped delivery and a repeated key reporting the current kind (#14941); the refusal rows of the security design. Every domain outside threads has the same table with the drivers its rows have. All of it runs on the virtual clock.

A scenario states, in the one shape the registry's schema defines: the fixture state of the fake ports before the call; the input; where the addressed thread lives; at most one injected fault, from a closed list tied to the port it applies to; a cancellation, as the caller's signal firing after a stated time on the virtual clock, together with the effect that must not have happened; the expected effects as port operations; an expected answer where the call's value is the engine's own reply, checked in addition to the port expectations and never instead of them; a refusal with its code, read from the root's failure or, for a call that keeps an engine reply as its value, from that value; and the calls made after the first, in order, on the state the first left.

The table is the target contract and not a record of today. For a row with a target, an effect scenario must exist on this device and on another for the table to be valid, and must pass for the row to be built. Where a call refuses today and the design says it must work (following a session on the caller's own device, before slice T1d), the table carries the design's effect scenario, which cannot pass yet, and today's refusal as a second scenario marked with the slice it retires with; the row stays unresolved until then. Three calls are host-local and are the only exemption, a closed list: `threads.unload`, `threads.release` and `threads.adopt` act on the session host of the device that runs the call. Each needs a passing effect on this device and a declared refusal on another: `release_unsupported` for release and adopt, read from the answered value (`T/sdk.ts:508-511`), and the host's generic unknown-session answer for unload, which cannot tell another device from a mistyped reference. Making them work across devices would be a new capability, which this program does not add. A second closed list holds the calls that touch nothing: `account.signInCheck` and `toolkit.help`. A pure call has no port operation to state, so it is built by an answer scenario whose observed trace is empty, reads included; a call that only reads is not pure and states its reads.

This check sees a behaviour difference only on a sampled scenario. It does not prove an adapter is pure.

### 7.4 The baseline, and the same-pull-request gate

Rule 5 of section 1 is enforced per capability, by behaviour.

- **Two files.** `script/sdk-parity/baseline.original.json` is the record of the defects that existed when the gate was introduced, for both editions: capability id, the missing SDK input or call, and the issue that fixes it. It is written once and never changes. Its hash pin is not a value the pull request supplies: the gate reads the pin from the base branch, as the initializing commit left it, so a pull request that edits the original and a pin together still fails. `script/sdk-parity/unresolved.json` is the working manifest. At every pull request it must be a subset of the original **and** of the manifest at the merge base: an entry the original lacks is rejected, and so is an entry the merge base no longer has, so a gap that was cleared cannot come back.
- **Initialization.** Slice P0 adds every descriptor under gaps that already exist. The gate admits exactly one pull request in that state: the one whose merge base has no `baseline.original.json` and which creates it, its hash pin and the goldens below together, and changes no behaviour (its goldens are generated from the pre-change binaries and must still match after the change).
- **A demonstrated change and a candidate.** The gate looks at five things per capability: its descriptor; its tool schema; the import closure of its `parse` and `render`; its **implementation closure**, the modules its SDK member reaches in the core, which the registry computes from the member; and its scenario outcomes. The outcomes are not read from a stored file a pull request could edit: the gate runs each capability's scenarios through the CLI and tool drivers on a build of the merge base and on the head, and compares the two results. A stored golden is only the reviewer's view of that comparison. A row has two parts, and the gate compares them separately. Its **descriptor** is what a caller can observe or call: the SDK member, each CLI route with its flags and positionals and the input field each fills, each tool branch with its fields, which fields exist and which are required, the projection and the render, and an omission with its reason. Its **contract annotation** describes fields the descriptor already names without changing any of that: the type and schema of an existing field, scenario ids, references to the security design, notes. A capability has a **demonstrated change** when its descriptor, its tool schema or one of its scenario outcomes moved. It is a **candidate** when only a closure moved, or only its contract annotation moved, and every outcome is equal on both builds. One limit on annotation, which the reviewer carries: typing the nested shape of a field on a row whose call is not built yet describes nothing a caller can reach, and is annotation. On a row whose call is built, the schema is live: a change to requiredness or shape inside a nested field can change what a caller may pass, so equal sampled outcomes are not enough for the reviewer's line. The reviewer reads the live schema and confirms that the set of accepted inputs is the same in both directions: nothing the base accepted is refused, and nothing the base refused is accepted. Accepting a new input is a behaviour change as much as refusing an old one, because a call that was a refusal becomes an effect. Either difference makes the change a descriptor change, and rule 5 applies: the SDK call and its parity evidence in the same pull request. The gate decides which part moved mechanically: a change that adds or removes a field, flips required and optional, or alters a member, a route, a flag or a mapping is a descriptor change however it is labelled, so a behaviour change cannot be filed as annotation. A closure move is a conservative sign that behaviour may have changed, not proof that it did.
- **The limit.** The scenarios are a sample (7.3). A change that keeps every sampled outcome is caught only by the closures, and a closure is wide: an edit to a shared core module marks every capability that reaches it as a candidate. That is the intended direction of error. Equal sampled outcomes do not establish that behaviour is unchanged, and this document does not claim they do.
- **Demonstrated changes fail the check.** A capability with a demonstrated change must have no entry in `unresolved.json` at the head, and its scenarios must have run and passed at that head. A pull request therefore cannot add an alias, a flag or a tool field, or alter what one does, under an existing gap. It adds the SDK call and its scenarios in the same pull request, or the check fails. The check also fails on every registry and baseline rule of this section.
- **Presentation-only outcomes.** A CLI scenario may declare the command whose `usage: omo <command>` block its output carries. A difference in that scenario's outcome is not a demonstrated change only when all of these hold: the exit code is equal; each stream is equal or carries the block on both sides; every line outside the block is equal; the block lists the same verbs in the same layout; every changed block line is named, before and after, by a row of `script/sdk-parity/presentation.json` that names the verb and the reason; and the pull request's goldens carry the new outcome while the merge base's do not. The rewording of an existing verb's usage line passes; a changed exit code, a changed message, a moved block, a new or removed verb, or a usage change nobody named fails as a demonstrated change. Only a row the pull request adds counts: a row already on the merge base neither clears nor fails a later pull request, so the registry is never a standing exemption. A presentation-only scenario is printed with a `#presentation=<verb>` mark naming the row it used and joins the candidates' digest, so the reviewer's `SDK-Parity-Reviewed` line also confirms that the change is wording and not a capability.
- **Candidates are a merge requirement, decided by a reviewer.** A candidate under an unresolved entry does not fail the automated check, and it is not informational either. The check prints the candidate capability ids and a digest of that list together with the head. The pull request's body carries one line, `SDK-Parity-Unchanged: yes`, which is the author's claim. The reviewer then reads the diff against the printed ids and records, in the verdict at that exact head, one line: `SDK-Parity-Reviewed: <digest>`. That line is the reviewer's finding that the change preserves the behaviour of every printed capability. Without it there is no CLEAR: a verdict that lacks the line, carries a digest the check did not print at that head, or was given at an earlier head, withholds the merge. If the reviewer finds that a candidate does change behaviour, it is a demonstrated change by that finding and the rule above applies: the SDK call and its parity evidence in the same pull request. The ids are never typed by hand, so neither line can drift from what the check computed. This requirement holds from slice P0, including the period before the check is a required one. The check ships a verifier that takes the check's output and the verdict's text and answers accepted or withheld, so the requirement is itself tested (7.6). The scope of this tier shrinks as entries are cleared and is empty at zero gaps, so no later switch to a stricter mode is planned. The check runs on every pull request from slice P0 and becomes a required check after one green day on the base branch. The independent review of 7.5 is the precedent for a merge requirement a reviewer carries.
- **Zero-gap gate.** #14943 closes only when `unresolved.json` is empty for both editions, engine rows included.

### 7.5 Adapter purity, and what is not provable

- **Imports** (`script/remote-import-guard-*`, one more rule family): an adapter's direct imports, and those of any helper it imports that is not the SDK entry, may reach only the SDK entry, its own parse and render modules, and platform built-ins that are not sockets or `fetch`. Today's violations go into an offender list that only shrinks; a new offender fails, and so does a listed one that no longer offends. This fails on an adapter that imports a resolver or a transport.
- **Descriptor shape**: `call` is an `sdkCall` reference, so an adapter cannot invoke two members or branch on an answer there; orchestration lives in named SDK operations (3.2).
- **Not provable by either**: an adapter whose `parse` or `render` computes a decision inline from plain code, importing nothing. The conformance test catches it only where a scenario exercises the difference. The control is a mandatory review gate, not an automated pass: every slice's pull request carries the line "this adapter holds no resolution, transport or policy", and its reviewer verifies it against the diff before the verdict. This document does not claim the checks prove purity.

### 7.6 Negative controls

The checks are themselves tested. Fixtures add, one at a time, in each edition where the case exists: a verb with no row; a Commander command, alias or option with no descriptor; a flag with no mapping; a tool input field the SDK lacks; a nested field that became required; a branch that dispatches outside the dispatch function, in an entry file and in a delegated module; an adapter importing the delivery pipeline; a descriptor whose call invokes a different member than its row; a behaviour change in a parser with the descriptor untouched; a changed capability with an unresolved entry; an entry added to `unresolved.json` that the original lacks; an entry restored to `unresolved.json` that the merge base had removed; the original and a pin edited together; a contract-annotation-only change under an unresolved entry (a slice that types existing fields and builds no call), which must pass as a candidate and not fail as a demonstrated change; the same change with one field added, with required flipped, and with a mapping altered, each of which must fail as a descriptor change; a nested requiredness change on a built row, which the gate prints with a mark that the live schema needs the reviewer's compatibility check, once as a narrowing and once as a widening; a run with one effect operation the scenario did not state, and two scenarios differing only in stimulus offered as coverage of an input, each of which must fail; a core-only change under an unresolved entry with every descriptor, schema and adapter untouched, which must be printed as a candidate with its digest and must be withheld by the verifier until a verdict at that head carries the matching `SDK-Parity-Reviewed` line; the same change with that line, which the verifier accepts; a verdict whose digest the check did not print, a verdict given at an earlier head, and a pull request with equal outcomes and no verdict line, each of which the verifier withholds; a stored golden edited with the behaviour unchanged; a usage-only rewording of an existing verb, which passes as presentation-only with its row and updated goldens and fails without the row, and the same rewording with a changed exit code, a changed line outside the usage block, the block on the other stream, a new verb, no goldens update, a row naming another verb or other lines, or a row with no reason, each of which must fail; the same rewording with an outcome field added, removed or retyped, and with white space, order or wrapping changed outside the block (never normalised) or two verbs of the block swapped, each of which must fail; a row that names only one of the scenarios, which clears that one and no other; and a row naming a scenario that does not exist or declares no usage block, two rows for one verb of one scenario, and a row with no changed line, each of which the gate refuses; a stub answering `not_implemented` on a row counted as built; a row whose only scenario is a refusal. Each must fail with a message that names the SDK call, the field or the import to fix.

### 7.7 The real-surface proof

Section 9. It is the only check that needs real devices, so it runs last and only on a build that passed the others.

## 8. Migration slices

Each slice is one issue under #14943 and one pull request with `Fixes #<slice>`, sized to be reviewed as one unit. An existing call keeps working until its replacement has its scenarios and its proof. Every row of section 6 names the slice that builds it.

| Slice | What it does | Issue | Merges after |
|---|---|---|---|
| S0 | Security design, no code (#14945): threat model; the principal-by-capability matrix for every present caller and surface in both editions; custody of the eight credential groups; the `endpoint` selector, launch options, extension session operations, attach and answering; caller provenance; revocation; audit; rollout and rollback. Its approval is recorded on its issue | #14945 | none |
| P0 | Descriptors for today's routes in both editions, the registry rows, the two baseline files, the goldens, the import rule with its offender list, the negative controls. The baseline holds every enumerated leaf, the twelve install provider inputs and the ten loop operations among them. No behaviour change | new | none |
| P1a | Typed contracts that carry no principal, credential, endpoint or launch option: the root's type, the code registry, the scenario ids, and the input schemas of the rows not marked S0 | new | P0 |
| P1a-s | The security-sensitive contracts: `principal`, `endpoint`, the credential-bearing calls, `LaunchOptions`, the extension session operations, attach and answer | new | P1a, S0 approved |
| P1b | The root and the facades over it, the failure conversion, the surface-keyed exit projection, `omo-ai/sdk`, `omo sdk root`, principals wired per the matrix, the non-disclosure scan, `threads.extensions.register` and `.call` on the root | new | P1a-s, #14881, #14890 |
| T1a | The resolution contract of section 5 with the locator's policy, `threads.resolve`, `devices.resolve`, the ended-session rule (#13016 MSG-07, CLI-06, CTL-26, CLI-09). Owns `T/address/`, the locators and `T/sdk.ts`'s send path | #13016 | P1b; #14937 merged with its SDK-first fix |
| T1b | `threads.list` filters, `read` inputs, `readAfterWait`, `receipt`, `entries`, `messages`, `get`, `wait`, the extended `send` and `create` inputs, `interrupt`, `close`, `setModel`, `setReasoning`, `archive`, `unload`, with the key honoured on every control call. Owns `T/control/` and the read bodies | new | T1a |
| T1c | `threads.handoff`, `follow`, `sendAndFollow`, `attach`, `aliases`, `release`, `adopt`. Owns the delivery composition and the attach path | new | T1b; the telemetry milestone for attach |
| D1 | Truthful delivery: `held` with `engineTurnCap` mapped to a parked kind; a repeated key reports the current kind. Owns `T/gateway/` delivery handling | #14941 | T1c; the engine pin |
| T1d | Every verb on the caller's own device | #14931 | D1, #14890 |
| T1e | `threads.extensions.sessionOps` and `sessionCall` | new | T1d, S0 approved |
| T2 | The thread tools and the extension tools become adapters; `*-ops.ts` bodies move under the core | new | T1e |
| T3 | One CLI verb table for the session verbs whose root operations T1a to T1e supply (step 1 of the 2026-11-10 ruling): the `omo thread` verbs planned in section 6, and the `omo remote` session verbs as aliases. It migrates no other descriptor: the engine-forwarded ones are E1c's and the host lifecycle ones are C1a's. Owns `N/remote-cli.ts` and its dispatch until it merges | #14202, #13016 | T1e |
| A1a | The account core moves out of `cli/`; no behaviour change | #14364 | P1b |
| A1b | `account.signOut`, `show`, `forget`, `store.*`, `signIn` without a child process, `signInCheck`, the origin options. Owns `N/account-cli.ts` until it merges | #14364 | A1a |
| A1c | `devices.revoke`, `devices.rename` bounds, the other findings of #14523 | #14523 | A1b |
| A1d | `account.adopt`, `account.credentials.handOver` | new | A1c |
| A2a | `deviceService.*` and the `omo remote` switch verbs as adapters | new | T3 |
| A2b | `sync.status`, `enable`, `disable`, `approve`, `retirePin` | new | A1d |
| A2c | `sync.recover` | #14464, #14891 (the memory-sync lane's own pull requests carry it) | P1a-s |
| C1a | `daemon.*` over the engine's exported host lifecycle functions, and the `omo daemon` and `omo host` lifecycle descriptors as adapters; `engine.trust.ensure`, whose principal row is the security design's | new | P1b, E1b; S0 approved for `engine.trust.ensure` |
| C1b | `diagnostics.*` | new | P1b |
| C1c | `install.*` | new | P1b |
| TEL | The per-caller telemetry consent contract, merged in the engine (its #7446) and pinned in omo | the engine's #7446 | none |
| E1a | Engine: a typed function and exported metadata per leaf of 6.8 that carries no credential: packages, resources, schedules, models, queries, and the host lifecycle (ensure, status, stop, handoff, gc, shard path), each over the default endpoint and the default runtime. The endpoint selector, the key root, the presenter channel and the launch `setup` input are not in its exported signatures | new, on the engine | none |
| E1a-s | Engine: `LaunchOptions` and the launch operations of 6.9, the endpoint options, the provider-credential functions, and the gated inputs of E1a's functions (the endpoint selector, key root and presenter channel on the host lifecycle; `setup` on `models.list` and `promptSizes`) | new, on the engine | S0 approved, TEL, E1a |
| E1b | Engine release and the omo pin | release train | E1a, E1a-s |
| E1c | `engine.*` on the root including `engine.launch.*`. The engine-forwarded dispatch descriptors migrate here, and the unresolved entry of every engine row is cleared here, not at the engine export. The engine-and-omo compatibility test, owned by this program | new | E1b, P1b |
| X1a | The native thread proof of section 9 | new | T2, T3 |
| NM | Native completion. A milestone, not a pull request: every native slice is merged and its rows are cleared: P1b, the thread chain through T2 and T3, A1a to A2c, C1a to C1c, E1c, X1a. It does not include X1b | none | those slices |
| OC1a | OpenCode edition: `install.plugin`, `diagnostics.run`, `install.version`, `localVersion`, `config.migrate`, `config.modelCapabilities.refresh` | new | NM |
| OC1b | OpenCode edition: `threads.runToCompletion` over a session-host port for that edition's server | new | NM |
| OC1c | OpenCode edition: `mcp.oauth.*`, `account.keys.*`, and that edition's `login`, `logout`, `whoami` descriptors | new | NM |
| OC2 | OpenCode edition: the loop's ten operations on the root, `boulder.status`, `worktrees.sweep`, `install.cleanup` | new | OC1a |
| X1c | The OpenCode-edition proof of section 9 | new | OC1a, OC1b, OC1c, OC2 |
| X1b | Closure: the zero-gap gate for both editions, the non-thread acceptance rows, `docs/reference/omo-sdk.md`, the skills re-pointed at the SDK (#13415, #14932) | new | every slice above |
| X2 | The omo-harness skill: the steps omo-harness-skill#23 left on the CLI move to the SDK | new, on that repository | the release that carries the calls it needs |

Order:

```
S0 ────────────────┐
P0 ── P1a ── P1a-s ┴─ P1b ─┬─ T1a ── T1b ── T1c ── D1 ── T1d ── T1e ─┬─ T2 ─┬─ X1a ─┐
#14881, #14890 ────────────┘                                          └─ T3 ─┴─ A2a ─┤
                           ├─ A1a ── A1b ── A1c ── A1d ── A2b ──────────────────────┤
                           ├─ C1b ──────────────────────────────────────────────────┤
                           ├─ C1c ──────────────────────────────────────────────────┼─ NM ─┬─ OC1a ── OC2 ─┐
TEL ── E1a-s ─┐            │                                                        │      ├─ OC1b ────────┼─ X1c ── X1b
E1a ──────────┴─ E1b ──────┴─ C1a, E1c ─────────────────────────────────────────────┘      └─ OC1c ────────┘
```

- **The thread chain is serial.** T1a, T1b, T1c, D1, T1d and T1e all edit the thread facade, the control and delivery bodies or the address policy, so each merges after the one before it. T2 and T3 start only after T1e: neither turns a capability into an adapter, or dispatches an alias to it, before its own-device behaviour and its truthful-delivery behaviour exist. They touch different files and run in parallel with each other.
- **The account chain is serial** (A1a to A1d): each step edits the account core and `N/account-cli.ts`.
- **What runs in parallel**: the thread chain, the account chain, C1b, C1c, and on the engine E1a and TEL. They share no source file. E1a-s waits for S0; C1a and E1c wait for the engine release and pin (E1b). A2c lands with the memory-sync lane's own pull requests, any time after P1a-s.
- **Native first.** No OpenCode-edition slice starts before the native completion milestone (NM), which is every native slice and not the final closure, so the order is native, then OpenCode, then X1b, with no cycle.
- **Shared state, with owners.** The root's namespace registration is one array created by P1b; a slice adds its module and one line, and P1b's owner reviews every later edit to the root. The code registry and the exit projection are per-domain files that each slice appends to; a change to an existing code's meaning goes through P1b's owner. Parity rows are per-domain files, and two slices never own the same unresolved entry. The generated bundles (`service-auth.generated.js`, the thread client and SDK bundles, the bundle inputs) are regenerated by every slice and merge through the repository's bundle train. `N/remote-cli.ts` belongs to T3, then A2a. The sync state transitions in `N/account-cli.ts` (`retire-sync`, the sign-in's device-service setup) belong to A1b, then A2b.
- **Work already in review is the base, not redone**: #14878, #14881 and #14890 (the remote module train) under P1b; #14937 under T1a; the engine fix for its #7138 under D1; #14464 and #14891 for recovery.

## 9. The proof

A pass through the CLI alone proves nothing about the other two surfaces. Each matrix row is run on each surface that has the capability, each run on its own: (a) a plain bun script importing `omo-ai/sdk`, with no agent session and no `omo` child process; (b) an agent session calling the thread tools in eval cells; (c) the CLI with `--json`.

Native thread matrix (X1a), with B another signed-in device and A the caller, and again with A as its own target:

1. Create a thread with a first prompt; read it back: the prompt and its answer are in the transcript of the intended thread.
2. Send a follow-up; wait for the turn to end; read the answer.
3. Send a long-running prompt; steer the running turn; read both.
4. Interrupt the running turn (`interrupted: true`).
5. Set the model and the reasoning level; `get` shows both.
6. Rename it and give it an alias; address it by the alias from the other surface.
7. Read the receipt of one earlier delivery.
8. Archive and unarchive it; hand a task off to it by exact name.
9. Open a sibling thread; close the first; the listing shows it closed and the sibling still live.

A tenth step, through the SDK and the CLI only, because attach has no tool: attach to the sibling, read its snapshot, detach, and confirm the served endpoint is gone. It exercises attach and its endpoint lifecycle and nothing else. Follow, entries, unload and adopt are not part of the real run; their per-input obligations are the conformance test's (7.3).

Acceptance rows outside threads, run through the SDK and the CLI on the caller's device: `devices.list`, `account.whoami`, `deviceService.status`, `sync.status`, `daemon.status`, `diagnostics.run`, `install.version`, and one engine row from each group of 6.8 and 6.9.

OpenCode-edition matrix (X1c), through the SDK and that edition's CLI: `install.plugin` into a scratch home, `diagnostics.run`, `install.localVersion`, `config.migrate` as a dry run, `threads.runToCompletion` against a scratch server with a scripted model, `boulder.status`, `worktrees.sweep` as a plan, `install.cleanup` on the scratch home.

Evidence on #14943 for each run: the script or commands, each call's typed result, the transcript read that shows the prompt and the answer on the intended thread (a tool result or an exit code alone does not prove delivery), the final listing, and the build under test. The real runs are representative: per-input coverage is the conformance test's (7.3), and loss and refusal cases (a dropped acknowledgement, a timeout, an authorization refusal, a cancelled stream) are proven there, since a real relay cannot be asked to lose a reply.

The runs use a sanctioned test account and a scripted or low-cost model. They make no call on a personal subscription.

## 10. Decisions, after three reviews

| # | Decision | Where it stands |
|---|---|---|
| 1 | Two ok shapes on the root: the flat thread contract, and `value` elsewhere | Kept. The entry contracts are preserved by explicit facades with a field-by-field projection (4.1); the document claims neither one universal result nor one exit table (4.4) |
| 2 | How a secret moves | Not decided here. Custody is the security design's (S0, #14945); this document claims no approval for any carrier (4.5) |
| 3 | The principal | It selects a leg; authority is checked in the core against the security design's matrix, approved before the sensitive contracts are fixed (4.3, P1a-s) |
| 4 | Engine commands get real SDK calls through engine exports | Each leaf and flag is a row (6.8, 6.9); the launch is its own set of operations; the typed functions are settled in the engine first, with an export, release and pin sequence and a compatibility test this program owns (E1a to E1c) |
| 5 | `omo remote` session verbs become aliases | Both historical projections (flags, wait default, JSON, exit codes) are pinned by goldens before the implementations converge; an alias is removed only after one release and only when its goldens show no caller-visible difference; sender admission is not widened |
| 6 | The OpenCode-edition binary | Decided on #14943: both editions, every verb, zero gaps in both (6.11, OC1a to OC2, X1c) |

## 11. Amendments after the review's CLEAR

The design was reviewed CLEAR at `3af8d30c50`. Each later change is numbered here and is reviewed as a delta before a slice treats it as binding.

1. 2026-11-25, from slice E1a reading the engine: `engine.models.discover` takes a required `provider`; `engine.config.setResource` has a global form with `enabled` and a project-local form with the three override states; `engine.models.list` and `engine.promptSizes` take an optional `setup`, added to their exported signatures in E1a-s; the rule for an operation with gated inputs is one internal core function, exported in E1a without them (6.8, 8).
2. 2026-11-25, from slice P0 reading the dispatch and from two questions it asked. The changed-capability gate has two tiers (7.4). A demonstrated change fails the check. A candidate, where only a closure moved, is a merge requirement a reviewer carries: the author's body line, and the reviewer's `SDK-Parity-Reviewed` line with the digest the check printed at that exact head, without which there is no CLEAR; a verifier and its negative controls test that requirement (7.6). The check becomes a required one after one green day on the base branch. `omo trust ensure` is a capability, `engine.trust.ensure`, not an internal entry (6.7, 8). `--internal-rpc-host-supervisor` is an internal entry serving `daemon.ensure`, and `__kill-guard` serves the launch operations, not a daemon call (6.10). The launch credential is registered as `api_key`, clearable only by slice E1a-s (6.9). In the loop: `checkpoint` carries `advance`, four accepted-and-ignored flags on `create-goals` are adapter parse flags with a scenario, and the five hook entries serve `toolkit.forSession` (6.11).
3. 2026-11-25, from slices P0 and P1a building against the text. Three CLI cells gain `[--all-scope]`, which the dispatch accepts on every thread verb (6.1 read; 6.2 send and close). `thread` is optional on `threads.aliases.set`, as on close and rename, because the tool lets a session omit it (6.2). `install.setup.apply` takes `consent` as `all` or `each`, and the command with neither flag is `all` behind one rendered confirmation (6.7). A row is built only by a record that its scenario ran at the head, and a tool field in a branch's presence condition is required for that branch (7.2).
4. 2026-11-25, from slice E1a-s reading the launch path and from the review of slice E1a. The launch outcome's `session` is optional, with the three cases in which it is present (6.9). A launch function starts the engine entry as a new process with an argv derived from the exported metadata, does not choose a session id for the caller, and delivers the credential input on a private inherited descriptor (6.9). An exported engine function takes no principal and never reads a terminal; an omitted project-trust decision is a typed refusal (6.8).
5. 2026-11-25, from the third review of slice P0. A row's descriptor and its contract annotation are compared separately: an annotation-only change is a candidate, a descriptor change is a demonstrated change whatever it is called, and negative controls pin both directions (7.4, 7.6). A scenario's run builds a row only when the observed effect equals the stated expected effect, whose shape the registry's schema defines once; equality means a complete trace of effect operations, with stimulus kept out of the comparison (7.2). From the fourth review of that slice: on a built row a nested requiredness or shape change needs the reviewer's check of the live schema, not only equal outcomes, and that check holds in both directions: a newly accepted input is a behaviour change as a newly refused one is (7.4, 7.6).
6. 2026-11-25, from slice P1a typing the contracts. Which calls take the wait options, and the registry's record of whether a core honours them today (4.4). Bytes are `Uint8Array` on the root; a fixture reference in the scenario table is not an SDK input form (4.4).
7. 2026-11-25, from slices P0, P1a and E1a-s. What a scenario can state, that the table is the target contract, the closed exemption for three host-local calls, and the closed list of two calls that touch nothing (7.3). A code a shipped call returns is registered even when a later slice removes it (4.4). No result type carries a credential or a transport setting, `engine.models.list` answers a projection, and free user-supplied strings are listed for the session rule (4.5).

## 12. Not in this program

- Step 2 of the 2026-11-10 ruling on #13016: both transports accepting both sender kinds.
- Remote approval-mode enforcement, device enrollment (#14365), configuration editing (#14366) and the session address format of #14044 beyond what section 5 needs. Each has its own issue; this design reserves their SDK names and does not design them.
- The desktop app's own adapters. The app follows the SDK surface this program settles; its migration is tracked in its repository.
- Any change to which capabilities exist or to who may use them. This program moves where they live and adds the SDK calls that are missing; it removes nothing a user can do today and grants nothing a caller cannot do today.
