# omo SDK: authority and credential custody (security design)

Slice S0 of #14943. Issue: #14945. Status: security design, under review. No code is part of this document's pull request.

This design is the gate named in the first-party SDK design (#14944, sections 4.3 and 4.5). It covers both editions. No schema, export or adapter that carries a principal, a credential, an endpoint selector or a launch option is fixed before this document's review is CLEAR (that design's slices P1a-s, P1b, T1c's attach, T1e, A1d, A2b, A2c, the daemon's endpoint inputs, E1a-s, OC1b, OC1c). Slices that touch none of those do not wait on it.

The approval is three recorded artifacts, each at an exact revision and each linked from #14945: the design review's verdict on this document; the independent review of the closed per-operation matrix, which lives in the private security-review record and is linked by number only; and the security owner's approval of the custody matrix (5.0) and of every decision in section 11 that changes behaviour. S0 is CLEAR only when all three exist for the same revision. If a decision changes this document, that delta is reviewed before the gate is marked. The refusal rows of section 4 are reused, unchanged, as acceptance scenarios by every slice they touch.

Source was read at `dev` `2e2a815ac8` and at the engine's `main` `48983b7bf8` on 2026-11-25. Nothing was run, and no privilege or credential experiment was made. Path abbreviations: `N/` = `packages/omo-native/`, `T/` = `packages/omo-senpi/src/components/thread/`, `R/` = `packages/omo-senpi/src/components/remote/`, `S/` = `packages/omo-senpi/src/components/omo-sdk/`, `A/` = `packages/omo-opencode/src/cli/service-auth/`, `E/` = the engine's `packages/coding-agent/src/`.

## 1. What this design must hold

Making the SDK the superset of the CLI puts on an importable surface calls that exist today only as commands a person runs. Six properties are required. The first four are the lines of the review checklist.

| # | Property | Section |
|---|---|---|
| I1 | Non-disclosure. Outside an authorized custody operation (defined below), no secret is ever a field of a returned value, a failure, a stream event, a receipt or a store row, and none is written to a log, a telemetry event, a diagnostic or crash report, a child process's argv or environment, standard output or error, or a model-facing surface. Inside one, the secret goes to that operation's one approved destination and to nothing else in this list. Where that destination is a terminal, the guarantee has a stated boundary: the core writes the value there only after the terminal check of 5.2 admits it, and the residuals of 2.4 are outside I1 | 5, 6 |
| I2 | Capability per principal: who may run what is decided in the core and behind it, never by an export or an import rule | 3, 4 |
| I3 | Revocation reaches a live SDK instance, an open stream and a handed-over credential, with a stated bound where it cannot be immediate | 7 |
| I4 | Audit trail: every custody-bearing call and every command that crosses a device leaves a record that names who, what, where and the outcome, and never a secret | 8 |
| I5 | No new authority and no lost capability: after the migration each principal can do exactly what it can do today. The one exception is a narrowing the security owner decides and section 11 records; the migration itself never narrows | 4, 9, 11 |
| I6 | A ceremony a person performs stays a ceremony a person performs. A model-driven or unattended process is refused before any secret exists | 5.1 |

One definition is used by every section. An **authorized custody operation** is an operation listed in the custody matrix of section 5.0, and nothing else. For each, the matrix fixes the secret, the one destination and who owns it, who is authorized to receive it, the minimum data that moves, and what happens when the transfer fails or is cancelled. Moving a secret by any path that is not a row of that matrix violates I1, whatever a compatibility note elsewhere says, and no row may permit general-purpose disclosure. The matrix needs the security owner's approval as a whole; a row is not approved by this document's review alone.

Everything this document calls a test is a requirement on a future slice. None of it is evidence yet, and section 12 says what evidence each invariant needs.

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

Three residuals at the display destinations. Two custody operations may print a credential on a terminal, and only after the terminal check of 5.2 admits it; one may show the recovery phrase in the desktop app's window. The checks do not establish that a person is there, and three classes stay outside what this design guarantees, on the ground of the paragraph above (a same-user process can read the store without any terminal):

1. A process of the same user that sets out to own or drive an admitted terminal. The independent review measured two forms with a synthetic canary and no person present. Against the first ruling, a detached launcher opened a pseudo-terminal, read the confirmation code from its master side and typed it back. The positive list refuses that launcher unless it hides its hold. Against the positive list, a launcher that makes itself unreadable is invisible as a holder, so with a listed host as the visible holder it reads the code and the value. The class also includes a listed emulator the process started and scripts, and OS automation of one.
2. What happens after the print on an admitted terminal: a session recorder the person runs, a screen capture, the person pasting the value. The alternate screen and the wipe remove scrollback from this list where the terminal honours them.
3. Screen or accessibility access to the desktop app's window that the person granted to a third-party tool. Access our own product gives an agent is not in this residual: it is inside the guarantee (5.1).

These are residual risks and not claims. I1 does not cover them, no test of section 6 is evidence about them, and no sentence of this document says a printed value stays unread by a model. They stand only with two acceptances, each recorded with the identity of the session that gave it, because both parties post from one shared account: the security owner's and the independent private reviewer's. Both are recorded in the private record at this revision. They are acceptances of the end state: section 10 says what is in force before a hold lifts, and nothing in this document claims the guarantee in a held context. This design is not approved until both are recorded. If the second is withheld, the terminal stops being a destination and both operations deliver only through the protected delivery; section 11 records that alternative.

### 2.5 Which component guarantees what

| Property | Guaranteed by | Not guaranteed by |
|---|---|---|
| A credential at rest is readable only by the OS user | The OS credential store and file modes | The SDK |
| A request to the account service is from a signed-in device | The account service, checking the device's session | The SDK, which only presents the session |
| A command reaches another device only from a device of the same account, in a sender kind that transport accepts | The device service and the relay | The SDK |
| An outside message becomes a turn only when the engine admits it | The engine's admission | The SDK or an adapter |
| A principal is refused a capability it lacks | The core that implements the capability, before any side effect | An export, an import rule, or the adapter |
| No secret appears in a result, a log or a record | The core's custody rules, checked by the non-disclosure test | A reviewer's reading alone |
| An OAuth or provider token is valid and scoped | The provider or the MCP server that issued it | omo |

The SDK depends on these components and trusts them as the CLI does today: the OS credential store, the account service, the relay and device service, the engine, and for MCP the server's own authorization service. A test that drives the SDK against fakes shows the SDK's part of a property. It is not proof of a property another component controls, and no acceptance row in this document claims otherwise.

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

The principal branches in the source are few, and the tables below list all of them: the search for a branch on the sender kind across `R/` and `T/` finds the send identity, `author`, the open rules and the four service mutators in the remote module, and the two transport refusals and the parked intake in the thread core. Where a cell says "no principal check today", the call runs for any client kind. That describes the code and restricts nobody: a session reaches any verb through its shell (the note under 4.2), so the absence of a check is never evidence that a principal needs the call.

A connector root and a service root are narrow by construction. A program that holds only a connector root cannot reach the account or the machine through it. This is least privilege for a well-behaved program, not a guard against a hostile one: section 2.4 applies.

**Status of the tables below.** They are a grouped summary for readers, and no approval rests on a grouped row. The authoritative artifact is the closed per-operation matrix for both editions: one row per operation of the first-party design's section 6, with the callers that exist today, the authority that is effective today, today's outcome, the proposed outcome, the component that enforces it, and the compatibility evidence, for every allowed and every refused outcome and every operation-specific condition. A cell whose current behaviour is not shown by a source line is marked unproven there, and an unproven cell is not approved. Cells for operations that do not exist yet are proposals and are marked as such. No new authority and no narrowing of a capability a caller has today is inferred from how a root is constructed or from what an entry exports. That matrix, with its independent review, is kept in the private security-review record and is not published here; this document's review does not certify it.

### 4.1 Threads

| Capability | person / script | session | connector | service | Enforced at | Today |
|---|---|---|---|---|---|---|
| List, read, entries, get, wait, follow | A | A. The workspace is the default scope and not a boundary: `all_scope` is an input the session supplies itself | R **new**: no caller today is a connector root; the connectors that exist act as script principals (4.5) and keep these reads that way | R **new** (unreachable today: the bootstrap entry calls only `service.bootstrap`) | The thread core's scope rules; the endpoint | `T/sdk.ts:56, :100, :222-233`; unchanged |
| Read a delivery receipt | A, own deliveries only | A, own deliveries only | A, own deliveries only | n/a | The gateway store, keyed by sender principal | `T/tools.ts:189-208` |
| `self` as an address | R `caller_context_missing` | A | R `caller_context_missing` | n/a | The resolver | `T/sdk.ts:142-146, 305-312` |
| A send that is a reply: resolves only to the sender of the delivery it answers, by exact id or stated name, pinned to that sender's device; the reply grant widens only a scope refusal and only to that sender | n/a (a script holds no reply allowance) | A | n/a | n/a | The resolver's reply policy | `T/tools.ts:583-678` |
| Fuzzy matching of a target | R (exact only) | A for handoff only | R | n/a | The resolver | `T/tools.ts:583-592` |
| Send to a session on this device | A as `cli:<uid>` (a delivery); a person's own prompt is R `unsupported` on the gateway leg and goes through the terminal | A | R `unsupported` (`connector_send`): a connector client cannot send through `sessions.send` yet. The connectors that exist today deliver as a script principal through the thread SDK, and keep doing so | R `sender_not_allowed` | The local transport; the engine's admission | `T/gateway/local-transport.ts:12-20`, `R/sessions.ts:431-451` |
| Send to a session on another device | A as the person's prompt; a `cli` sender is R `unsupported` (`sender_not_allowed`) | A as a delivery | R `unsupported` (`connector_send`), as above | R `sender_not_allowed` | The relay transport; the receiving engine's admission | `T/remote/relay-transport.ts:899-907`, `R/sessions.ts:431-451` |
| A message to a session on the caller's own device through the remote client | A | R: it belongs to the thread tools | R | R | The remote module | `R/sessions.ts:487-490`, `:615` |
| `author` on a send | R `invalid_arguments` | R `invalid_arguments` | A | n/a | The remote module | `R/sessions.ts:468` |
| Create or open a thread | A, in the approval mode it names | A, keeping or narrowing its own mode; wider is R `scope_denied` (`permission_preset_wider`); not told its mode, only `ask` passes | as session | R | The create path | `R/sessions.ts:556-570`, `T/contracts/create-params.ts:92-99` |
| Interrupt, close, set model, set reasoning, rename, archive, handoff | A | A on any thread the session can address, with the tools' receipts and loop guards. `self` is an address only a session can use; it is not a limit on which thread a session may control | R **new**, for the same reason as the reads: a connector that is refused a send does not get close, set model, archive or handoff | R **new** (unreachable today) | `locateControl`, the endpoint | `T/control/locate.ts`, `T/sdk.ts:301-312`; unchanged |
| Unload | A | R **new** (no tool exists) | R **new** | R **new** | The endpoint | A host-session command only today |
| Attach and answer a pending dialog | A | R | R | R | The remote module's attach | No tool or connector path exists today; **new** as an explicit refusal |
| Registering a store extension, calling one of its operations | A | R **new** (a session calls only declared session operations) | R **new** for a connector root; the connectors that exist register as script principals and keep doing so | R | The gateway store | `T/gateway/store-extensions.ts:42-60` |
| A store extension's session-callable operation (`sessionOps`, `sessionCall`) | R: the caller is the one the engine resolved, never an argument | A, only as itself | R | R | The gateway store | `T/gateway/store-extension-ops.ts:165-173` (the public channel answers `caller_not_allowed`) |
| A parked session's intake | n/a | A | R | R | The store worker | `T/gateway/store-worker.ts:134-145` |

### 4.2 Devices, account, device service, sync

| Capability | person / script | session | connector | service | Enforced at | Today |
|---|---|---|---|---|---|---|
| `devices.list`, `account.whoami`, `deviceService.status`, `control()`, `wake()`, `sync.status` (reads) | A | A through the SDK in an eval cell, as shipped, for `devices.list` and `account.whoami`. Each other account read is A only once its output is shown to hold no credential | R **new** for the account and sync reads and for `devices.list`; A for the service reads (no principal check today) | A for the service reads | The account session; the device service | `S/index.ts`; `R/client.ts:390-427` |
| Any account call under a desktop launch | R `desktop_sign_in` | R `desktop_sign_in` | R | n/a | The account access layer | `S/access.ts` (`blockedReason`) |
| `deviceService.setEnabled`, `setControl`, `setWake` | A | R (not a person) | R | R | The remote module | `R/client.ts:395-431` |
| `deviceService.bootstrap` | A | R | R | A | The remote module | `R/client.ts:411` |
| `devices.rename` | A | A, as shipped in the omo SDK | R | R | The account service | `S/devices/index.ts` |
| `devices.revoke` (never this device; an ambiguous name or prefix revokes nothing; the name as confirmation) | A | R **new** | R **new** | R | The account service, after the core's checks | `N/account-devices.ts:33-101` (a command only today) |
| `account.signIn` | A | A only where the shipped SDK allows it today: it hands the code to a callback a person reads. The shipped call can remove a device: it takes `replace`, which replaces this machine's earlier device. `replace` from a session is R **new**, decided by the security owner (section 11) | R | R | The device flow | `S/account/sign-in.ts:16-17, :98`; `N/account-sign-in.ts:196-205` |
| The account service origin on any account call | A, as today: the caller supplies it | R **new**: a session's call uses the configured origin | R | R | The account access layer | `S/access.ts:44-45, :94-100` |
| `account.signOut`, `account.forget` | A | R **new** | R **new** | R | The session | `N/compile-entry.ts:184` (sign-out), `N/account-cli.ts:147-184` (forget) |
| `account.adopt`, `account.credentials.handOver`, `account.store.*`, `account.keys.*` except `account.keys.status` (4.4: it reports state and no key material) | A | R **new** | R **new** | R | The account core | Commands only today |
| `sync.enable`, `sync.recover` | A only where the terminal check of 5.2 admits the terminal (**new**: today's gate is a terminal that opens and no agent marker in the environment); otherwise R before anything secret exists | R | R | R | The phrase surface | `N/sync-phrase-tty.ts:15, :27-39`; `N/sync-cli.ts:83` |
| `sync.approve`, `sync.disable`, `sync.retirePin` | A | R **new** | R | R | The sync core | Commands only today. What makes the caller of `approve` a person is not shown by a source line yet |
| `account.audit.list` (8.2) | A **new** | R **new** | R **new** | R **new** | The account core | Does not exist today |
| Changing the peer allowlist or the named principals for credential return | R **new**: the list ships with the build; no caller enrols a peer | R **new** | R **new** | R **new** | The account core | Does not exist today |

A session can run any `omo` command through a shell today, including the ones marked R **new** above. That path is unchanged by this design: the refusals above mean the migration adds no second, importable path for a session. Whether the existing shell path should be narrowed is section 11, not this migration.

### 4.3 Daemon, diagnostics, install, engine, MCP

| Capability | person / script | session | connector | service | Today |
|---|---|---|---|---|---|
| `daemon.status`, `diagnostics.run`, `install.version`, `config.status`, `engine.schedule.list`, `engine.models.list`, `engine.packages.list` (reads) | A | A, as an eval-cell read, once a canary scan shows the call's output cannot carry a credential: a config value, a package source, a registry entry or a server URL can embed one | R | n/a | Commands; no principal check exists today, which restricts nobody |
| `daemon.ensure`, `stop`, `stopAll`, `handoff`, `gc`, `rollbackPrepare`; `diagnostics.fixReflectionLock`, `reapStaleEngines`; `install.update`, `setup.apply`, `cleanup`; `install.setup.detect` and `setup.plan`, which read what a setup would import, a pending provider key among it, though they print none; `engine.trust.ensure` (it writes the trust store and can take a lease for another process) | A | R **new** | R **new** | R | Same; `N/trust-stage.ts:68-91` for the last |
| `engine.packages.install`, `remove`, `update`; `engine.config.setResource` | A, with the project-trust choice passed explicitly | R **new** | R **new** | R | Same; the engine's own trust prompt |
| `engine.auth.check` without credentials | A | A, status only. The check refreshes an expired token by default, which writes the auth store; for a session the refresh is forced off **new**, so its call is a read. A session's answer carries exactly three things: whether an account is signed in, its provider, and status codes from a closed set. No text a provider returned reaches a session, because a provider's string can echo a fragment of a key: not its error text, not the account's email and not its organisation name, which stay on the answer a person or a script receives. That is the contract, and a contract is not the proof. The non-disclosure claim rests on evidence, at the slice's exact head and re-run by a reviewer who is not the author: a canary planted in turn in every field of the provider's response that the engine reads, a key-shaped address in the email field among them, appears in no field of the session's answer | R | R | `E/cli/auth-command.ts` |
| `engine.models.discover` | A | R **new** until its output passes the same canary scan: it is a network call made with a provider credential, not a plain read | R | R | `E/cli/models-command.ts` |
| `engine.auth.apiKey`, `bearerToken`, `check` with credentials; `mcp.oauth.login`, `logout` | A | R **new** | R **new** | R | Commands only |
| `engine.schedule.cancel`, `run` | A | R **new**: a session schedules through the engine's own tool | R | R | `E/cli/schedule-command.ts` |

### 4.4 The endpoint selector, launch options and the OpenCode edition

| Capability | person / script | session | connector | service | Today |
|---|---|---|---|---|---|
| The root's `endpoint` selector (`socket`, `key_root`) and the endpoint options (the same `socket` and `key_root`) of `daemon.ensure`, `stop`, `handoff` | A. The selector names paths; the transport reads the credential under `key_root` and never returns it | R **new**: a session reaches its own host through the engine, and the thread tools take no endpoint | R **new** | R | `--socket`, `--rpc-key-root` on the engine's host commands (`E/cli/host-command-args.ts:71-125`); commands only |
| `engine.launch.interactive`, `print`, `rpc`, `hand`, `headless` | A | R **new**: a session starts other sessions through `threads.create` and its task tools, within its own approval mode | R **new** | R | Launch flags; commands only |
| `spawned_by` (ancestry) on a launch | A only from the engine's own task host, which sets it today; any other caller R **new** | R | R | R | `--spawned-by` (`E/cli/args.ts`) |
| `project_trust` on a launch or a package call | A, passed explicitly, never defaulted to trust | R **new** | R | R | `--approve`, `--no-approve` |
| The presenter inputs of `engine.launch.rpc` and of the host's ensure and handoff (`bootstrap_fd`, `enforcement`) | A only from the launcher that starts a host today. Proposed here and unproven until the closed matrix cites its enforcement | R **new** | R | R | `--mcp-presenter-fd`, `--mcp-presenter-enforcement` (`E/cli/args.ts:347-351`) |
| `codex_autonomous` on `install.plugin`: `true` configures that platform's autonomous permissions, `false` leaves existing settings unchanged, absent takes the mode's default | A | R **new** | R | R | `C/cli-program.ts:74-76`, `C/install-validators.ts:244` |
| `toolkit.forSession({ cwd, session_id? })`: binding the loop operations to one loop session | A for the session it names, as the `--session-id` flag and the session environment allow today | A only for its own session, with the id from the engine and never from an argument | R | R | The loop component's scope resolution (`packages/omo-codex/plugin/components/ulw-loop/src/cli-commands.ts:110-131`) |
| A provider API key as a launch input | A, through the carrier of 5.5 | R **new** | R | R | `--api-key` |
| `threads.runToCompletion` (OpenCode edition) | A | R **new** | R | R | That edition's `run` command |
| `on_complete` on `runToCompletion`: runs a command as the caller's OS user | A | R **new** | R | R | `--on-complete` |
| `install.plugin`, `install.cleanup`, `config.migrate`, `worktrees.sweep` with `apply`; `config.modelCapabilities.refresh` (it writes a cache and fetches from a URL the caller may supply) | A | R **new** | R | R | That edition's commands |
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

### 5.0 The custody matrix

Every authorized custody operation, and only these. The subsections that follow give the details of each.

| Operation | Secret | The one destination, and its owner | Who may receive it | Minimum data | Failed or cancelled |
|---|---|---|---|---|---|
| `sync.enable` | The recovery phrase, at creation | The controlling terminal of the calling process, where the terminal check of 5.2 admits it. Where it does not, the desktop app's own window (5.1) | Whoever reads that terminal or that window | The phrase, shown once | Nothing is shown before eligibility passes; a cancel after display voids the ceremony as it does today |
| `sync.enable` through the desktop app (5.1) | The recovery phrase, at creation | The desktop app's own window, opened on a person's gesture inside the app; refused where our own product has given an agent screen or accessibility access to it | Whoever reads that window | The phrase, shown once | Nothing is shown before the audit `started` record is written; a cancel voids the ceremony |
| `sync.recover` | The recovery phrase, typed | Read from the controlling terminal with echo off; the recovery engine | The recovery engine | The phrase, held in memory for the ceremony | A failed or cancelled recovery keeps nothing |
| `account.credentials.handOver` (`access_token`) | The account access token | One of two destinations, and nothing else. (1) A terminal the check of 5.2 admits; the boundary of that guarantee is in 2.4. (2) The protected delivery: a dedicated channel the core itself opens to a verified peer process. The protected delivery is never standard output, and captured standard output never carries the value, whoever reads it. Never an SDK return value, a tool result or a log | Whoever reads an admitted terminal. A terminal that is interactive and owned by the calling user is necessary and is not sufficient: a tool runner can hold such a terminal for a model. What admits a terminal is the check in 5.2: default deny, and a positive list of terminal hosts. The check establishes which program holds the terminal, not that a person is at it (2.4). Where it does not pass, the terminal is not an authorized destination and the call refuses. Or, for the protected delivery, a peer whose identity the core verifies: the same OS user by a peer-credential check on the channel, and an executable or signature on the allowlist | The token and its non-secret metadata; never refresh material | An unverified or unlisted peer gets nothing and the store is not read; one write; a failed write delivers nothing usable and is recorded `not_delivered` |
| `account.credentials.handOver` (`stored_credential`) | The stored credential | As above | As above, and the peer must be one that will `adopt` it | The record `adopt` needs | As above |
| `account.adopt` | A handed-over credential, incoming | The credential store of this device; this device | This device's session | The record as received | A conflict or an invalid record stores nothing |
| `account.signIn` | The user code, matching code and verification URL, while valid | The `onUserCode` callback; the person who must approve | That person | The codes and their expiry | An expired or denied approval leaves no credential |
| `engine.auth.credentials`, `apiKey`, `bearerToken` | A provider credential | As the account hand-over, with the same two destinations, the same terminal check and the same boundary (2.4); never an SDK return value, a tool result, a log or captured standard output. For a program, this is not the default path: the default for a provider credential is injection at launch (the next row) | Whoever reads an admitted terminal; or, for a peer, a named principal that holds this capability explicitly, which is off by default | The one credential asked for | As the account hand-over |
| A provider API key at launch | A provider credential, incoming | The engine process being launched | That process | The key | A refused launch keeps nothing |
| `mcp.oauth.login` | OAuth tokens | The MCP client core's token store | That store | The tokens the server issued | A failed or cancelled flow stores nothing |
| `account.keys.init` | This device's private keys | The OS key store | The key store | The key material | A failed init leaves no partial keyring |
| The transport's read of a socket secret or a key under `key_root` | An endpoint credential | The endpoint it authenticates to | That endpoint | The credential | A failed connection sends nothing further |

The security owner approves this matrix as a whole. Until then every row is a proposal.

Approval status, from the security owner of record on 2026-11-25, reviewing this table at `e593eddc2d`: the rows for `sync.enable`, `sync.recover`, `account.adopt`, `account.signIn`, a provider key at launch, `mcp.oauth.login`, `account.keys.init` and the transport's secret read are approved as written. The rows that return a credential to a caller were sent back with three requirements, which the rows above now state: no raw secret through any surface the product hands to a model (the list in 5.2; the boundary at the terminal destination is in 2.4); injection as the default path for a provider credential, with return to a caller an explicit, audited capability of named principals that is off by default; and an audit record for every successful delivery that names the destination's identity. Those rows are proposals again until the owner approves this wording. The owner's message named the access-token row and the provider-credential row; the owner confirmed that the stored-credential row follows the same requirements. The owner then refined the first requirement: the intent is that no surface the product hands to a model ever carries the value, not that no person can read it; where that intent stops is the residuals of 2.4. A person keeps the flow on a terminal the check of 5.2 admits. Captured standard output never carries the value; a program receives it only through the protected delivery. The rows above state that refinement together with the condition its review added: the terminal counts only where the check of 5.2 admits it. That check replaced the owner's first ruling after the independent private review rejected it, and the owner accepted that review in full. The check and the residuals of 2.4 need the owner's acceptance, and the private reviewer's before the rows are approved; both are recorded at this revision. Two rows approved earlier change in this revision and need the approval again: `sync.enable`, whose display comes under the same check, and `account.signIn` (4.2).

### 5.1 The sync recovery phrase

The first-party design proposed a caller-supplied sink for the phrase. This design rejects that. The source already has the right rule: the only phrase surface is the controlling terminal, opened directly; words are written there and nowhere else, never stdout, stderr or a logger, and typed there with echo off; argv, env, stdin and pipes are never read for them; an agent harness or CI is refused before anything secret exists (`N/sync-phrase-tty.ts:10-16`).

- `sync.enable({ onCode, confirm, signal? })` and `sync.recover({ confirm, signal? })` take no phrase argument and no phrase sink. The core owns the phrase terminal as a port. The call answers the ceremony's outcome only.
- Eligibility is checked before a phrase exists (`N/sync-cli.ts:76-113`). A process with an agent marker in its environment, or with no controlling terminal, gets a typed refusal that says the person must run it themselves.
- **New:** the display of the phrase comes under the terminal check of 5.2. Today's gate is weaker than the one this design sets for the access token: no agent marker, and the terminal device opens, with no check that standard input and output are that terminal and no check of who holds it. The phrase decrypts the account's memory, so it gets the stronger gate. This refuses the display in places where it works today. The security owner decided that a person must always keep one way: where the check refuses (one of our own panes, a multiplexer, a remote login, an editor's terminal, Windows), the refusal names the desktop app, which shows the phrase in its own window and runs the ceremony itself. The window opens only on a person's gesture inside the app; the CLI's refusal never opens it, so running the verb in a refused terminal cannot put the phrase on a screen. An agent with screen or accessibility access to the app could read that window. Where our own product has given an agent that access, the route is refused: the window is excluded from our capture and our accessibility reads, and the phrase is not shown while such access is active. Screen access granted to a third-party tool is a residual (2.4). That route is a new custody destination and is a proposal until the closed matrix proves its row, and section 10 says what evidence it needs before the stronger gate ships anywhere it would otherwise leave a person with no route.
- The CLI verb is an adapter over this call. The SDK is the superset because the call exists; it is not because the phrase becomes available to the caller.
- The recovery engine is the one under review in #14464. This design adds no second one.
- Tests replace the terminal port with a fake that records what was written to it; the non-disclosure test (section 6) asserts the phrase appears on the fake terminal and nowhere else.

### 5.2 The account access token and the stored credential

`omo account token` prints the access token with its expiry, the device and the owner; `omo account export` prints the whole stored credential (`N/account-cli.ts:118-146`). Both exist so that another of our own processes can take over a sign-in.

- `account.credentials.handOver({ what, destination })`, where `destination` is `{ kind: "terminal" }` or `{ kind: "peer", pid, started_at }`. The destination is always named: a custody operation never picks where a secret goes because an argument was left out, and a call without one is refused. The caller names a destination and never supplies something to write to. A peer is named by its process id together with its start time, because an id alone is reused; the type carries no name or path for the caller to assert. For a peer, the core opens the channel itself and verifies who is on the other end before the credential store is read: the peer is the same OS user by a peer-credential check on the channel, and its executable or signature is on the allowlist. The core then writes the JSON record to that channel and to nothing else. The call returns the non-secret part: `{ delivered: true, device, expires_at, owner?, destination }`, where `destination` is the verified peer's identity, not the value.
- No surface the product hands to a model is ever a destination: not the SDK's return value, not captured standard output, not a tool result, not a log. A pane of a terminal host this product family ships is one more such surface, because an agent can read and drive it. That list is exact, and the guarantee is about those surfaces; what lies outside it is the residuals of 2.4. The rule is about what the product delivers to a model, not about people. `omo account token` and `omo account export` keep printing to a terminal the check below admits. Being interactive and owned by the caller does not by itself make a terminal that destination: a terminal that a tool runner, an agent harness or one of our own pane hosts holds is refused. When standard output is captured (a pipe, a file, a tool runner), the verbs never write the value to it. A program of ours receives the value only through the protected delivery, the separately approved custody destination of 5.0: a dedicated channel the core opens to a verified, allowlisted peer. That is one interpretation everywhere in this document: the protected delivery is not permission to return a secret on ordinary captured output. The SDK call has the same two destinations and no third, and it never returns the value. For a reader of captured output that is not on the allowlist this is a narrowing of what it can do today, decided by the security owner and recorded in section 11; the parity migration did not choose it. The terminal check also narrows where a person can read the value; section 11 lists those cases as the owner's decisions.
- The allowlist holds one peer, named by the security owner: the signed omo desktop app, whose code-signing identity the core verifies on the peer channel. Nothing else may receive a credential as a peer. The allowlist ships with the build and changes only through the private record. There is no local enrolment: a file the user owns can be edited by any process of that user, which would make "off by default" a default for well-behaved programs and not a control. A caller that is not on the list gets the refusal. Which other callers read these values from captured output today is a column of the closed matrix.
- Principals: person and script only (4.2), and only toward a verified peer. A session or a connector is refused before the credential store is read.
- **The terminal check** (the security owner's decision of 2026-11-25, replacing the owner's first ruling after the independent private review rejected it; the independent reviewer approved this version). The default is deny. A terminal is an authorized destination only when every step holds, and a terminal that passes is called an *admitted terminal*. This document does not call it a person's terminal: the check establishes which program holds the terminal, not that a person is at it.
  1. Standard input and standard output are the controlling terminal of the calling process, and the caller's process group is that terminal's foreground process group.
  2. Early refusals: an agent session marker in the caller's environment (the markers the sync ceremony refuses on, 5.1), or an agent harness executable anywhere on the walk from the caller to the root, matched by executable file and never by process name. An executable on the walk that cannot be read refuses. This step alone decides nothing: a detached launcher leaves the walk, which is why the next step exists.
  3. Every holder that can be seen is a listed terminal host. The core walks to the terminal's session leader and enumerates the processes that hold the master side of the terminal. Every holder it can see must be a terminal host on the positive list, matched by executable identity; one unlisted holder refuses. What it cannot see is stated, not hidden: a process of the same user can make its descriptor table and its executable unreadable to this check, and such a holder is invisible to it. The check filters callers that do not hide; against one that does it is not a boundary, and 2.4 says so. Executable identity has one definition: on macOS the code-signing identity (the signing team together with the bundle id), verified against the running process; on Linux the resolved executable file, in a path where the file and every parent directory are writable only by root, so an executable under the user's home can never be listed; on Windows none, so nothing there is admitted. The list is kept in the private record and changes only with the owner's and the private reviewer's agreement.
  4. A confirmation code: random from the OS source, six digits or more, one attempt, sixty seconds. Pending terminal input is flushed before the code is shown. The code is read from the controlling terminal with echo off and compared before the credential store is read. A wrong, missing or late code prints nothing.
  5. The value is printed on the terminal's alternate screen and wiped on acknowledgement or on timeout, so it does not stay in scrollback.

  By terminal host. Admitted: a local terminal emulator on the list (at this revision Terminal, iTerm2, Ghostty, Alacritty, kitty and WezTerm, each only once its identity has been read from a real install and recorded; two are recorded so far) and the kernel's virtual console. A serial console is refused: nobody measured it, and on a virtual machine it is the hypervisor's console, which is a remote login by another name. Refused, always: a pane of a terminal host this product family ships, because it is a surface the product hands to a model (above) and can never be filed as a residual. Refused at this revision, by the security owner's decision on the independent review's measurements: a terminal multiplexer such as tmux or GNU screen, which was measured passing every step with no client attached, and which inside one of our own panes would turn that pane into an admitted terminal; and a remote login, whose conditions a same-user caller cannot establish. A multiplexer returns only with a measured check of every attached client, and a remote login only with a measured identity check for the login daemon or an approval that leaves the terminal. Also refused: an editor's integrated terminal, a tool runner's pseudo-terminal, an agent harness, any unlisted holder, and Windows.

  A person in a refused context has no terminal route. For a credential the route is the desktop app, the one named peer; for the recovery phrase it is the app's own window (5.1). A person signed in to a headless host has neither at this revision. This document says so plainly instead of claiming a route, and section 11 lists it.

  Steps 4 and 5 are new steps in a flow a person has today, and the refusals of this paragraph take the flow away in some places where it works today. Both are the owner's decisions and are recorded in section 11.
- Checks before the store is read: the root is open, the launch is not a desktop launch, the principal is allowed, and the destination is one of the two (an admitted terminal, or a protected delivery to a peer that is verified and listed), and the audit `started` record is written (8.2). A failed check reads nothing.
- Partial outcomes: the record is written in one write. If the write fails, the call answers a failure whose message is the core's own words, and the audit record (section 8) says `not_delivered`. The failure never quotes what was written.
- `export` moves refresh material and device keys: whoever holds it can become this device. This design keeps it because the CLI has it (I5) and lists a narrowing in section 11.

### 5.3 A handed-over sign-in

`account.adopt({ credential, replace? })` reads the credential from a readable handle, never from a string argument or the environment. The rules stay today's: a different device already signed in is a conflict unless `replace`; a current credential with a later expiry is kept (`N/account-cli.ts:86-110`). The result names the device and the storage and nothing else.

### 5.4 The device-code sign-in

The `code` event carries the verification URL, the user code, the matching code and the expiry (`N/account-sign-in.ts:37-59`). A person has to see them, so they go to the `onUserCode` callback and only there: not into the result, not into a log, not into a failure. The result is the `signed_in` event's content: api, device, replaced device, device-service outcome. The event order `ready`, `code`, `signed_in` or `refused` is part of the contract. The SDK never removes a device to make room; the list goes back to the caller with the refusal (`N/account-sign-in.ts:196-203`). A lower-layer error's text is not passed on, because a service or store message can carry a credential (`S/access.ts`, `failure`).

When a session calls `account.signIn` (allowed today), the codes reach its callback and therefore that session's context. That is today's behaviour of the shipped SDK and is unchanged; section 11 lists it.

### 5.5 Model provider and MCP credentials

- The default path for a provider credential is injection: the engine process being launched receives the key it needs, and no caller ever holds the value.
- Returning a provider credential to a caller (`engine.auth.credentials`, `apiKey`, `bearerToken`) is a separate, explicit capability. It is off by default, is held only by the one peer the build's allowlist names (5.2), delivers only to that verified peer, and writes an audit record for every delivery. `omo auth print-api-key`, `omo auth print-bearer-token` and `omo auth check --credentials` follow the same rule as the account verbs: they print only to a terminal the check of 5.2 admits, never write the value to captured standard output, and reach a program only through the protected delivery to the named peer. `check` without credentials returns status only.
- A caller that uses one of those commands today as a credential helper keeps working only if it is the named peer; no caller enrols itself. The closed matrix records which such callers exist; none is assumed.
- A provider API key given at launch (`--api-key`) is an input: it is read from a readable handle, and reaches the launched process on a private inherited descriptor that is closed after one read and is in no child's argv or environment; a key the engine already finds in the provider variables of its own environment keeps working as today; never accepted as a field that a list row, a `threads.get` answer, a receipt or a log would echo.
- `mcp.oauth.login` runs the browser flow and stores tokens in the MCP client core's store; `status` returns non-secret state; `logout` removes the tokens. No call returns a token.

### 5.6 Engine endpoint credentials

The root's `endpoint` selector names paths (a socket, a key root), never contents. The transport port reads a socket secret and sends it; no result, failure or diagnostic names it. `daemon.status` and `diagnostics.run` report whether a credential file exists and whether its mode is safe, not what it holds.

### 5.7 Account keys

`account.keys.init` creates this device's keyring in the OS key store; `status` and `init` answer the device id and the public signing and sealing keys only, as the verb does today.

## 6. The non-disclosure test

Every slice that adds a call of section 5 ships this test, and slice P1b ships it for the whole root.

- Fake ports hold recognizable canaries, one per asset of 2.1: an access token, a refresh token, a private key, a recovery phrase, a provider API key, an OAuth token, a socket secret, a user code.
- Each call of the namespace is driven through its ok path, each refusal of section 4, and one injected fault per step (a store that locks, a 401, a write that fails halfway, a cancelled signal).
- Prohibited outputs, each scanned on every outcome: the returned value; the failure; every stream event; every gateway store row, receipt and other persisted record the call wrote, the audit records included; everything written to the logger port and the telemetry port; the message and stack of an unexpected exception, including one the boundary did not expect; whatever the diagnostic and crash-reporting path would send; the argv and environment of any child process the call started; the tool result where a tool exists; and the CLI's standard output and error as the production adapter renders them, not a test double of the renderer.
- Authorized destinations, each asserted explicitly: for every row of the custody matrix (5.0), the canary arrives at that row's destination on success, and on a failed or cancelled transfer the destination holds exactly what the row's last column says.
- Both directions are required for every operation: the successful outcome and each unsuccessful one, with synthetic canaries only.
- The terminal destination has its own cases, each failing before the implementation exists. Admitted: a listed emulator with the caller in the foreground, after the typed code; the kernel's virtual console. Refused: a pane of one of our own pane hosts; a serial console; a multiplexer pane with a client attached, with none, and inside one of our own panes; a remote login, whatever holds its master side and whatever its session leader is called; an editor's integrated terminal; a tool runner's pseudo-terminal; an agent harness; a detached launcher that kept its environment; a detached launcher with the markers unset that opens a pseudo-terminal and drives it; an unreadable executable on the walk; a terminal with one listed and one unlisted visible holder; a listed emulator whose signature does not verify, and one of a listed name installed under the user's home; a background process group; Windows. Where the check refuses `sync.enable`, the refusal names the desktop app, no phrase exists yet and no window opens. Nothing printed and the store unread: a wrong code, no code within sixty seconds, a second attempt, input typed before the code was shown. After acknowledgement and after timeout the value is not in the terminal's scrollback. The desktop window: shown only on a gesture inside the app, and refused while our own product has given an agent screen or accessibility access. The residuals of 2.4 are outside I1: a green run is not evidence about them, and the measured hidden-holder case is recorded as evidence of the first residual, not as a test. The detailed validation belongs to the private record.
- A canary anywhere outside its row's destination fails the test. A scan of the root's result objects alone is not acceptance evidence for I1.

The existing scan (`S/omo-sdk.test.ts:76-82`, asserted at `:118-129` and `:151-158`) covers the returned values of four calls. It is a starting point for the scanner and is not evidence for any claim about the whole root.

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

The table above says what each event does. What it does to each kind of lifetime, and whose clock bounds it:

| Lifetime | After sign-out, forget or a remote revoke | After a device switch is turned off | Who controls the bound |
|---|---|---|---|
| New work on a live root | Refused at the SDK's boundary with the typed code, on the first call that needs the session | Refused by the device service or the relay | The SDK for sign-out and forget on this device; the account service for a remote revoke, at its next contact |
| Work already admitted (a turn running on another device, a delivery queued, a command in flight) | Not recalled by the SDK. It ends as the engine, the relay and the service end it today | Same | Externally controlled: the engine, the relay, the account service. The SDK promises nothing here |
| An open stream or attach | Ends with one terminal failure event when its transport refuses or its connection closes | An open attach ends with a terminal event | Externally controlled for the moment of refusal; the SDK guarantees only that the stream ends with a terminal event and never hangs silently |
| Cached state in a root (a device listing, a session index) | Used for addressing only; it authorizes nothing, so nothing in it needs revoking | Same | The SDK |
| A custody handle already written to (5.0) | Not recalled. A handed-over access token works until the service rejects it or it expires | Not affected | Externally controlled: the account service's token lifetime. This design states no number for it; the closed matrix records the measured value and its source |

Rules for the implementation: no namespace caches an access token, a device row's authorization or a control-switch state across calls beyond what the session and the remote module already hold, and a cached listing is never proof that a command is allowed. Where the migration cannot strengthen a behaviour without changing what a caller sees, it keeps today's behaviour and section 11 lists the change for the owner.

Acceptance: one synthetic-clock row for every cell above whose bound the SDK controls, driving a live root, an open stream and a written handle through the event; and for every externally controlled cell, a test against the fake service that the SDK's own part holds (the typed code, the terminal event), with the external duration named as external. No test asserts an elapsed-time bound the SDK does not control.

## 8. Audit trail

### 8.1 What is recorded today

- **Deliveries.** Every send writes a gateway row and a receipt with the sender principal, the target, the lane and the outcome, kept 30 days (`T/` budgets: receipts and delivered rows). The delivered message carries a provenance header naming where it came from (`T/gateway/provenance.ts`).
- **Creation.** A created thread records its creator when a session created it; a script records none (`T/sdk.ts:142-146`).
- **Commands to another device.** Each carries a command id and its state events through the relay (`R/types.ts`, `CommandStateEvent`).
- **Account.** The account service keeps the device list with last-seen times.

### 8.2 What this design adds

1. **A local custody log.** One append-only file in the account home, owner-only, one JSON line per custody-bearing call (every call of section 5, plus `devices.revoke`, `account.signOut` and `forget`): in the schema below. Two records per operation, `started` and `terminal`, joined by the operation id. The `started` record is written before the credential store is read; if it cannot be written, a delivery of a credential to a caller fails closed and moves nothing (every other operation is covered below). If the `terminal` record cannot be written, the operation's result says so and the next call that can write records the gap. Kept 90 days, pruned on write.
2. **Cross-device control is attributable on the target.** A control command that arrives from another device (interrupt, close, unload, set model, set reasoning, rename, archive, attach, an answered dialog) leaves a record on the device that ran it, naming the sender principal, the sending device and the command id. Slice T1b verifies with a test which of these the engine and the device service already record and adds what is missing; a command that changes a session with no such record does not pass.
3. **A read call.** `account.audit.list({ since? })`, person and script only, returns the custody log's records. The file is owner-only; no other principal and no tool reads it.

The record schema, for both kinds of record:

| Field | Content |
|---|---|
| `id`, `at` | A record id and the time |
| `operation_id` | Joins `started` and `terminal`; for a cross-device command also the relay's `command_id`, for a delivery its `delivery_id` |
| `principal` | Kind and id of the caller: a uid, a durable session id, a connector binding |
| `capability` | The operation's registry id |
| `target` | The device and thread it acted on, where it has one |
| `destination` | For a custody operation: the identity of where the secret went, never the value. For an admitted terminal: the tty device, the session id, the session leader's pid and start time, the terminal host's executable identity with its pid and start time, and the uid. For a peer: its executable identity, its pid with its start time, and the allowlist entry that admitted it. For a launch: the launched process, by executable identity, pid and start time. For the desktop app's window: the app's signing identity, its pid and start time, and the display. Otherwise the store |
| `phase` | `started` or `terminal` |
| `outcome` | On `terminal`: `ok`, `refused`, `cancelled`, `partial` or `failed`, with the typed code |

A record never holds a credential, a code (the typed confirmation code included), a handle's content, a message body, an argument's text or any other caller-supplied string that could carry a secret: only ids, kinds and codes. The schema is reviewed independently with the closed matrix.

When the audit mechanism is unavailable: a delivery of a credential to a caller (the hand-over rows of 5.0) fails closed, because the security owner's ruling requires an audit record for every such delivery. Nothing else is refused for it. A sign-out, a forget, a revoke and a cross-device control command run exactly as they do today. Making any of them wait on an audit write would add a prerequisite the existing contract does not have, and a sign-out or a revoke that an unwritable log could block would weaken the guarantee it exists for. Their result carries an `audit_unavailable` note in `details`, and a `diagnostics.run` finding reports the gap. Whether an existing lifecycle operation should ever fail closed on audit is a behaviour change; it is listed in section 11 for the owner and is not assumed here.

Acceptance: for every operation of the custody matrix and every cross-device command of the closed matrix, a synthetic run of each terminal outcome (ok, refused, cancelled, partial, failed) asserts the pair of records and their correlation, and the unavailable-audit behaviour above.

No audit record is a place a secret can land: the non-disclosure test of section 6 scans the custody log and the control records too.

## 9. What each slice must show

| Slice | Before it starts | In its pull request |
|---|---|---|
| P1a-s and P1b (the sensitive contracts, the root and principals) | This design CLEAR | The matrix of section 4 as conformance scenarios, one per R cell; the non-disclosure test over every namespace present; the revocation tests of section 7 for the calls it wires |
| A1d (adopt, hand-over) | This design CLEAR and the owner's approval of the revised rows of 5.0 | 5.2 and 5.3; the custody log; the fail-closed test. Three tests that fail before the implementation exists: each listed surface asking for the value is refused (the SDK return value, a tool result, captured standard output: a pipe, a file, a tool runner); an unverified or unlisted peer gets nothing and the store is not read; and every terminal case of section 6: the admitted hosts, each refusal, the code mechanics and the wipe. The audit `started` record is written before the store is read, and a run with an unwritable log delivers nothing. All with synthetic canaries |
| A1b, A1c (sign-out, forget, revoke) | none beyond P1b | The custody log lines; the R cells for session and connector |
| A2b, A2c (sync) | This design CLEAR | 5.1 with the fake phrase terminal; the agent-marker and no-terminal refusals before any secret exists |
| E1a-s for the launch options, the endpoint options and provider credentials; OC1b for `on_complete`; OC1c for MCP OAuth and account keys | This design CLEAR, and for provider credentials the owner's approval of the revised row | 4.4, 5.5 and 5.7. For provider credentials the same failing-first tests as A1d (captured output never carries the value, an unverified peer gets nothing, and every terminal case of section 6), plus: with no named principal configured, every return call is refused, and injection at launch still works |
| OC2 for the loop's session binding | This design CLEAR | A person or a script binds the session it names; a session is bound only to its own, with the id from the engine and never from an argument |
| T1c for attach and answering a dialog; T1e for the extension session operations | This design CLEAR | The refusal rows of 4.1 for every principal but the allowed one |
| T1b (control calls) | none beyond P1b | 8.2 item 2 |
| **Unassigned, held:** approved change B7 (`omo auth check` printing the closed-code message when its output is not an admitted terminal) | Not started, and no slice owns it. It needs two things that do not exist yet: the terminal check, which slice A1d builds, and the engine's result with the closed code and the provider's text as two fields, which slice E1a-s ships. The security owner names the owning slice before any work starts | When it is assigned: the acceptance test of B7's row in section 10, with the goldens before and after, the compatibility record of every caller that reads this command's captured output, and the non-disclosure run of section 6 over both streams at the slice's exact head, re-run by a reviewer who is not the author. Until then section 10 holds it: the command's output is unchanged in every context |

## 10. Rollout and rollback

- **Order.** Reads and refusals first: the root ships with the matrix's refusals and the non-disclosure test before any custody-bearing call exists. Each custody-bearing call then ships in its own slice, behind its CLI verb, which keeps working unchanged until the adapter over the SDK passes the same goldens, except for the approved changes listed below, each of which has its own expectation.
- **Entry criteria for a custody slice.** This design CLEAR; the fake ports and canaries of section 6 in place; the custody log writable in the slice's tests; the slice's refusal rows listed in its issue.
- **Exit criteria.** The non-disclosure test passes over the new call and over the whole root; the revocation tests of section 7 pass with the call in use; the audit line is asserted; and the CLI verb's golden output and exit code are unchanged for all behaviour that is not an approved change below.
- **Approved behaviour changes.** Section 11 records decisions that change what an existing caller gets. They are the only exceptions to the unchanged-golden rule, they are exactly these seven, and anything not in this table is held to the unchanged goldens:

  | Id | What changes, and for whom | Approved expectation |
  |---|---|---|
  | B1 | `omo account token`, `omo account export` and the provider-credential verbs with standard output captured: a program that read the value there | A typed refusal that names the protected delivery; the value is never written; the store is not read |
  | B2 | The same verbs on a terminal: a person | On an admitted terminal, the confirmation code and then the value on a wiped screen. On a refused terminal, a typed refusal that names the desktop app; nothing is printed |
  | B3 | `omo sync enable`'s phrase display: a person | As today on an admitted terminal. Where the check refuses, a typed refusal that names the desktop app, before any phrase exists |
  | B4 | `account.signIn` with `replace` from a session | A typed refusal; no device is removed |
  | B5 | A connector root calling a thread read or control | A typed refusal. No caller is a connector root today |
  | B6 | `engine.auth.check` from a session | Status only, with the refresh off: the auth store is not written. The message is built from a closed set of codes; a canary planted in turn in each field of the provider's response, a key-shaped address in the email field among them, reaches no field of the session's answer, which carries no email and no organisation name. The command's own output on an admitted terminal is unchanged; captured output is B7 |
  | B7 | `omo auth check` with its output going anywhere but an admitted terminal (a pipe, a file, a tool runner, one of our own panes): a program or an agent that read the provider's text there | The same message built from the closed set of codes that a session gets, with no provider-returned text. Each stream is judged on its own: with standard error sent to a file, the file receives the codes while a standard output on an admitted terminal keeps its print. Only the classification of 5.2 is used, steps 1 to 3; no confirmation code is asked: that code guards the display of a credential, and this command is not meant to display one. That is its purpose and not a proven property, since a provider's text can echo a fragment of a key, which is the reason for this change. Unlike the credential print, it does not follow the hold of this section: it only narrows output and never removes a person's view. Its acceptance evidence is narrower than non-disclosure: it shows that a canary planted in a provider's error appears on no stream that is not an admitted terminal. It shows nothing about the admitted terminal, where the provider's text reaches the person as it does today, and nothing about a provider field the test did not plant in. On an admitted terminal the print is unchanged, byte for byte. Evidence: a key-shaped string planted in a provider error and captured through a pipe shows only the code. Held and unassigned at this revision: section 9 says what it waits on |

  A change enters this exception only when all of these exist for it, reviewed: the owner's decision in section 11; its row of the closed matrix proven, not marked as still to prove; a compatibility record that lists every caller that exists today and what each gets instead; and an acceptance test that asserts the approved expectation, with the goldens before and after. A change whose row is unresolved or unproven does not enter the exception: the unchanged goldens bind it and the slice cannot ship it.
- **An alternative route is evidence, not a promise.** B2 and B3 send a person to the desktop app where the terminal is refused. No sentence of this document claims that every affected person keeps a route until that is shown: the desktop route's custody row proven at an exact revision, and availability evidence that the signed app exists, installs and completes the operation on each platform and in each context where the terminal is refused (one of our own panes, a multiplexer, a remote login, an editor's terminal, an unlisted emulator, Windows). Where that evidence is missing for a context, the change does not ship for that context and today's behaviour stays.
- **The end state is not the authorized rollout.** Sections 5.2 and 11 state the destination policy this design proposes: where a value may be displayed once everything is in place. A decision about that policy is not evidence that a replacement exists, and it does not by itself authorize shipping a refusal. Per context, a refusal ships only when the evidence of the previous bullet exists for that context. Until then the context is **held**: the stronger rule is not shipped there and today's behaviour stays. Held at this revision, because no availability evidence exists yet for any of them: a multiplexer, a remote login, an editor's terminal, an unlisted emulator and Windows. A person signed in to a headless host is held with no end in sight, because no replacement is even proposed for that case. Shipping a refusal in a context without a replacement needs a decision of the security owner that changes this rollout requirement for that context, reviewed like any other change to this document. One exists, and it is reviewed with this revision: in one of our own panes the refusal ships with no replacement, because the product hands that pane to a model and non-disclosure outranks continuity there. It covers a verb run directly in one of our own panes, and that context only. Two held contexts are reachable from that same pane: a multiplexer started inside it, where the check sees the multiplexer's server and not our pane host, and a remote login opened from it, where the check on the other machine sees nothing of the client. For those two the security owner ruled a narrower hold: the refusal ships wherever an agent harness is detectable, by an agent session marker in the caller's environment or by one of our harness executables on the walk as far as the walk can see it, and today's print stays only where nothing points to our harness. The blind spot is stated, not hidden: a multiplexer whose server no longer has our pane host above it and whose environment carries no marker, and a remote login to a machine that received no marker. There a credential verb still prints to a surface our product hands to a model, until the attached-client check and the approval that leaves the terminal exist.
- **A hold keeps only what exists today.** "Today's behaviour stays" applies to the existing CLI verbs' print to a terminal and to nothing else. The new SDK operations have no behaviour today: in a held context they refuse from their first release, and a hold gives the SDK surface nothing.
- **Rollback.** A source revert is not the rollback. Each slice states, before it merges, a rollback check across what it changed: the root and its facades, both editions' adapters, the engine version the pin names, and durable state (the custody log's format, the credential store's record format, the gateway store's schema). The check shows that the previous build reads the state the new build wrote, that no custody-bearing call stays exported without its checks, and that the authority and custody rows this design approved hold on the rolled-back build. It is run on synthetic state in the slice's tests. If a slice has no safe rollback, for example a store migration the previous build cannot read, its rollout stops before merge and the decision goes to the owner.
- **Stop conditions.** A canary found outside its destination, a refusal row that passes where it must refuse, or an audit line missing for a moved secret stops the rollout of that slice and of every slice that depends on it.

## 11. Decisions this design does not make

Each of these would change what a principal can do today, so none is part of the parity migration (I5). They are listed for the owner, and none blocks a slice. The rule for anything found later is the same: a discrepancy between the matrix and the code is not settled by changing an existing capability under the label of parity. It is recorded here and goes to the owner as its own decision.

1. **Decided by the security owner of record, 2026-11-25: no credential on a surface the product hands to a model, with three stated residuals.** The account hand-over verbs and the provider-credential verbs deliver only to an admitted terminal or to a verified, allowlisted peer, and returning a provider credential is off by default (5.0, 5.2, 5.5). The owner's first terminal ruling was rejected by the independent private review and is withdrawn; the owner accepted that review in full and adopted the positive check of 5.2, the audit destination of 8.2, the code mechanics and the wipe. The independent reviewer approved this version and accepted the residuals; both acceptances are recorded in the private record. Each of the following narrows something a caller can do today, so each is the owner's decision under I5 and not this document's:
   - A program that reads one of these values from captured standard output no longer can. A program of ours receives it only through the protected delivery. One principal is named for credential return: the signed omo desktop app, verified by its code-signing identity. Nothing else receives a credential as a peer.
   - A person gains two steps on an admitted terminal: typing the confirmation code, and reading the value on a screen that is wiped.
   - A person loses the terminal flow in a pane of one of our own pane hosts, in a multiplexer, over a remote login, in an editor's integrated terminal, in any emulator that is not on the list, and on Windows. In each of those the value is delivered only through the protected delivery, which means through the desktop app. The owner first admitted a remote login and a multiplexer and reversed both on the independent review's measurements; each returns only with a measured check (5.2).
   - Everything in this list is the proposed end state. Section 10 governs what may ship: every context above is held, with today's behaviour, until its replacement is shown to be available there.
   - A person signed in to a headless host has no route for a credential or for the recovery phrase in the end state. The security owner accepted that as a stated gap of the end state. The mechanism that would fit is an approval that leaves the terminal, from another signed-in device; it is filed as the follow-up and is not adopted now. Accepting the gap in the end state is not the rollout decision of section 10, so that context stays held until the owner says in terms that the refusal ships there with no replacement.
   - Decided by the security owner: in one of our own panes the refusal ships with no replacement. That pane is a surface the product hands to a model, so non-disclosure outranks continuity there; on a machine with no desktop app a person loses the flow in that pane and keeps it on a listed emulator. A remote login to a headless host stays held, with today's behaviour, until the approval that leaves the terminal exists.
   - Decided by the security owner: in a held multiplexer or remote login the refusal still ships wherever an agent harness is detectable (an agent marker in the environment, or our harness on the walk as far as it is visible); today's print stays only where nothing points to our harness. Section 10 states the blind spot that remains. A hold keeps only the existing CLI verbs' print: the new SDK operations refuse in a held context from their first release.
   - The recovery-phrase display of `sync.enable` comes under the same check (5.1). Where the check refuses, the phrase is to be shown through the desktop app's own window; section 10 holds the claim that a person keeps a route until the route is proven and shown to be available.
   - The peer allowlist has one location, the build. No caller enrols a peer.
   - Section 10 lists these as approved behaviour changes B1 to B7, each with its expectation and the evidence it needs before it ships. An approved change is a decision, not delivery: B7 has no owning slice yet and section 9 records it as unassigned and held.
   - Not adopted now: a second factor that leaves the terminal, such as an approval from another signed-in device or an OS user-presence check.
2. **Narrowing `export` further.** Replace the standalone stored-credential export with a paired hand-over that only another `adopt` on the same machine can consume. Not decided.
3. **`account.signIn` from a session.** The shipped SDK allows it and the codes reach the session's callback. Refusing it, or routing the codes to a person-only surface, would be a behaviour change. The shipped call also takes `replace`, which removes this machine's earlier device; the security owner decided that `replace` from a session is refused (4.2). Whether a session may sign in at all stays open.
4. **The access token's lifetime** as the bound of a hand-over's revocation: confirm the number, and decide whether a hand-over should request a shorter-lived token.
5. **Failing an existing lifecycle operation closed when its audit record cannot be written** (sign-out, forget, revoke, a cross-device control command). Not decided. Today's behaviour is kept: they run, and the gap is reported (8.2).

## 12. Review checklist

Every row below is a requirement on future slices, not evidence. An invariant is met for an operation only when its evidence exists at an exact head.

| Checklist line | Answered in | Evidence owner | Coverage required | Acceptance receipt | Negative control |
|---|---|---|---|---|---|
| No secret is ever returned to a caller or written to a log | I1; 5, 6 | The slice that adds the operation; P1b for the whole root | Every operation, every outcome, every prohibited output and every authorized destination of 5.0. The residuals of 2.4 are outside this line and are accepted separately, by the owner and the independent private reviewer | The non-disclosure test's run at the slice's exact head, with the list of operations it drove | A canary planted in each prohibited output in turn must fail the test |
| Capability per principal | I2; 3, 4 | The slice that wires the operation | Every cell of the closed matrix for that operation: each allowed outcome and each refused one | The conformance run at the exact head, one scenario per cell | An allowed cell made to refuse, and a refused cell made to pass, must each fail |
| Revocation | I3; 7 | The slice that wires the operation | Every lifetime row the SDK controls; the SDK's part of every external one | The synthetic-clock run at the exact head | A stream left open after its transport refuses must fail |
| Audit trail | I4; 8 | The slice that adds the operation | Every custody operation and cross-device command, every terminal outcome | The record-pair assertions at the exact head | A missing `terminal` record, and a record holding a canary, must each fail |

All evidence is produced with synthetic data against fake ports. No acceptance row uses a live credential or a privilege experiment.
