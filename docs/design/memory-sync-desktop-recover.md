# D12 design: `omo.memory.sync.recover` (desktop recovery on a fresh device)

Tracking: code-yeongyu/oh-my-openagent#14122. This is a design only. Nothing is implemented; this docs-only PR carries the design for review. An Opus security review comes next.

Code read at: omo `origin/dev` 8ed8b4ccdc41613873572798f9b55fc0815d9e06 (omo citations re-checked at 8b75b271f2), omo-desktop-app `origin/main` 6231717de4b50a3986cbed9d36507a480370d253, omo-service `origin/main` (as fetched 2026-11-20). Paths below are relative to each repo. `omo:` is oh-my-openagent, `desk:` is omo-desktop-app and `svc:` is omo-service.

Revision r2 answers the review at 2646134d49 (FIX_FIRST): M1 is section 1 "Refusal contract", M2 is section 3 "Crash and exception reporting in desktop main", M3 is section 7, L1 is the section 4 table, L2 is section 5, L3 is engine test 1. It also folds in the staging finding on #14122 (a recovered device stays off and every read answers `403 entitlement_required`): section 1 "Turning sync on after recovery".

Revision r3 answers the delta review at 8055949a91 (REQUEST-CHANGES): M4 is section 1 "Membership guard" (the guard reads chain membership, not engine health) with tests 4, 4b and 12 and the section 8 entry rule; L4 is section 5 (the new route scope covers `recover` only, nothing else changes) with test 8.

Revision r4 answers the CLEAR review at adea555dea (one LOW): L1 is section 1 "Status field naming the recovery method". Status omits `recovery` when membership cannot be read, and a status walk uses its own rejection counter. Test 4b covers both.

## 0. Correction to the #14122 design note

The issue's design note says "Main hands the typed words to the engine over the local channel as bytes" and "the engine derives the key and zeroes its buffer". The current code already does better than that, and this design keeps it that way. **On the desktop the words never leave desktop main.** Main parses the words, derives the keys and holds them behind a one-shot handle. The engine receives only public values: the handle, the credential id and the two public keys.

- desk `apps/desktop/src/account/recoveryPasskey/recoveryPhraseBridge.ts:96-164` (`recoverBeginPhrase`) runs inside main. It opens the entry surface, parses (`:115`), derives against each served hint (`:119-123`), disposes the phrase in `finally` (`:135`) and returns only `handle`, `credentialId` and the public keys (`:156-163`).
- desk `DesktopRecoveryPasskeyBridge.ts:229-235` already serves the op `recoverBeginPhrase`, and `:236-253` serves `recoverFinish` and `recoverAbort` against the same handle store.
- Phrase **genesis** already uses this shape. The engine sends `op: "phraseGenesisRun"` over the private channel and gets back only the public prepared genesis (omo `packages/omo-senpi/src/components/memory/desktop-sync/desktopSyncAccount.ts:200-207`, comment at `:202`: "The words stay in desktop main's protected window").

What is missing is the engine-side caller. The engine has no `RecoveryBridge` that forwards `recoverBeginWithPhrase`, `recoverFinish` and `recoverAbort` over the private channel. The private-channel op enum is `"service" | "keyring" | "genesisRun" | "phraseGenesisRun"` (omo `desktop-sync/desktopSyncOperation.ts:10`, `desktopSyncProtocol.ts:16`, `protocol.ts:10`). Main's channel exposes `genesisRun`, `phraseGenesisRun` and `keyring` only (desk `genesisMainChannel.ts:135-171`). The RPC has no verb (omo `sync-rpc-registration.ts:39-48`).

## 1. Surfaces and wire types

### Engine RPC verb
`omo.memory.sync.recover`, added to the verb list in omo `sync-rpc-registration.ts:39-48` and to `METHODS` in desk `apps/server/src/provider/omo/omoMemorySync.ts:33-40`.

```ts
// sync-rpc-contract.ts
export type SyncRecoverMethod = "passkey" | "phrase"
export type SyncRecoverRequest = { readonly method: SyncRecoverMethod }   // required: the button the person pressed
export type SyncRecoverResponse =
  | ({ readonly kind: "recovered"; readonly sync: "on" | "off" } & SyncRootNotice)
  | ({ readonly kind: "recovered_read_only"; readonly sync: "on" | "off" } & SyncRootNotice)
  | { readonly kind: "cancelled" }
  | { readonly kind: "in_progress" }                       // another recover/enable ceremony holds the claim
  | { readonly kind: "recover_refused"; readonly code: SyncRecoverRefusal }
  | SyncRpcProblem
export type SyncRecoverRefusal =
  | "no-recovery-key" | "history-incomplete" | "not-enrolled" | "key-mismatch" | "countersign-mismatch"
  | "wrap-refused" | "wrap-unbound" | "rp-mismatch" | "recovery-expired" | "unverified"
  | "join-refused" | "join-unconfirmed" | "pin-conflict" | "pin-corrupt"
  | "authenticator-unsupported"   // passkey: the authenticator gives no PRF or no user verification
  | "surface-unavailable"         // no protected phrase window or no passkey bridge on this host
  | "unavailable"                 // a served read failed or the window could not be built; try again
  | "already-member"              // this device is already a member of the account's chain (syncing, paused or turned off)
  | "local-only"                  // desktop server: the request did not come from the local desktop shell
  | "too-many-attempts"           // local lockout (section 6)
  | "rate_limited" | "stale_base" | "not_found" | "refused" | "phrase_keys_not_accepted"   // TransportRefusal
```

The zod schema is `z.object({ method: z.enum(["passkey","phrase"]) }).strict()`, the same style as `enableRequest` (omo `sync-rpc-registration.ts:7`). Refusal codes are a closed enum and carry no free text, so nothing the person typed can be echoed back.

### Refusal contract (review M1)
Every value of `RecoverRefusalReason` (omo `recovery/recover.ts:23-33`, which includes `RecoverRefusal` at `recovery/ports.ts:147-157` and `TransportRefusal` at `ports.ts:228`) and of the pin outcome (`recover.ts:48-52`) has exactly one target. The mapping is one function, `recoverRefusalCode`, written as a `switch` whose `default` assigns the reason to `never`, so adding a reason without a target fails `tsgo`.

| Engine reason | Produced at | RPC answer |
|---|---|---|
| `cancelled` | bridge begin (person closed the window or aborted) | `{kind:"cancelled"}`, not a refusal |
| `no-prf`, `no-user-verification` | passkey bridge begin/finish | `authenticator-unsupported` |
| `approval-required` | `recover.ts:97-99` (no bridge, no phrase begin, no PRF) | `surface-unavailable` |
| `unavailable` | `recover.ts:136,155` (served hint or salt read failed, `phrase-hints.ts:52`), `:153` (no phrase begin), `:180` (wrap read failed), desk `recoveryPhraseBridge.ts:146` (window could not be built) | `unavailable` |
| `bad-device`, `too-many-recovery-keys` | `recover.ts:102`, `:107` (`phrase-hints.ts:63`) | `refused` |
| `rp-mismatch` (new in omo, already in desk `recoveryPasskeyPayloads.ts:198`) | passkey bridge | `rp-mismatch` |
| `too-many-attempts` (new, section 6) | desk phrase begin | `too-many-attempts` |
| `phrase_keys_not_accepted` | service on the join append (`recover.ts:204-212`; a refused rotation append at `:243` is not a refusal, it answers read-only) | `phrase_keys_not_accepted` |
| `not-enrolled`, `history-incomplete`, `key-mismatch`, `countersign-mismatch`, `wrap-refused`, `wrap-unbound`, `recovery-expired`, `unverified`, `no-recovery-key`, `join-refused`, `join-unconfirmed`, `stale_base`, `rate_limited`, `not_found`, `refused` | as named in `recover.ts` / `ports.ts` | the same code |
| `pin-conflict`, `pin-corrupt` | `recover.ts:92-95`, used at `:104,183,214` | the same code |
| `already-member` (new in `RecoverRefusalReason`, `recover.ts:23-33`) | the membership guard below, before begin and again after the anchored walk | `already-member` |

The one code produced outside the engine's recover function is `local-only`, by the desktop server only (section 5).

### Membership guard (review M4)
Recovery must never run on a device that is already a member of the account's chain. `recoverOnFreshDevice` has no member check today (omo `recovery/recover.ts:87-127`), and the rotation it appends wraps the new epoch only to `[device]` plus the used recovery key (`recover.ts:240-241`, `keyring-append.ts:57-87`). A member that recovers would lock out every other device of the account. Engine health is the wrong signal for this: `options.syncStatus()` is `undefined` without a bound session (omo `packages/omo-senpi/src/components/memory/index.ts:119-122`) and is omitted while sync is off or another process holds the engine (`memory-rpc-sync.ts:1-3,13`). A member that was turned off keeps its membership and its pin (#14093, `device-switch.ts:59-67`), so a health check would let exactly that device through. The guard therefore reads membership, the same predicate enable uses (`enable.ts:100,108`: the pinned anchor, then the anchored walk's `isMember()`, which is `authority.members.has(keyring.principal().id)`, `account-chain.ts:155`).

It lives in `recoverOnFreshDevice` itself, so the CLI `recover` and the RPC `recover` both get it and no caller can skip it:

1. **Before begin (the bridge is never called).** After the pin load (`recover.ts:103-105`) and before `beginWithPhrase` / `beginWithPasskey` (`:106`): when the pin loaded, walk the served chain from the pinned anchor with the same verified reader recovery already uses, `loadServedChain(input.transport, input.account, input.rejections, existing.anchor)` (`recovery/served-chain.ts:28-59`; recover has a `RecoveryTransport`, not enable's `AccountHttp`, so it does not call `completeAccountChain` but folds the same chain the same way). If `state.authority.members.has(id)` (the `id` from `recover.ts:101`), answer `refuse("already-member")`. A walk that answers `unavailable` or `unverified` refuses with that reason, and `anchor-mismatch` (the served chain is not the pinned genesis) refuses `pin-conflict`, all before any window opens. No pin means the device never finished a join or genesis here, and the walk is skipped.
2. **After the anchored walk (covers a member whose pin is gone).** In `recoverWithHandle`, after `loadServedChain` from the recovery anchor and the `authority`/`head`/`pin` check (`recover.ts:175-183`) and before `recoverFinish` (`:188`): if `authority.members.has(device.id)`, answer `refuse("already-member")`. This walk is anchored on the recovery key the person just proved, so it does not depend on the device's own state. The `finally` at `:124-126` aborts the handle, so the derived keys are disposed; no join, wrap or rotation is written.

On the RPC path `SyncRpcRuntime.recoverAccount` adds nothing of its own: it maps the engine's `already-member` through the section 1 table. A retired device (removed from `authority.members`) is not a member and may recover. The desktop shows a member device the existing turn-on path instead of the recover button (section 8).

**Typed route for refusals from desktop main.** Today omo `RecoverRefusal` (`ports.ts:147-157`) lacks `unavailable` and `rp-mismatch`, which desk already sends (`recoveryPasskeyPayloads.ts:188-201`, `recoveryPhraseBridge.ts:92-94`). Both enums gain the same values, `unavailable`, `rp-mismatch` and `too-many-attempts`, so `RecoverBeginResult` (`ports.ts:129`) and `RecoverBridgeResult` carry every value main can send. (`unavailable` moves from `RecoverRefusalReason` into `RecoverRefusal`; the union is unchanged.) The engine's channel proxy decodes main's reply with a strict schema over that enum. A reply that does not decode becomes `unavailable` in the engine and logs only the code `bridge_result_invalid`, never the reply, so a lockout from main reaches the person as `too-many-attempts` and not as `handler_failed`. A shared fixture lists the enum, and both repos assert equality with it (test 6).

### Features flag
`"recover"` is appended to `SyncFeature` (omo `sync-rpc-contract.ts:13`) and to `FEATURES` (omo `sync-rpc-registration.ts:15`). It is listed only when the host wired a recover runtime **and** the desktop descriptor advertises `phraseRecover: "supported"` (new, beside `phraseGenesis` at omo `desktopSyncPortSchema.ts:78`). An older engine answers `features` without `recover`, so the desktop keeps the entry hidden.

### Status field naming the recovery method
This is optional on `SyncStatusResponse` (omo `sync-rpc-contract.ts:113-122`):

```ts
readonly recovery?: { readonly method: "passkey" | "phrase" | "both" | "none"; readonly member: boolean }
```

`member` is the membership guard's pre-begin reading (pinned anchor, walk, `authority.members.has(id)`); without a pin it is `false`. It is what the desktop uses to choose between the recover button and the turn-on button (section 8), so the entry never depends on engine health.

When membership cannot be read, status omits the whole `recovery` field rather than guessing `member`. That covers a pin that does not load (`pin-corrupt`, `recover.ts:104`) and a walk that answers `unavailable`, `unverified` or `anchor-mismatch`. In each of those cases the guard would refuse `recover` anyway (`pin-corrupt`, `unavailable`, `unverified`, `pin-conflict`), so hiding the button (section 8) shows nothing the engine would refuse. The engine guard stays the decision, and status is only the UX reading of it.

Cost of a status call: with no pin there is no walk, and status reads only `listKeys` as it does today (`phrase-hints.ts:51`, `salt-inputs.ts:60`). With a pin, status adds one verified walk (`listEntries` + `listKeys`, `served-chain.ts:34-51`). That walk uses its own `createRejectionCounter()`, as the read-only walk in `enroll-phrase.ts:281` does, so status calls never bump the `RejectionCounter` that recovery and sync share. The walk runs only when the host lists `recover` in `features`. An older desktop never pays for it.

Test 4b also asserts both rules: with a pin, a walk that answers `unavailable` makes status omit `recovery`, and the shared counter passed to recovery is not touched by status.

It is computed from the served keyring through the same reader recovery uses: `servedPhraseHints` (omo `recovery/phrase-hints.ts`) for phrase keys and `servedSaltInputs` (omo `recovery/salt-inputs.ts`) for passkey keys, after removed keys are subtracted. It never comes from a server claim field. An unreadable keyring omits the field instead of guessing. Older engines omit it, and the desktop then labels the button generically.

### Private channel (engine <-> desktop main)
- New ops are added to omo `desktopSyncOperation.ts:10`, `desktopSyncProtocol.ts:16` and `protocol.ts:10`: `"recoverBeginPhrase" | "recoverBegin" | "recoverFinish" | "recoverAbort"`. Their payloads are the existing desk schemas (`recoveryPasskeyPayloads.ts:99`, `:131`, `:234-242`).
- desk `genesisMainChannel.ts` gains `recoverRun(handle, input)`. It runs the same `current(operation)` identity and keys check as `phraseGenesisRun` (`:148-161`) and then delegates to `DesktopRecoveryPasskeyBridge.serve` (`DesktopRecoveryPasskeyBridge.ts:229-253`).
- omo `desktopSyncAccount.ts:186-211` gains a `RecoveryBridge` proxy whose `recoverBeginWithPhrase`, `recoverBegin`, `recoverFinish` and `recoverAbort` call `operation.request({ op, data })`. Every request and result is public (omo `recovery/ports.ts:176-193`).

### Engine runtime
`SyncRpcRuntime` (omo `sync-rpc-ports.ts:57-113`) gains `recoverAccount(input)`. It calls the shared recover-and-turn-on step below with `bridge` = the proxy above and `method` from the request. The coordinator acquires the claim as `operation: "enable"` (omo `sync-rpc-ports.ts:121-126`). A second recover or enable on the device therefore answers `in_progress`, and a person cannot run two ceremonies at once.

### Turning sync on after recovery (staging finding, #14122)
Measured on staging: after `recoverOnFreshDevice` answered `recovered`, every sync read answered `403 entitlement_required`. The service gates reads on the device's own switch (svc `sync/store/consent.ts`), and a freshly signed-in device starts with it off. `enableSync` turns both switches on (omo `account/enable.ts:149-150`, `account/enable-phrase.ts:123-124`), but `recoverOnFreshDevice` and its caller `sync-cli.ts:262-276` never do, while the CLI prints "memory sync is on" (`sync-cli.ts:246`).

Required: one memory-core step, `recoverAndTurnOnSync` (new file `packages/memory-core/src/sync/account/recover-sync.ts`), used by both the CLI `recover` (replacing the direct call at `sync-cli.ts:265`) and `recoverAccount`. It runs `recoverOnFreshDevice`, and on `recovered` or `joined-read-only` it then calls `pairing.setAccountSync(true)` and `turnDeviceSyncOn` (omo `account/device-switch.ts:41-46`, which sets the service switch and removes a local off mark), in the same order and through the same operation-scoped ports as enable. On the RPC path the operation then calls `options.resumeSync` (omo `sync-rpc-ports.ts:139`), as it already does after enable (`sync-rpc-operation.ts:338`), so the parked engines start without a restart.

- Order: the switches are turned on only after recovery succeeded. A refusal or a cancel leaves both untouched, as enable's refusals do (`enable.ts:147-148`). The person's consent is the press of the recover button plus a phrase or passkey that proved possession; recovery has no other purpose than syncing again.
- Failure of the switch call: the recovery itself is complete and must not be reported as refused. The answer is `recovered` / `recovered_read_only` with `sync: "off"`. The desktop then shows a turn-on button that sends the existing `enable` verb; enable on a device that holds the pin and keys answers `joined` and turns both switches on (`enable.ts:147-152`). The CLI prints "Your memory is recovered on this device. Run `omo sync enable` to start syncing." `sync: "on"` is the only case that may print or show "memory sync is on".
- Acceptance (from the staging note): a CLI test and an RPC test where recover runs against a fake service that requires consent end with the device switch on, the off mark gone, and a pull answered 200 (test 13).

## 2. (a) Phrase path from the words window to key derivation, every hop

1. **Renderer (main app window):** shows only a button. It sends WS `omoMemorySync` `{verb:"recover", method:"phrase"}` to the desktop server. The request body carries no words.
2. **Desktop server (`apps/server`):** desk `ws.ts:4518-4522` calls `requestOmoMemorySync(..., { localDesktop: session.subject === LOCAL_DESKTOP_SUBJECT })`. `localOnlyAnswer` (desk `omoMemorySync.ts:70-86`) gains `recover`, and a non-local caller gets `recover_refused/local-only` without the engine ever being called (section 5). A local call is forwarded as the control-RPC extension request `omo.memory.sync.recover` with data `{method}` (desk `omoMemorySync.ts:131-140`). Still no words.
3. **Engine (omo host process):** `registerSyncRpc` validates the request (`sync-rpc-registration.ts:49-50` coordinator check), `recoverOnFreshDevice` reads the served phrase hints (`recover.ts:148-158`) and then calls `bridge.recoverBeginWithPhrase({account, hints})`. The proxy sends `op:"recoverBeginPhrase"` over the **private fd channel** inherited at spawn (`SENPI_PRIVATE_FDS`, desk `omoHostCliRequest.ts:73-77,92`, `omoHostCliPresenterSpawner.ts:143-148`; engine side omo `desktop-sync/bootGate.ts:51`; #12057). That is a socketpair or pipe pair owned by main. It is not a network endpoint and carries no bearer. The payload is public: account plus hints.
4. **Desktop main:** `genesisMainChannel.recoverRun` checks the identity and keys and then calls `DesktopRecoveryPasskeyBridge.serve` op `recoverBeginPhrase` (`DesktopRecoveryPasskeyBridge.ts:229-235`), which calls `recoverBeginPhrase` (`recoveryPhraseBridge.ts:96`) and then `surface.enter` (`:109-138`).
5. **Phrase window (separate sandboxed renderer):** desk `recoveryPhraseWindow.ts:57-154`. The person types into `#typed`. The preload sends `ipcRenderer.invoke(RECOVERY_PHRASE_CHANNEL, {call:"submit", answers:[text]})` (desk `recovery-phrase-preload.ts:15-16,81-84`). That is Electron IPC from this window's main frame only (`recoveryPhraseWindow.ts:105-107`).
6. **Main, the same process as step 4:** `submit` wraps the text as `TypedPhrase.of` (`recoveryPhraseWindow.ts:186-188`), then `check` calls `parseRecoveryPhrase` (`recoveryPhraseBridge.ts:115`, desk `recoveryPhrase.ts:139-165`), which yields entropy bytes. Next comes `derivePhraseKeys` per hint (`recoveryPhraseBridge.ts:119-123`). **Key derivation happens here, in main.**
7. **Back to the engine:** only `{handle, credentialId, sealing_public_key, signing_public_key}` (`recoveryPhraseBridge.ts:156-163`). The engine then runs the anchored walk and calls `recoverFinish` over the same channel. Main uses the held keys (`DesktopRecoveryPasskeyBridge.ts:241-253`) and returns the public `deviceWrap` and `join`. The engine appends the join and rotates (`recover.ts:188-267`).
8. **Sync on:** the engine turns the account and device switches on and resumes its parked engines (section 1, "Turning sync on after recovery"). This hop carries only the service device id.

The words cross exactly one process boundary: phrase-window renderer to main, over a per-window `ipcMain.handle`. They never touch the main app renderer, the desktop server, the engine, the relay or the service. The passkey path is the same through step 4 and then calls `recoverBegin` (`DesktopRecoveryPasskeyBridge.ts:236-237`). Its PRF output stays in main (omo `recovery/ports.ts:7-9`).

## 3. (b) The phrase never reaches transcripts, RPC/event logs, telemetry, crash reports or errors

Evidence that this holds today:
- **Not in transcripts:** the engine never holds the words (section 2), so the session transcript and the engine RPC log cannot contain them. The RPC request is `{method}` only, and the response is a closed enum.
- **Redacted types:** desk `TypedPhrase` and `RecoveryPhraseWords` return `[recovery phrase]` from `toString`, `toJSON`, `toPrimitive` and inspect (`recoveryPhrase.ts:53-76,117-128`). In omo, `phrase.ts:121-135,150-164,259-273` does the same for the CLI path. So a log line, trace attribute, schema decode error or `JSON.stringify` of either type prints the placeholder.
- **Errors carry no text:** a parse refusal names a reason and an optional position, never a word (desk `recoveryPhrase.ts:131-133,145`, omo `phrase.ts:179-183`). Every main failure collapses to fixed strings: `ceremony` maps any throw to `"the passkey ceremony failed"` (desk `DesktopRecoveryPasskeyBridge.ts:98-102`), and `recoverBeginPhrase` maps a rejection to `unavailable` or `cancelled` (`recoveryPhraseBridge.ts:139-147`). The engine handler's catch logs `syncErrorFields(error)` with code `handler_failed` (omo `sync-rpc-registration.ts:95-101`). That error can only come from public data because the engine never holds the words.
- **Window hygiene:** no devtools, a non-persistent partition cleared on close (`recoveryPhraseWindow.ts:73-84,135`), content protection on (`:86`), copy, cut, drag and context menu blocked (preload `:39-40`), and the field is cleared after acceptance (preload `:86`).
- **Telemetry:** the recovery module has no telemetry or Sentry calls (grep of `desk apps/desktop/src/account/recoveryPasskey` for `telemetry|posthog|sentry|captureException` returns nothing). The trace span `desktop.recoveryPasskey.serve` records only the name.

### Crash and exception reporting in desktop main (review M2)
The typed string, the `TypedPhrase`, the normalized words and the entropy all live in **desktop main** (section 4), so the question is about main, not about the phrase window's renderer. What main has at desk 6231717:

- **No crash or exception upload runs in main.** `DesktopCrashReporter` is retired: `make` registers no listener and returns `report`, `reportRendererException` and `recent` as no-ops, with the comment "Do not observe exceptions, construct records, retain a buffer, publish or spool here" (desk `telemetry/DesktopCrashReporter.ts:42-48`). It only discards legacy spool files (`:35`). `DesktopWindow.ts:388,881` still calls `report`, which does nothing.
- **No native minidump or heap capture.** `git grep` over `apps/desktop/src` (tests excluded) for `crashReporter.start`, `electron.crashReporter`, `takeHeapSnapshot`, `writeHeapSnapshot`, `contentTracing`, `netLog`, `inspector` and `setUncaughtExceptionCaptureCallback` finds nothing. Electron starts Crashpad only through `crashReporter.start`, so main writes no minidump.
- **The one remaining sink is the local main log.** `installMainProcessErrorBackstop` handles `uncaughtException` and unhandled rejections and writes `stack=JSON.stringify(describe(error))` (desk `app/mainProcessErrorBackstop.ts:69-81`), where `describe` is `error.stack` or `String(error)` for a non-Error (`:49-52`). No variable capture, but a thrown value's message or a rejected non-Error value is written verbatim.
- **Electron's `ipcMain.handle` prints a handler's rejection to main's console** and sends its message to the renderer. The phrase handler (`recoveryPhraseWindow.ts:105-120`) awaits `request.submit(answers)` without a catch, and a throw inside `check` "rejects only that submit" (`recoveryPhraseBridge.ts:139-141`).

Hard requirements for the implementation (not "confirm"):
1. **No main-process crash, exception or heap capture while the phrase window is open.** A new module `phraseEntryGuard` in desk `account/recoveryPasskey/` exports `phraseEntryOpen(): boolean`, true from `openPhraseWindow` until `closeOpen` is cleared (`recoveryPhraseWindow.ts:130-133`). Any future crash or exception reporter in main, and any `crashReporter.start`, heap snapshot or inspector use, must check it and drop the capture (not defer it) while it is true. A repo audit test fails if `apps/desktop/src` calls `crashReporter.start`, `writeHeapSnapshot`, `takeHeapSnapshot` or `setUncaughtExceptionCaptureCallback` from anywhere other than a call site that checks the guard.
2. **The backstop writes no message or stack while the window is open.** While `phraseEntryOpen()` is true, `installMainProcessErrorBackstop` writes only `origin`, `code` and the error's constructor name, with `stack="[withheld during recovery phrase entry]"`.
3. **The phrase IPC handler never rejects with caller-influenced text.** `submit` catches every throw from `check` and answers the fixed `{ok:false, problem:{reason:"unavailable"}}`, so neither Electron's handler log nor the renderer sees an error message. The handler's own `throw new Error("refused")` lines (`:107,108,115`) keep their fixed text.
4. RED test: test 9b in section 7.

Residual risk, stated plainly: an operating-system crash dump of the desktop process (for example macOS ReportCrash writes an `.ips` with the thread backtrace and register state only, not heap), or a memory read by something with the user's privileges, while the window is open. Neither is in the app's control, and both need local access that already defeats the window.

Required for the new engine code:
- The new `recover` engine events reuse the `RecoveryEvent` names (omo `recovery/ports.ts:242-250`) and carry no fields.
- The `recover_refused.code` enum is the only thing on the wire. A `warn` call never receives a request body.

## 4. (c) Never persisted; buffers cleared after derivation

| Buffer | Type | Where it lives | Where it is zeroed or dropped |
|---|---|---|---|
| Textarea value | DOM string | phrase window renderer | `typed.value = ""` on accept (preload `:86`). The window is destroyed and the partition storage is cleared (`recoveryPhraseWindow.ts:93,135`). |
| IPC message `answers[0]` | JS string (V8 heap) | main | Cannot be zeroed (JS strings are immutable). It becomes unreachable after `submit` returns. This is the same known limit as the CLI (#14157 item 3). |
| `TypedPhrase.#text` | JS string | main | Cannot be zeroed. It is dropped after `check`. |
| Normalized text (`normalize("NFKD")`, `toLowerCase`, `trim`) | JS strings | main, `normalisedWords` (desk `recoveryPhrase.ts:47-50`) | Cannot be zeroed. Unreachable when `wordsOf` returns. Residual, same class as the IPC string. |
| Split words `words[]` | array of JS strings | main, `recoveryPhrase.ts:49`, held as `words` in `parseRecoveryPhrase` (`:140`) | The strings cannot be zeroed. Required: `normalisedWords` returns a mutable array and `parseRecoveryPhrase` sets `words.length = 0` in a `finally`, so no array outlives the call on any return path. Residual: the string values until GC. |
| `indices` | `number[]` today | main, `recoveryPhrase.ts:142` | **Required change** below. |
| `parseRecoveryPhrase` scratch `bytes` | `Uint8Array(33)` | main | `bytes.fill(0)` (desk `recoveryPhrase.ts:157`) |
| `entropy` slice | `Uint8Array(32)` | main | `entropy.fill(0)` (`:160` on a bad checksum, `:163` after the copy) |
| `RecoveryPhraseWords.#entropy` | `Uint8Array(32)` | main | `dispose()` then `fill(0)` (`recoveryPhrase.ts:113-116`), called in `finally` (`recoveryPhraseBridge.ts:134-136`) on every path, success included |
| HKDF output per label | `ArrayBuffer(32)` | main, `hkdf32` (desk `recoveryKeys.ts:73-78`) | the source buffer is zeroed after the copy (`:76`); the copy is the key below |
| PKCS8 DER wrapper per key | `Buffer` | main, `privateKeyOf` (`recoveryKeys.ts:52-61`) | `der.fill(0)` in `finally` (`:59`) |
| `KeyObject` (seal and sign, per hint) | OpenSSL memory | main, `recoveryKeys.ts:57,103,105` | Cannot be zeroed from JS; released by GC (comment `recoveryKeys.ts:50`). Residual. |
| Phrase salt | `Uint8Array(32)` | main, `derivePhraseKeys` (`recoveryPhrase.ts:183`) | Public (account and served nonce); no clearing needed. |
| Derived keys for a non-matching hint | `RecoveryKeyPairs` (`Uint8Array` private halves) | main | `disposeRecoveryKeys` (`recoveryPhraseBridge.ts:131`, `recoveryKeys.ts:114-117`) |
| Matched keys | held behind a one-shot handle | main | disposed on finish, abort, TTL (120 s), a second begin, all windows closed, shutdown request, drain or finalizer (`DesktopRecoveryPasskeyBridge.ts:119-151`, `recoveryPhraseBridge.ts:102,144-146`). The engine always calls `recoverAbort` in `finally` (omo `recover.ts:124-126`). |

Nothing is written to disk. The only files `recoverOnFreshDevice` writes are the write-hold marker `{version, account, credential_id}` (omo `recovery/write-hold.ts`, `recover.ts:203`) and the trust pin (`:213`); turning sync on removes the off mark (`device-switch.ts:45`). All are public.

**Required change:** desk `recoveryPhrase.ts:142` builds `indices` as a `number[]`. It is word indices, which is equivalent to the phrase, and it is never cleared. Implementation must make it `Uint16Array(PHRASE_WORD_COUNT)` and `fill(0)` it in a `finally` that covers the packing loop and the early `unknown-word` return, matching omo `phrase.ts:194,198,204`.

## 5. (d) Accepted only on the local authenticated channel, never relayed

- **Desktop server gate (the authority):** `localOnlyAnswer` (desk `omoMemorySync.ts:70-86`) gains `if (request.verb === "recover") return { verb:"recover", response:{ kind:"recover_refused", code:"local-only" } }`. `localDesktop` is true only for the desktop bootstrap subject (desk `EnvironmentAuth.ts:848`, `pairingOwnerSubjects.ts:7`, `ws.ts:4522`). A paired client, a remote browser or a **relay bridge** session has a different subject, so it is refused before `connect` runs and the engine never receives the call. This matches `disable` (#8274) and phrase `enable`.
- **Engine:** the engine cannot tell who sent a call (comment at desk `omoMemorySync.ts:64-69`). It therefore never relies on the caller. What protects the secret is the surface: the window opens only on the computer that runs main, and the engine has no way to receive words at all. A relayed `recover`, if the server gate were ever bypassed, would open a window on the target computer that only a person at that screen could fill. It still could not move a phrase between devices.
- **Relay/RPC authorization, concrete mechanism (review L2):** `WS_METHODS.omoMemorySync` has one table scope, `AuthOrchestrationOperateScope` (desk `auth/RpcAuthorization.ts:140`), for every verb. The server already has a per-payload scope mechanism: `PAYLOAD_SCOPED_RPC_METHODS` (`RpcAuthorization.ts:405-409`) and `routeScopesForRpc(method, payload)` (`:419-440`), which the WS route layer checks and a relay principal's class must cover (#5853). The change:
  - add `WS_METHODS.omoMemorySync` to `PAYLOAD_SCOPED_RPC_METHODS`;
  - in `routeScopesForRpc`, for `omoMemorySync`, return `[tableScope, AuthAccessWriteScope]` when the payload's `verb` is `recover`, and `[tableScope]` for every other verb, so this change alters the route scope of `recover` only; a payload whose `verb` is not a string gets both scopes, the same rule `omoPrewarmThreadSession` uses (`:426`). The other local-only requests (`disable`, `acknowledge`, and `enable` with `method: "phrase"`) keep today's gate, `localOnlyAnswer`, and are out of scope here. Raising them to the route layer is a separate follow-up; that rule would have to read `method` as well as `verb` for enable, because phrase and passkey enable share verb `enable` (desk `omoMemorySync.ts:71`). `AuthAccessWriteScope` is the scope "answered only by this machine's own app: a paired or relayed client never holds it" (`:288-290`);
  - so a relay or paired principal is refused at the route layer with the existing typed scope error, before `localOnlyAnswer` runs. `localOnlyAnswer` stays as the second gate.
- The CLI path, unchanged, refuses under an agent harness, under CI or without a controlling terminal (omo `sync-cli.ts:250-260`).

## 6. (e) Rate limit and lockout on wrong phrases

Facts first. A wrong phrase **never reaches the service**. Matching is local: the phrase is derived against public hints the service already served (`recover.ts:154-157`) and compared by public key (`recoveryPhraseBridge.ts:124-127`). A guess produces `history-incomplete` with no network call. Security against guessing therefore rests on the 256-bit entropy (`recoveryPhrase.ts:21`). Anyone holding the signed-in account can fetch the hints and guess offline, so no online counter changes the real bound. Lockouts are defense in depth and UX only.

- **Local (main, per ceremony):** the window allows unlimited checksum and wordlist retries, because those are typos and not guesses. It allows at most **5** `history-incomplete` submits per ceremony. After the fifth, main settles the window and `recoverBeginPhrase` returns `beginRefused("too-many-attempts")` (`recoveryPhraseBridge.ts:92-94` gains the value). A per-account in-memory backoff then makes the next `recoverBeginPhrase` within **60 s** answer `too-many-attempts` without opening a window. The counter lives only in main's memory, keyed by the account hash, and nothing is persisted. Today `check` returns `null` for a non-match (`recoveryPhraseBridge.ts:133`), which accepts the entry and ends the ceremony with `history-incomplete`. The new behaviour returns a `no-match` problem to the window (the text only says "These words are not a recovery phrase for this account") so the person can retry within the same ceremony up to the cap.
- **Route to the person:** `too-many-attempts` is a member of desk `RecoverRefusal` (`recoveryPasskeyPayloads.ts:188-201`) and of omo `RecoverRefusal` (`ports.ts:147-157`), so it decodes in the engine's proxy, passes through `recoverOnFreshDevice` as `refuse(begun.reason)` (`recover.ts:108`) and maps to the RPC code `too-many-attempts` (section 1 table).
- **Engine:** the coordinator claim (section 1) serializes ceremonies, so parallel windows cannot multiply attempts.
- **Service side:** only a **successful** match produces a `recovery-join` append (`recover.ts:204`, svc `db/migrations/0049_sync_keys.sql:747-750,794-796`). The service counts recent records of one kind for join and veto rate limits (svc `0049_sync_keys.sql:33`) and answers `rate_limited`, which the engine surfaces as `recover_refused/rate_limited` (omo `recovery/ports.ts:228`). The test fake refuses after 5 joins (omo `recovery/testing/fake-server.test-support.ts:110`). The account's existing members can veto a join (`recovery-join-vetoed`, svc `:797-804`). That veto is the real defense against a stolen phrase, and the desktop's join notice (omo `recovery/join-notice.ts`) shows it to them.

## 7. (f) RED tests to write

All canary tests use a fixed fixture phrase (omo `recovery/fixtures/phrase-v1.json`, desk `recoveryPasskey/fixtures/phrase-v1.json`). They search for every word, the joined phrase, the indices as decimal and the entropy in hex, base64 and base64url, following the existing `encodings`/`renderings` helpers (omo `recovery/canary.test.ts:24-27`, `phrase-redaction.test.ts:22-36`). "The sinks" below always includes the **telemetry sinks**: in the engine, a fake telemetry-core transport given to `capture` and the OTLP exporter (omo `packages/telemetry-core`, `packages/omo-senpi/src/components/telemetry/otlp.ts`, `posthog-runtime.ts`); on the desktop, a fake `DesktopTelemetryPublisher` and the adoption-event sender (desk `telemetry/DesktopTelemetryPublisher.ts`, `telemetry/adoptionEvents.ts`).

Engine (omo). The engine never holds the words, so these tests prove that nothing the desktop sends back, and nothing the engine emits, can carry them. The stand-in for desktop main (review L3) is a fake private-channel op server inside the test that serves `recoverBeginPhrase`, `recoverFinish` and `recoverAbort` with omo's own `createRecoveryBridge` (omo `recovery/bridge.ts`, the bridge `sync-cli.ts:12` already uses) over a scripted phrase surface. desk's real `recoverBeginPhrase` is covered by tests 9 to 11.
1. `sync-rpc-recover.test.ts`: RPC `recover` with a phrase through that fake main. It asserts `recovered` with `sync:"on"`, then greps the captured `warn`/`logger` sinks, the telemetry sinks, the private-channel frames in both directions, the RPC request and response JSON, emitted `RecoveryEvent`s, console spies and the session transcript file for the canary. Expect zero hits. The scripted surface types the canary, so a leak through the bridge is possible and the test can fail.
2. Every refusal the fake main can send (`history-incomplete`, `cancelled`, `unavailable`, `too-many-attempts`, `rp-mismatch`, `no-prf`), each followed by an RPC answer: asserts the mapped code from the section 1 table, and the canary grep of the same sinks plus any thrown or handled error text finds zero hits.
3. `recoverRefusalCode` table test: every `RecoverRefusalReason` value maps to its documented target; an undecodable reply from main becomes `unavailable` and logs only `bridge_result_invalid`.
4. Passkey recover, `no-recovery-key`, `surface-unavailable` (no `phraseRecover` descriptor), `in_progress` while an enable holds the claim. Membership guard, through both `recoverOnFreshDevice` (CLI) and RPC `recover`: a device that holds a pin and is in `authority.members` answers `already-member` with the bridge spy never called and no join, wrap or rotation appended, for each of (i) a syncing member, (ii) a member turned off by `disableSync` (pin kept, off mark present, `syncStatus()` returning `undefined`), (iii) a member with no bound session. A pinned device that was retired (not in `members`) proceeds to begin.
4b. A member whose pin was deleted: begin runs, the walk anchored on the recovery key finds the device in `members`, the answer is `already-member`, `recoverFinish` is never called, `recoverAbort` is called once, and nothing is appended. `status.recovery.member` is `true` for case 4 (i) to (iii) and `false` with no pin.
5. `features` lists `recover` only with the runtime plus the descriptor. `status.recovery.method` is present and correct for passkey, phrase, both and none, and absent when the keyring read fails.
6. The private-channel op schema rejects a `recoverBeginPhrase` payload that carries any extra field (strict), so words can never be smuggled through the engine. The `RecoverRefusal` enum equals the shared fixture list (the desk side asserts the same fixture).

Desktop (desk):
7. `omoMemorySync.test.ts`: a non-local caller's `recover` is answered `local-only` and the broker `connect` is **never called** (a spy). The local caller is forwarded.
8. `RpcAuthorization` test: `routeScopesForRpc(omoMemorySync, {verb:"recover", ...})` includes `AuthAccessWriteScope`; `{verb:"status"}`, `{verb:"enable", method:"phrase"}`, `{verb:"enable", method:"passkey"}`, `{verb:"enable"}`, `{verb:"disable"}` and `{verb:"acknowledge", ...}` return exactly `[tableScope]` (this change widens nothing but `recover`); a payload without a string `verb` gets both. A relay-principal route test for `recover` is refused with the typed scope error.
9. `recoveryPhraseWindow` and bridge world (`phraseRecoveryBridgeTestWorld.ts`), one case per path where the words exist in main: success; five no-matches; `wrong-word-count`; `unknown-word`; `checksum-mismatch`; a typo then cancel; window closed mid-entry; `check` throwing. For each it greps main's logger, the trace span attributes, the telemetry sinks, the Electron IPC reply and any handler rejection, and the `ceremony` error messages for the canary, and expects zero hits. It asserts that `bytes`, `entropy`, `indices` and every derived key buffer end zeroed via a `fill` spy, the same way omo `bridge.ts:15-16` `onKeysDerived` does.
   - 9b (M2): with the window open, (i) emit `uncaughtException` with an `Error` whose message is the canary and a rejected non-Error canary string through the real `installMainProcessErrorBackstop`, and assert the log line has no canary and carries the withheld stack marker; after the window closes the same emit logs the stack again; (ii) a `check` that throws a canary-bearing error makes `submit` answer `{ok:false, problem:{reason:"unavailable"}}`, and the console spy and the reply hold no canary; (iii) a fake reporter that honours `phraseEntryOpen()` records nothing while the window is open; (iv) the repo audit for `crashReporter.start` / heap snapshot / `setUncaughtExceptionCaptureCallback` passes on the tree and fails on a planted call.
10. Lockout: the fifth no-match settles `too-many-attempts` and the begin result decodes as that refusal; a begin within 60 s refuses without opening a window; the next begin after 60 s opens one (an injected clock, no sleep). A typo does not count.
11. `parseRecoveryPhrase` leaves `indices` zeroed on success, on `unknown-word` and on `checksum-mismatch` (the RED for the section 4 required change).
12. Entry UI: the recover button appears only when `features` includes `recover` and `status.recovery.member` is `false`. A member device that is turned off (`member: true`) shows the turn-on button and no recover button. `recovery` absent shows no recover button. A cancel leaves sync off.

Sync switch (omo, the staging finding):
13. `recover-sync.test.ts`, through both the CLI `recover` and RPC `recover`, against the recovery fake server with a consent gate: before, a pull answers 403 `entitlement_required`; after `recovered`, the account and device switches are on, the off mark is gone, `resumeSync` was called once (RPC), and a pull answers 200. A refusal or cancel leaves both switches untouched. A failing `setDeviceSync` gives `recovered` with `sync:"off"`, the CLI text says to run `omo sync enable`, and a following `enable` turns the switch on.

## 8. Desktop UX

- **Where:** Settings > Memory > Sync across devices, only when `features` has `recover` and `status.recovery.member` is `false` (this device is not in the account's chain). A member device, whether it syncs, is paused or was turned off, never sees the recover button; a turned-off member sees the existing turn-on button, which sends `enable` and answers `joined`. If `recovery` is absent (unreadable keyring) the recover button is hidden rather than guessed.
- **Label from `status.recovery.method`:** `phrase` shows "Recover with your recovery phrase". `passkey` shows "Recover with your passkey". `both` shows two buttons. `none` shows no recover button, and the existing "approve from another device" path stays. If the field is absent (older engine), one generic "Recover your memory" button opens a method choice.
- **Flow:** pressing the button sends the verb. Main opens "Enter your recovery phrase" (an existing page mode, `recoveryPhraseWindow.ts:72,182`). Each answer has fixed copy:
  - `recovered` with `sync:"on"`: "Your memory is recovered on this device and memory sync is on."
  - `recovered` with `sync:"off"`: "Your memory is recovered on this device. Turn on memory sync to start syncing." with a turn-on button that sends `enable`.
  - `recovered_read_only`: the CLI's copy (omo `sync-cli.ts:247-248`), "...another step is still pending before it can write." With `sync:"off"` it adds the turn-on button.
  - `history-incomplete`: "That recovery phrase does not match this account's history."
  - `no-recovery-key`: offers the other method or approval from another device.
  - `too-many-attempts`: "Too many tries. Wait a minute and try again."
  - `already-member`: "This device is already part of your memory sync. Turn memory sync on instead of recovering." with the turn-on button that sends `enable`.
  - `authenticator-unsupported`: "This passkey cannot be used for recovery here." and offers the phrase or approval.
  - `unavailable`: "Recovery could not start. Try again."
  - `local-only`: "Recover on the computer you are setting up." This appears only on remote clients, which do not show the button at all.
- `rootChanged` and `rootCheck` show the same notice as enable.

## 9. Open points for the security review
1. Whether a 5-per-ceremony cap and a 60 s backoff is worth the complexity, given that offline guessing is possible anyway. The recommendation is yes, as UX and defense in depth against a shoulder-surfed partial phrase.
2. JS string immutability for the textarea, IPC copy, normalized text and split words (the same residual as the CLI, #14157 item 3), plus OpenSSL `KeyObject` memory. The recommendation is to accept and document it, because Electron gives no byte-input path for a textarea.
3. Whether turning the switches on after a successful recovery needs a separate confirmation. The recommendation is no: the person pressed "Recover" to sync again on this device, and the staging run shows that without it the success copy is false.
