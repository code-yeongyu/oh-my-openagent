# omo SDK: authority and credential custody (security design)

Slice S0 of #14943. Issue: #14945. Status: security design, under review. No code is part of this document's pull request.

This design is the gate named in the first-party SDK design (#14944, sections 4.3 and 4.5). It covers both editions. No schema, export or adapter that carries a principal, a credential, an endpoint selector or a launch option is fixed before this document's review is CLEAR (that design's slices P1a-s, P1b, T1c's attach, T1e, A1d, A2b, A2c, the daemon's endpoint inputs, E1a-s, OC1b, OC1c). Slices that touch none of those do not wait on it.

The approval is a recorded artifact: the review's verdict comment at an exact head of this document, linked from #14945. The refusal rows of section 4 are reused, unchanged, as acceptance scenarios by every slice they touch.

Source was read at `dev` `2e2a815ac8` and at the engine's `main` `48983b7bf8` on 2026-11-25. Nothing was run, and no privilege or credential experiment was made. Path abbreviations: `N/` = `packages/omo-native/`, `T/` = `packages/omo-senpi/src/components/thread/`, `R/` = `packages/omo-senpi/src/components/remote/`, `S/` = `packages/omo-senpi/src/components/omo-sdk/`, `A/` = `packages/omo-opencode/src/cli/service-auth/`, `E/` = the engine's `packages/coding-agent/src/`.

## 1. What this design must hold

Making the SDK the superset of the CLI puts on an importable surface calls that exist today only as commands a person runs. Four properties are required, and each is a section of this document and a line of the review checklist.

| # | Property | Section |
|---|---|---|
| I1 | No secret is ever a field of a returned value, a failure, a stream event, a receipt or a store row, and none is written to a log, a telemetry event, a crash report, a child process's argv or environment, or a model-facing surface | 5, 6 |
| I2 | Capability per principal: who may run what is decided in the core and behind it, never by an export or an import rule | 3, 4 |
| I3 | Revocation reaches a live SDK instance, an open stream and a handed-over credential, with a stated bound where it cannot be immediate | 7 |
| I4 | Audit trail: every custody-bearing call and every command that crosses a device leaves a record that names who, what, where and the outcome, and never a secret | 8 |
| I5 | No new authority and no lost capability: after the migration each principal can do exactly what it can do today | 4, 9 |
| I6 | A ceremony a person performs stays a ceremony a person performs. A model-driven or unattended process is refused before any secret exists | 5.1 |

## 2. Threat model

### 2.1 Assets

| Asset | Where it lives | What holding it lets a party do |
|---|---|---|
| The account credential of this device: access token, refresh material, device keys, owner proof | The OS credential store, or the opt-in store of `omo account store`; read through `A/session.ts` | Act as this device on the account service and the relay; the stored record is enough to become this device elsewhere |
| The sync recovery phrase and the keys derived from it | Shown once on creation, typed on recovery; never stored in plain form | Decrypt the account's memory |
| Model provider credentials: API keys, OAuth access and refresh tokens | The engine's auth store | Spend the user's provider account |
| MCP OAuth tokens | The MCP client core's token store | Act on the user's behalf against that server |
| Engine endpoint credentials: a terminal endpoint's socket secret, the RPC key root | Files with owner-only modes beside the sockets | Command sessions on this device |
| A device-code user code and matching code, while valid | In memory during a sign-in | Complete a sign-in the person did not intend, if shown to the wrong party |
| Conversation content | Session files, the gateway store | Not a credential; covered by the thread tools' existing scope rules and outside this design except where a control command crosses a device |

### 2.2 Actors

| Actor | Trust |
|---|---|
| The person at the machine, and any process they start as their OS user (the CLI, a script importing the SDK) | Trusted with everything the OS user holds. A script and the CLI are the same actor: a script can already run every `omo` command |
| An agent session: model-driven code running tools, or code a model wrote running in an eval cell | Runs as the same OS user, but its inputs are untrusted text and its outputs go into transcripts. It must not be handed a secret and must not decide a person's ceremony |
| A connector: a program that relays messages from an outside chat into sessions | Trusted to deliver messages under its binding, with the approval mode it was given. Not trusted with the account or the machine |
| The device service: the background process that links this device to the relay | Trusted to run its own bootstrap and to carry commands. Sends no messages of its own |
| Another signed-in device of the same account | Authorized by the account sign-in to view and command this device's sessions while this device's control switch is on. Not authorized to read this device's credentials |
| Another OS user on the machine | Untrusted |
| A party on the network that is not on the account | Untrusted |
| Anything that reads durable or transmitted output: log files, telemetry, crash reports, receipts, transcripts, a model provider | Must never see a secret |

### 2.3 Boundaries

1. **The OS user.** File modes and the credential store guard everything local. The SDK runs inside this boundary.
2. **Process to engine endpoint.** A terminal endpoint requires its socket secret before every request; a host endpoint authenticates the client and fences commands by capability (`T/live-surface.ts:107-180`). The engine's `admitExternalMessage` decides whether an outside message becomes a turn.
3. **Device to relay to device.** Same-account admission, plus the sender kinds each transport accepts.
4. **Device to account service.** The signed-in device's session.
5. **Process to model.** Anything in a tool result, a transcript or a prompt is disclosed to a model provider.

### 2.4 What this design does not defend against

A process running as the same OS user can read the credential store with the same code the CLI uses. The SDK cannot stop it and does not pretend to: a private factory or an import rule is architecture, not a guard. The goals are narrower and checkable: the migration opens no path that does not exist today (I5), no secret reaches a durable or transmitted surface (I1), and the model-facing surfaces gain nothing (I6).

## 3. Principals

A principal is fixed when a root is built. It selects which existing leg a call uses and what it stamps on what it sends; the core checks it against each capability.

| Principal | Who it is | How it is established | On the wire today |
|---|---|---|---|
| `person` | The OS user at this device | The uid of the running process; a person client for any other uid is refused, never silently replaced (`R/port/thread-runtime.ts:36-40`) | `{ kind: "person", uid }` (`R/factories.ts:14-16`); a prompt, never a delivery with an envelope (`T/gateway/types.ts:179-181`) |
| `script` | The same OS user, calling the SDK without a terminal (`createOmoSdk()`, `omo thread`) | The uid of the running process | `cli:<uid>` for a delivery on this device (`T/gateway/types.ts:178`); the person leg for anything that leaves the device, because the engine admits a command-line delivery only from its own machine (`T/sdk.ts:385-390`, `T/remote/relay-transport.ts:899-907`) |
| `connector` | A chat connector, by its relay binding | The binding it was created with (`R/factories.ts:22-24`) | `{ kind: "connector", binding }` |
| `session` | An agent session acting through the thread tools | The durable session id the engine hands a tool in its execution context; never an argument a model supplies (`T/gateway/types.ts:168-170`) | `session:<durable id>` (`R/factories.ts:18-20`) |
| `service` | The device service's own bootstrap entry | Built only by that entry (`R/factories.ts:33-35`) | `{ kind: "service" }` |

`person` and `script` are one actor (2.2). They differ only in the leg a same-device delivery takes. Everything below that says "person" for a non-delivery call applies to a script too, because a script reaches those calls through the person client exactly as `omo thread send` to another device does today.

## 4. Principal by capability

Legend: **A** allow; **R** refuse, with the typed code; **n/a** the call has no meaning for that principal. "Today" cites the rule in the source. Cells marked **new** are decisions of this design, either for calls that have no SDK form yet or for a path no caller can reach today; each is the narrowest rule that keeps I5.

The principal branches in the source are few, and the tables below list all of them: the search for a branch on the sender kind across `R/` and `T/` finds the send identity, `author`, the open rules and the four service mutators in the remote module, and the two transport refusals and the parked intake in the thread core. Where a cell says "no principal check today", the call runs for any client kind.

A connector root and a service root are narrow by construction. A program that holds only a connector root cannot reach the account or the machine through it. This is least privilege for a well-behaved program, not a guard against a hostile one: section 2.4 applies.

### 4.1 Threads

| Capability | person / script | session | connector | service | Enforced at | Today |
|---|---|---|---|---|---|---|
| List, read, entries, get, wait, follow | A | A, within the caller's workspace unless `all_scope` | A (no principal check today) | R **new** (unreachable today: the bootstrap entry calls only `service.bootstrap`) | The thread core's scope rules; the endpoint | `T/` addressing rules; unchanged |
| Read a delivery receipt | A, own deliveries only | A, own deliveries only | A, own deliveries only | n/a | The gateway store, keyed by sender principal | `T/tools.ts:189-208` |
| `self` as an address | R `caller_context_missing` | A | R `caller_context_missing` | n/a | The resolver | `T/sdk.ts:142-146, 305-312` |
| A send that is a reply: resolves only to the sender of the delivery it answers, by exact id or stated name, pinned to that sender's device; the reply grant widens only a scope refusal and only to that sender | n/a (a script holds no reply allowance) | A | n/a | n/a | The resolver's reply policy | `T/tools.ts:583-678` |
| Fuzzy matching of a target | R (exact only) | A for handoff only | R | n/a | The resolver | `T/tools.ts:583-592` |
| Send to a session on this device | A as `cli:<uid>` (a delivery); a person's own prompt is R `unsupported` on the gateway leg and goes through the terminal | A | R `unsupported` (`connector_send`): a connector client cannot send through `sessions.send` yet. The connectors that exist today deliver as a script principal through the thread SDK, and keep doing so | R `sender_not_allowed` | The local transport; the engine's admission | `T/gateway/local-transport.ts:12-20`, `R/sessions.ts:431-451` |
| Send to a session on another device | A as the person's prompt; a `cli` sender is R `unsupported` (`sender_not_allowed`) | A as a delivery | R `unsupported` (`connector_send`), as above | R `sender_not_allowed` | The relay transport; the receiving engine's admission | `T/remote/relay-transport.ts:899-907`, `R/sessions.ts:431-451` |
| A message to a session on the caller's own device through the remote client | A | R: it belongs to the thread tools | R | R | The remote module | `R/sessions.ts:487-490`, `:615` |
| `author` on a send | R `invalid_arguments` | R `invalid_arguments` | A | n/a | The remote module | `R/sessions.ts:468` |
| Create or open a thread | A, in the approval mode it names | A, keeping or narrowing its own mode; wider is R `scope_denied` (`permission_preset_wider`); not told its mode, only `ask` passes | as session | R | The create path | `R/sessions.ts:556-570`, `T/contracts/create-params.ts:92-99` |
| Interrupt, close, set model, set reasoning, rename, archive, handoff | A | A, with the tools' receipts and loop guards | A (no principal check today) | R **new** (unreachable today) | `locateControl`, the endpoint | `T/control/locate.ts`; unchanged |
| Unload | A | R **new** (no tool exists) | R **new** | R **new** | The endpoint | A host-session command only today |
| Attach and answer a pending dialog | A | R | R | R | The remote module's attach | No tool or connector path exists today; **new** as an explicit refusal |
| Registering a store extension, calling one of its operations | A | R **new** (a session calls only declared session operations) | A, as connectors do today | R | The gateway store | `T/gateway/store-extensions.ts:42-60` |
| A store extension's session-callable operation (`sessionOps`, `sessionCall`) | R: the caller is the one the engine resolved, never an argument | A, only as itself | R | R | The gateway store | `T/gateway/store-extensions.ts:107-139` |
| A parked session's intake | n/a | A | R | R | The store worker | `T/gateway/store-worker.ts:134-145` |

### 4.2 Devices, account, device service, sync

| Capability | person / script | session | connector | service | Enforced at | Today |
|---|---|---|---|---|---|---|
| `devices.list`, `account.whoami`, `deviceService.status`, `control()`, `wake()`, `sync.status` (reads) | A | A through the SDK in an eval cell, as shipped | R **new** for the account and sync reads; A for `devices.list` and the service reads (no principal check today) | A for the service reads | The account session; the device service | `S/index.ts`; `R/client.ts:390-427` |
| Any account call under a desktop launch | R `desktop_sign_in` | R `desktop_sign_in` | R | n/a | The account access layer | `S/access.ts` (`blockedReason`) |
| `deviceService.setEnabled`, `setControl`, `setWake` | A | R (not a person) | R | R | The remote module | `R/client.ts:395-431` |
| `deviceService.bootstrap` | A | R | R | A | The remote module | `R/client.ts:411` |
| `devices.rename` | A | A, as shipped in the omo SDK | R | R | The account service | `S/devices/index.ts` |
| `devices.revoke` (never this device; an ambiguous name or prefix revokes nothing; the name as confirmation) | A | R **new** | R **new** | R | The account service, after the core's checks | `N/account-devices.ts:33-101` (a command only today) |
| `account.signIn` | A | A only where the shipped SDK allows it today: it hands the code to a callback a person reads, and never removes a device to make room | R | R | The device flow | `N/account-sign-in.ts:196-203` |
| `account.signOut`, `account.forget` | A | R **new** | R **new** | R | The session | `N/account-cli.ts:147-184` |
| `account.adopt`, `account.credentials.handOver`, `account.store.*`, `account.keys.*` | A | R **new** | R **new** | R | The account core | Commands only today |
| `sync.enable`, `sync.recover` | A only with a controlling terminal and no agent marker in the environment; otherwise R before anything secret exists | R | R | R | The phrase surface | `N/sync-phrase-tty.ts:10-16` |
| `sync.approve`, `sync.disable`, `sync.retirePin` | A | R **new** | R | R | The sync core | Commands only today |

A session can run any `omo` command through a shell today, including the ones marked R **new** above. That path is unchanged by this design: the refusals above mean the migration adds no second, importable path for a session. Whether the existing shell path should be narrowed is section 11, not this migration.

### 4.3 Daemon, diagnostics, install, engine, MCP

| Capability | person / script | session | connector | service | Today |
|---|---|---|---|---|---|
| `daemon.status`, `diagnostics.run`, `install.version`, `config.status`, `engine.schedule.list`, `engine.models.list`, `engine.packages.list` (reads) | A | A, as an eval-cell read | R | n/a | Commands; no principal check exists because only a person could run them |
| `daemon.ensure`, `stop`, `stopAll`, `handoff`, `gc`, `rollbackPrepare`; `diagnostics.fixReflectionLock`, `reapStaleEngines`; `install.update`, `setup.apply`, `cleanup` | A | R **new** | R **new** | R | Same |
| `engine.packages.install`, `remove`, `update`; `engine.config.setResource` | A, with the project-trust choice passed explicitly | R **new** | R **new** | R | Same; the engine's own trust prompt |
| `engine.auth.check` without credentials | A | A | R | R | `E/cli/auth-command.ts` |
| `engine.auth.apiKey`, `bearerToken`, `check` with credentials; `mcp.oauth.login`, `logout` | A | R **new** | R **new** | R | Commands only |
| `engine.schedule.cancel`, `run` | A | R **new**: a session schedules through the engine's own tool | R | R | `E/cli/schedule-command.ts` |

### 4.4 The endpoint selector, launch options and the OpenCode edition

| Capability | person / script | session | connector | service | Today |
|---|---|---|---|---|---|
| The root's `endpoint` selector (`socket`, `key_root`) and the host options of `daemon.ensure`, `stop`, `handoff` | A. The selector names paths; the transport reads the credential under `key_root` and never returns it | R **new**: a session reaches its own host through the engine, and the thread tools take no endpoint | R **new** | R | `--socket`, `--rpc-key-root` on the engine's host commands (`E/cli/host-command-args.ts:71-125`); commands only |
| `engine.launch.interactive`, `print`, `rpc`, `hand`, `headless` | A | R **new**: a session starts other sessions through `threads.create` and its task tools, within its own approval mode | R **new** | R | Launch flags; commands only |
| `spawned_by` (ancestry) on a launch | A only from the engine's own task host, which sets it today; any other caller R **new** | R | R | R | `--spawned-by` (`E/cli/args.ts`) |
| `project_trust` on a launch or a package call | A, passed explicitly, never defaulted to trust | R **new** | R | R | `--approve`, `--no-approve` |
| A provider API key as a launch input | A, through the carrier of 5.5 | R **new** | R | R | `--api-key` |
| `threads.runToCompletion` (OpenCode edition) | A | R **new** | R | R | That edition's `run` command |
| `on_complete` on `runToCompletion`: runs a command as the caller's OS user | A | R **new** | R | R | `--on-complete` |
| `install.plugin`, `install.cleanup`, `config.migrate`, `worktrees.sweep` with `apply` | A | R **new** | R | R | That edition's commands |
| `mcp.oauth.login`, `logout`; `account.keys.init` | A | R **new** | R | R | That edition's commands |
| `mcp.oauth.status`, `account.keys.status`, `boulder.status`, `install.localVersion`, `worktrees.sweep` as a plan (reads) | A | A, as an eval-cell read | R | R | That edition's commands |

Every R is a typed refusal (`sender_not_allowed`, or the code cited), answered before any side effect, and each is a scenario of the conformance test in the first-party design, section 7.3.

### 4.5 Compatibility: every present caller and surface

The matrix above is by principal. This table is by the callers that exist today, and says what each keeps. Nothing in it is narrowed.

| Caller today | Surface it uses | Principal after | What it keeps |
|---|---|---|---|
| A person at a terminal | The native CLI, both verb families | person | Every verb, flag and exit code |
| A script or cron job | `omo thread`, `createThreadSdk` | script | The facade's signature and results; `cli:<uid>` on this device and the person leg across devices |
| A chat connector | `createThreadSdk().send`, store extensions | script today; a connector root only where it opts in | Its delivery path and its extension's operations |
| An agent session | The eleven thread tools, `ext_*` tools, the omo SDK in an eval cell, a shell | session for the tools; script for an SDK it builds in an eval cell | The tools' contracts; the shipped SDK calls it can make today; its shell |
| The desktop app | Its own adapters over the engine, `omo account` verbs for hand-over | person, through the CLI it runs | `token`, `export`, `adopt`, `retire-sync` as it calls them today |
| The device service | Its bootstrap entry | service | `service.bootstrap` |
| The omo-harness skill | `createThreadSdk`, `createOmoSdk().devices.list`, a CLI call for the rest | script | As a script |
| A person or script on the OpenCode edition | That edition's CLI | person or script | Every verb, flag and exit code of that edition |

An agent session that builds its own root in an eval cell is a script principal: it runs as the OS user (2.4). The session principal exists so that the thread tools carry the engine-resolved caller; it is not a sandbox, and this design does not present it as one.

## 5. Custody

One rule first: **the destination of a secret is fixed by the core, or it is a handle the caller already holds and nothing else.** A call never returns a secret, and a caller never names an arbitrary function for the core to pass one to where a narrower destination exists.

### 5.1 The sync recovery phrase

The first-party design proposed a caller-supplied sink for the phrase. This design rejects that. The source already has the right rule: the only phrase surface is the controlling terminal, opened directly; words are written there and nowhere else, never stdout, stderr or a logger, and typed there with echo off; argv, env, stdin and pipes are never read for them; an agent harness or CI is refused before anything secret exists (`N/sync-phrase-tty.ts:10-16`).

- `sync.enable({ onCode, confirm, signal? })` and `sync.recover({ confirm, signal? })` take no phrase argument and no phrase sink. The core owns the phrase terminal as a port. The call answers the ceremony's outcome only.
- Eligibility is checked before a phrase exists (`N/sync-cli.ts:76-113`). A process with an agent marker in its environment, or with no controlling terminal, gets a typed refusal that says the person must run it themselves.
- The CLI verb is an adapter over this call. The SDK is the superset because the call exists; it is not because the phrase becomes available to the caller.
- The recovery engine is the one under review in #14464. This design adds no second one.
- Tests replace the terminal port with a fake that records what was written to it; the non-disclosure test (section 6) asserts the phrase appears on the fake terminal and nowhere else.

### 5.2 The account access token and the stored credential

`omo account token` prints the access token with its expiry, the device and the owner; `omo account export` prints the whole stored credential (`N/account-cli.ts:118-146`). Both exist so that another of our own processes can take over a sign-in.

- `account.credentials.handOver({ what, to })`. `to` is a writable handle the caller already holds: a pipe or a file descriptor. The core writes the same JSON record the verb prints today to that handle and to nothing else. The call returns the non-secret part: `{ delivered: true, device, expires_at, owner? }`.
- Principals: person and script only (4.2). A session or a connector is refused before the credential store is read.
- Checks before the store is read: the root is open, the launch is not a desktop launch, the principal is allowed, the handle is writable. A failed check reads nothing.
- Partial outcomes: the record is written in one write. If the write fails, the call answers a failure whose message is the core's own words, and the audit record (section 8) says `not_delivered`. The failure never quotes what was written.
- `export` moves refresh material and device keys: whoever holds it can become this device. This design keeps it because the CLI has it (I5) and lists a narrowing in section 11.

### 5.3 A handed-over sign-in

`account.adopt({ credential, replace? })` reads the credential from a readable handle, never from a string argument or the environment. The rules stay today's: a different device already signed in is a conflict unless `replace`; a current credential with a later expiry is kept (`N/account-cli.ts:86-110`). The result names the device and the storage and nothing else.

### 5.4 The device-code sign-in

The `code` event carries the verification URL, the user code, the matching code and the expiry (`N/account-sign-in.ts:37-59`). A person has to see them, so they go to the `onUserCode` callback and only there: not into the result, not into a log, not into a failure. The result is the `signed_in` event's content: api, device, replaced device, device-service outcome. The event order `ready`, `code`, `signed_in` or `refused` is part of the contract. The SDK never removes a device to make room; the list goes back to the caller with the refusal (`N/account-sign-in.ts:196-203`). A lower-layer error's text is not passed on, because a service or store message can carry a credential (`S/access.ts`, `failure`).

When a session calls `account.signIn` (allowed today), the codes reach its callback and therefore that session's context. That is today's behaviour of the shipped SDK and is unchanged; section 11 lists it.

### 5.5 Model provider and MCP credentials

- `engine.auth.apiKey`, `engine.auth.bearerToken` and `engine.auth.check` with credentials write to a handle the caller holds, as 5.2, and return non-secret metadata (provider, model, expiry, whether a refresh ran). `check` without credentials returns status only.
- A provider API key given at launch (`--api-key`) is an input: it is read from a readable handle or the environment the engine already reads, never accepted as a field that a list row, a `threads.get` answer, a receipt or a log would echo.
- `mcp.oauth.login` runs the browser flow and stores tokens in the MCP client core's store; `status` returns non-secret state; `logout` removes the tokens. No call returns a token.

### 5.6 Engine endpoint credentials

The root's `endpoint` selector names paths (a socket, a key root), never contents. The transport port reads a socket secret and sends it; no result, failure or diagnostic names it. `daemon.status` and `diagnostics.run` report whether a credential file exists and whether its mode is safe, not what it holds.

### 5.7 Account keys

`account.keys.init` creates this device's keyring in the OS key store; `status` and `init` answer the device id and the public signing and sealing keys only, as the verb does today.

## 6. The non-disclosure test

Every slice that adds a call of section 5 ships this test, and slice P1b ships it for the whole root.

- Fake ports hold recognizable canaries, one per asset of 2.1: an access token, a refresh token, a private key, a recovery phrase, a provider API key, an OAuth token, a socket secret, a user code.
- Each call of the namespace is driven through its ok path, each refusal of section 4, and one injected fault per step (a store that locks, a 401, a write that fails halfway, a cancelled signal).
- The scan covers: the returned value; the failure; every stream event; every gateway store row and receipt the call wrote; everything written to the logger port and the telemetry port; the message of any thrown error that the boundary caught; the argv and environment of any child process the call started; the tool result where a tool exists; the CLI's stdout and stderr, except the one designated handle of a hand-over verb.
- A canary anywhere outside its designated destination fails the test. The designated destinations are exactly: the phrase terminal (5.1), the caller's handle (5.2, 5.5), the `onUserCode` callback (5.4), the credential store.

The existing scan (`S/omo-sdk.test.ts:76-82`, asserted at `:118-129` and `:151-158`) is the starting point; it covers returned values of four calls today.

## 7. Revocation

| Event | Effect on the SDK | Typed outcome | Bound |
|---|---|---|---|
| This device signs out or forgets its sign-in (`account.signOut`, `forget`) | Device keys are discarded through the session's hook, the sync pin is retired, the device service is told to forget (`N/account-cli.ts:147-184`, `A/session.ts`). A root holds no copy of a token: every account call goes through the session | `signed_out` on the next call | Immediate for new calls |
| Another device revokes this one (`devices.revoke`) | The account service ends this device's sign-in | `session_ended` on the next call (`S/access.ts`); a stream ends with one terminal failure event, never a silent stop | The next request to the service; a refresh in flight settles as today's recovery rules say |
| A handed-over access token (5.2) after a revoke or sign-out | It cannot be recalled. It stops working when the service rejects it or at `expires_at`, which the call returned | n/a | The access token's lifetime. The review confirms that number against the service; a handed-over stored credential is bounded only by the device's revocation |
| This device turns its control switch off (`deviceService.setControl(false)`) or turns remote sessions off | Other devices can no longer view or command its sessions | Their calls answer the relay's typed refusal; an open attach must end with one terminal event (`channel_lost` or `session_closed`), which the slice's test asserts | Immediate at the device service |
| The wake switch is turned off | A message from another device no longer starts a session that is not running | `queued_offline` with `wake: "none"` | Immediate |
| An attach ends or its connection drops | The endpoint it served closes | A later use of that endpoint fails closed | Immediate |
| A root is closed | Requests in flight are aborted; later account and device calls answer `internal_error` naming a closed instance (`S/access.ts`) | as stated | Immediate |
| A connector's binding is removed | Its client's calls are refused by the relay | The relay's typed refusal | At the relay; this design adds no cache that outlives it |

Rules for the implementation: no namespace caches an access token, a device row's authorization or a control-switch state across calls beyond what the session and the remote module already hold; a cached listing is used for addressing only and never as proof that a command is allowed; and each event above has a test that drives a live root and an open stream through it on the virtual clock.

## 8. Audit trail

### 8.1 What is recorded today

- **Deliveries.** Every send writes a gateway row and a receipt with the sender principal, the target, the lane and the outcome, kept 30 days (`T/` budgets: receipts and delivered rows). The delivered message carries a provenance header naming where it came from (`T/gateway/provenance.ts`).
- **Creation.** A created thread records its creator when a session created it; a script records none (`T/sdk.ts:178-181`).
- **Commands to another device.** Each carries a command id and its state events through the relay (`R/types.ts`, `CommandStateEvent`).
- **Account.** The account service keeps the device list with last-seen times.

### 8.2 What this design adds

1. **A local custody log.** One append-only file in the account home, owner-only, one JSON line per custody-bearing call (every call of section 5, plus `devices.revoke`, `account.signOut` and `forget`): time, principal kind and id, capability, target device, outcome code. Never a value, a code or a handle's content. The line is written before the secret moves; if it cannot be written, a hand-over call fails closed and moves nothing. Kept 90 days, pruned on write.
2. **Cross-device control is attributable on the target.** A control command that arrives from another device (interrupt, close, unload, set model, set reasoning, rename, archive, attach, an answered dialog) leaves a record on the device that ran it, naming the sender principal, the sending device and the command id. Slice T1b verifies with a test which of these the engine and the device service already record and adds what is missing; a command that changes a session with no such record does not pass.
3. **A read call.** `account.audit.list({ since? })`, person and script only, returns the custody log's lines.

No audit record is a place a secret can land: the non-disclosure test of section 6 scans the custody log and the control records too.

## 9. What each slice must show

| Slice | Before it starts | In its pull request |
|---|---|---|
| P1a-s and P1b (the sensitive contracts, the root and principals) | This design CLEAR | The matrix of section 4 as conformance scenarios, one per R cell; the non-disclosure test over every namespace present; the revocation tests of section 7 for the calls it wires |
| A1d (adopt, hand-over) | This design CLEAR | 5.2 and 5.3; the custody log; the fail-closed test |
| A1b, A1c (sign-out, forget, revoke) | none beyond P1b | The custody log lines; the R cells for session and connector |
| A2b, A2c (sync) | This design CLEAR | 5.1 with the fake phrase terminal; the agent-marker and no-terminal refusals before any secret exists |
| E1a-s for the launch options, the endpoint options and provider credentials; OC1b for `on_complete`; OC1c for MCP OAuth and account keys | This design CLEAR | 4.4, 5.5 and 5.7 |
| T1c for attach and answering a dialog; T1e for the extension session operations | This design CLEAR | The refusal rows of 4.1 for every principal but the allowed one |
| T1b (control calls) | none beyond P1b | 8.2 item 2 |

## 10. Rollout and rollback

- **Order.** Reads and refusals first: the root ships with the matrix's refusals and the non-disclosure test before any custody-bearing call exists. Each custody-bearing call then ships in its own slice, behind its CLI verb, which keeps working unchanged until the adapter over the SDK passes the same goldens.
- **Entry criteria for a custody slice.** This design CLEAR; the fake ports and canaries of section 6 in place; the custody log writable in the slice's tests; the slice's refusal rows listed in its issue.
- **Exit criteria.** The non-disclosure test passes over the new call and over the whole root; the revocation tests of section 7 pass with the call in use; the audit line is asserted; the CLI verb's golden output and exit code are unchanged.
- **Rollback.** Rollback is reverting the adapter's pull request, which restores the verb's own body. A rollback never leaves a custody-bearing SDK call exported without its checks; the call and its adapter revert together.
- **Stop conditions.** A canary found outside its destination, a refusal row that passes where it must refuse, or an audit line missing for a moved secret stops the rollout of that slice and of every slice that depends on it.

## 11. Decisions this design does not make

Each of these would change what a principal can do today, so none is part of the parity migration (I5). They are listed for the owner, and none blocks a slice.

1. **Narrowing `export`.** Replace the standalone stored-credential export with a paired hand-over that only another `adopt` on the same machine can consume.
2. **Refusing the hand-over verbs under an agent marker**, as the sync ceremony already does. Today a session can run `omo account token` through a shell.
3. **`account.signIn` from a session.** The shipped SDK allows it and the codes reach the session's callback. Refusing it, or routing the codes to a person-only surface, would be a behaviour change.
4. **The access token's lifetime** as the bound of a hand-over's revocation: confirm the number, and decide whether a hand-over should request a shorter-lived token.

## 12. Review checklist

| Checklist line | Where it is answered | How a slice proves it |
|---|---|---|
| No secret is ever returned to a caller or written to a log | I1; sections 5 and 6 | The non-disclosure test with canaries over results, failures, events, receipts, store rows, logs, telemetry, child argv and env, tool results and CLI output |
| Capability per principal | I2; sections 3 and 4 | One conformance scenario per refusal cell; the principal is checked in the core before any side effect |
| Revocation | I3; section 7 | One test per event on a live root and an open stream, on the virtual clock |
| Audit trail | I4; section 8 | The custody log line asserted for every custody-bearing call, written before the secret moves; the control record asserted on the target device |
