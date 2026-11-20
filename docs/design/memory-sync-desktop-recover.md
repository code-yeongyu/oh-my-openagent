# D12 design: `omo.memory.sync.recover` (desktop recovery on a fresh device)

Tracking: code-yeongyu/oh-my-openagent#14122. This is a design only. Nothing is implemented; this docs-only PR carries the design for review. An Opus security review comes next.

Code read at: omo `origin/dev` 8ed8b4ccdc41613873572798f9b55fc0815d9e06, omo-desktop-app `origin/main` 6231717de4b50a3986cbed9d36507a480370d253, omo-service `origin/main` (as fetched 2026-11-20). Paths below are relative to each repo. `omo:` is oh-my-openagent, `desk:` is omo-desktop-app and `svc:` is omo-service.

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
  | ({ readonly kind: "recovered" } & SyncRootNotice)
  | ({ readonly kind: "recovered_read_only" } & SyncRootNotice)
  | { readonly kind: "cancelled" }
  | { readonly kind: "in_progress" }                       // another recover/enable ceremony holds the claim
  | { readonly kind: "recover_refused"; readonly code: SyncRecoverRefusal }
  | SyncRpcProblem
export type SyncRecoverRefusal =
  | "no-recovery-key"        // the account has no key of the requested method
  | "history-incomplete"     // a valid phrase that matches no enrolled hint (F14)
  | "not-enrolled" | "key-mismatch" | "countersign-mismatch" | "wrap-refused" | "wrap-unbound"
  | "recovery-expired" | "unverified" | "join-refused" | "join-unconfirmed"
  | "pin-conflict" | "pin-corrupt"
  | "already-syncing"        // this device is already a member: recovery is for a fresh device
  | "surface-unavailable"    // no protected phrase window or no passkey bridge on this host
  | "local-only"             // desktop server: the request did not come from the local desktop shell
  | "too-many-attempts"      // local lockout (section 6)
  | "rate_limited" | "stale_base" | "not_found" | "refused"   // TransportRefusal (omo recovery/ports.ts:228)
```

The zod schema is `z.object({ method: z.enum(["passkey","phrase"]) }).strict()`, the same style as `enableRequest` (omo `sync-rpc-registration.ts:7`). Refusal codes are a closed enum and carry no free text, so nothing the person typed can be echoed back. The engine maps `RecoverRefusalReason` (omo `recovery/recover.ts:23-33`) one-to-one onto these codes. `approval-required` maps to `surface-unavailable`, and `bad-device` and `too-many-recovery-keys` map to `refused`.

### Features flag
`"recover"` is appended to `SyncFeature` (omo `sync-rpc-contract.ts:13`) and to `FEATURES` (omo `sync-rpc-registration.ts:15`). It is listed only when the host wired a recover runtime **and** the desktop descriptor advertises `phraseRecover: "supported"` (new, beside `phraseGenesis` at omo `desktopSyncPortSchema.ts:78`). An older engine answers `features` without `recover`, so the desktop keeps the entry hidden.

### Status field naming the recovery method
This is optional on `SyncStatusResponse` (omo `sync-rpc-contract.ts:113-122`):

```ts
readonly recovery?: { readonly method: "passkey" | "phrase" | "both" | "none" }
```

It is computed from the served keyring through the same reader recovery uses: `servedPhraseHints` (omo `recovery/phrase-hints.ts`) for phrase keys and `servedSaltInputs` (omo `recovery/salt-inputs.ts`) for passkey keys, after removed keys are subtracted. It never comes from a server claim field. An unreadable keyring omits the field instead of guessing. Older engines omit it, and the desktop then labels the button generically.

### Private channel (engine <-> desktop main)
- New ops are added to omo `desktopSyncOperation.ts:10`, `desktopSyncProtocol.ts:16` and `protocol.ts:10`: `"recoverBeginPhrase" | "recoverBegin" | "recoverFinish" | "recoverAbort"`. Their payloads are the existing desk schemas (`recoveryPasskeyPayloads.ts:99`, `:131`, `:234-242`).
- desk `genesisMainChannel.ts` gains `recoverRun(handle, input)`. It runs the same `current(operation)` identity and keys check as `phraseGenesisRun` (`:148-161`) and then delegates to `DesktopRecoveryPasskeyBridge.serve` (`DesktopRecoveryPasskeyBridge.ts:229-253`).
- omo `desktopSyncAccount.ts:186-211` gains a `RecoveryBridge` proxy whose `recoverBeginWithPhrase`, `recoverBegin`, `recoverFinish` and `recoverAbort` call `operation.request({ op, data })`. Every request and result is public (omo `recovery/ports.ts:176-193`).

### Engine runtime
`SyncRpcRuntime.recoverAccount(input)` (omo `sync-rpc-ports.ts:57`) calls `recoverOnFreshDevice` (omo `recovery/recover.ts:87`) with `bridge` = the proxy above and `method` from the request. It is the same function `omo sync recover` uses (omo `packages/omo-native/sync-cli.ts:265-274`). The coordinator acquires the claim as `operation: "enable"` (omo `sync-rpc-ports.ts:121-126`). A second recover or enable on the device therefore answers `in_progress`, and a person cannot run two ceremonies at once.

## 2. (a) Phrase path from the words window to key derivation, every hop

1. **Renderer (main app window):** shows only a button. It sends WS `omoMemorySync` `{verb:"recover", method:"phrase"}` to the desktop server. The request body carries no words.
2. **Desktop server (`apps/server`):** desk `ws.ts:4518-4522` calls `requestOmoMemorySync(..., { localDesktop: session.subject === LOCAL_DESKTOP_SUBJECT })`. `localOnlyAnswer` (desk `omoMemorySync.ts:70-86`) gains `recover`, and a non-local caller gets `recover_refused/local-only` without the engine ever being called (section 5). A local call is forwarded as the control-RPC extension request `omo.memory.sync.recover` with data `{method}` (desk `omoMemorySync.ts:131-140`). Still no words.
3. **Engine (omo host process):** `registerSyncRpc` validates the request (`sync-rpc-registration.ts:49-50` coordinator check), `recoverOnFreshDevice` reads the served phrase hints (`recover.ts:148-158`) and then calls `bridge.recoverBeginWithPhrase({account, hints})`. The proxy sends `op:"recoverBeginPhrase"` over the **private fd channel** inherited at spawn (`SENPI_PRIVATE_FDS`, desk `omoHostCliRequest.ts:73-77,92`, `omoHostCliPresenterSpawner.ts:143-148`; engine side omo `desktop-sync/bootGate.ts:51`; #12057). That is a socketpair or pipe pair owned by main. It is not a network endpoint and carries no bearer. The payload is public: account plus hints.
4. **Desktop main:** `genesisMainChannel.recoverRun` checks the identity and keys and then calls `DesktopRecoveryPasskeyBridge.serve` op `recoverBeginPhrase` (`DesktopRecoveryPasskeyBridge.ts:229-235`), which calls `recoverBeginPhrase` (`recoveryPhraseBridge.ts:96`) and then `surface.enter` (`:109-138`).
5. **Phrase window (separate sandboxed renderer):** desk `recoveryPhraseWindow.ts:57-154`. The person types into `#typed`. The preload sends `ipcRenderer.invoke(RECOVERY_PHRASE_CHANNEL, {call:"submit", answers:[text]})` (desk `recovery-phrase-preload.ts:15-16,81-84`). That is Electron IPC from this window's main frame only (`recoveryPhraseWindow.ts:105-107`).
6. **Main, the same process as step 4:** `submit` wraps the text as `TypedPhrase.of` (`recoveryPhraseWindow.ts:186-188`), then `check` calls `parseRecoveryPhrase` (`recoveryPhraseBridge.ts:115`, desk `recoveryPhrase.ts:139-165`), which yields entropy bytes. Next comes `derivePhraseKeys` per hint (`recoveryPhraseBridge.ts:119-123`). **Key derivation happens here, in main.**
7. **Back to the engine:** only `{handle, credentialId, sealing_public_key, signing_public_key}` (`recoveryPhraseBridge.ts:156-163`). The engine then runs the anchored walk and calls `recoverFinish` over the same channel. Main uses the held keys (`DesktopRecoveryPasskeyBridge.ts:241-253`) and returns the public `deviceWrap` and `join`. The engine appends the join and rotates (`recover.ts:188-267`).

The words cross exactly one process boundary: phrase-window renderer to main, over a per-window `ipcMain.handle`. They never touch the main app renderer, the desktop server, the engine, the relay or the service. The passkey path is the same through step 4 and then calls `recoverBegin` (`DesktopRecoveryPasskeyBridge.ts:236-237`). Its PRF output stays in main (omo `recovery/ports.ts:7-9`).

## 3. (b) The phrase never reaches transcripts, RPC/event logs, telemetry, crash reports or errors

Evidence that this holds today:
- **Not in transcripts:** the engine never holds the words (section 2), so the session transcript and the engine RPC log cannot contain them. The RPC request is `{method}` only, and the response is a closed enum.
- **Redacted types:** desk `TypedPhrase` and `RecoveryPhraseWords` return `[recovery phrase]` from `toString`, `toJSON`, `toPrimitive` and inspect (`recoveryPhrase.ts:53-76,117-128`). In omo, `phrase.ts:121-135,150-164,259-273` does the same for the CLI path. So a log line, trace attribute, schema decode error or `JSON.stringify` of either type prints the placeholder.
- **Errors carry no text:** a parse refusal names a reason and an optional position, never a word (desk `recoveryPhrase.ts:131-133,145`, omo `phrase.ts:179-183`). Every main failure collapses to fixed strings: `ceremony` maps any throw to `"the passkey ceremony failed"` (desk `DesktopRecoveryPasskeyBridge.ts:98-102`), and `recoverBeginPhrase` maps a rejection to `unavailable` or `cancelled` (`recoveryPhraseBridge.ts:139-147`). The engine handler's catch logs `syncErrorFields(error)` with code `handler_failed` (omo `sync-rpc-registration.ts:95-101`). That error can only come from public data because the engine never holds the words.
- **Window hygiene:** no devtools, a non-persistent partition cleared on close (`recoveryPhraseWindow.ts:73-84,135`), content protection on (`:86`), copy, cut, drag and context menu blocked (preload `:39-40`), and the field is cleared after acceptance (preload `:86`).
- **Telemetry and crash reports:** the recovery module has no telemetry or Sentry calls (grep of `desk apps/desktop/src/account/recoveryPasskey` for `telemetry|posthog|sentry|captureException` returns nothing). The trace span `desktop.recoveryPasskey.serve` records only the name. The crash reporter is per window (`window/DesktopWindow.ts:388,881`). It is not attached to the phrase window because that window is created in `recoveryPhraseWindow.ts` and not through `DesktopWindow`.

Required for the new code:
- The new `recover` engine events reuse the `RecoveryEvent` names (omo `recovery/ports.ts:242-250`) and carry no fields.
- The `recover_refused.code` enum is the only thing on the wire. A `warn` call never receives a request body.
- Residual risk, stated plainly: an Electron or V8 heap dump or a native crash minidump of main, taken while the window is open, could contain the typed string. That needs OS-level access or a crash in main during the few seconds the window is open. The phrase window must not enable `crashReporter` uploads with `uploadToServer` that include heap. **Action:** confirm in implementation that `DesktopCrashReporter` does not attach heap or minidumps for main, or that it pauses while `closeOpen !== undefined`.

## 4. (c) Never persisted; buffers cleared after derivation

| Buffer | Type | Where it lives | Where it is zeroed or dropped |
|---|---|---|---|
| Textarea value | DOM string | phrase window renderer | `typed.value = ""` on accept (preload `:86`). The window is destroyed and the partition storage is cleared (`recoveryPhraseWindow.ts:93,135`). |
| IPC message `answers[0]` | JS string (V8 heap) | main | Cannot be zeroed (JS strings are immutable). It becomes unreachable after `submit` returns. This is the same known limit as the CLI (#14157 item 3). |
| `TypedPhrase.#text` | JS string | main | Cannot be zeroed. It is dropped after `check`. |
| `parseRecoveryPhrase` scratch `bytes` | `Uint8Array(33)` | main | `bytes.fill(0)` (desk `recoveryPhrase.ts:157`) |
| `entropy` slice | `Uint8Array(32)` | main | `entropy.fill(0)` (`:160` on a bad checksum, `:163` after the copy) |
| `RecoveryPhraseWords.#entropy` | `Uint8Array(32)` | main | `dispose()` then `fill(0)` (`recoveryPhrase.ts:113-116`), called in `finally` (`recoveryPhraseBridge.ts:134-136`) on every path, success included |
| Derived keys for a non-matching hint | `RecoveryKeyPairs` (`Uint8Array` private halves) | main | `disposeRecoveryKeys` (`recoveryPhraseBridge.ts:131`) |
| Matched keys | held behind a one-shot handle | main | disposed on finish, abort, TTL (120 s), a second begin, all windows closed, shutdown request, drain or finalizer (`DesktopRecoveryPasskeyBridge.ts:119-151`, `recoveryPhraseBridge.ts:102,144-146`). The engine always calls `recoverAbort` in `finally` (omo `recover.ts:124-126`). |

Nothing is written to disk. The only file `recoverOnFreshDevice` writes is the write-hold marker `{version, account, credential_id}` (omo `recovery/write-hold.ts`, `recover.ts:203`) and the trust pin (`:213`). Both are public.

**Required change:** desk `recoveryPhrase.ts:142` builds `indices` as a `number[]`. It is word indices, which is equivalent to the phrase, and it is never cleared. Implementation must make it `Uint16Array` and `fill(0)` after packing, matching omo `phrase.ts:194,198,204`. Add `indices.length = 0` on the early `unknown-word` return too.

## 5. (d) Accepted only on the local authenticated channel, never relayed

- **Desktop server gate (the authority):** `localOnlyAnswer` (desk `omoMemorySync.ts:70-86`) gains `if (request.verb === "recover") return { verb:"recover", response:{ kind:"recover_refused", code:"local-only" } }`. `localDesktop` is true only for the desktop bootstrap subject (desk `EnvironmentAuth.ts:848`, `pairingOwnerSubjects.ts:7`, `ws.ts:4522`). A paired client, a remote browser or a **relay bridge** session has a different subject, so it is refused before `connect` runs and the engine never receives the call. This matches `disable` (#8274) and phrase `enable`.
- **Engine:** the engine cannot tell who sent a call (comment at desk `omoMemorySync.ts:64-69`). It therefore never relies on the caller. What protects the secret is the surface: the window opens only on the computer that runs main, and the engine has no way to receive words at all. A relayed `recover`, if the server gate were ever bypassed, would open a window on the target computer that only a person at that screen could fill. It still could not move a phrase between devices.
- **Relay/RPC authorization:** `WS_METHODS.omoMemorySync` needs `AuthOrchestrationOperateScope` (desk `auth/RpcAuthorization.ts:140`). The relay classification list (`RpcAuthorization.ts:105-109` style "relay write, and local-only") should name `recover` explicitly as local-only so the relay daemon's generic pass-through refuses it with a typed error. **Action:** add it to that table with a test.
- The CLI path, unchanged, refuses under an agent harness, under CI or without a controlling terminal (omo `sync-cli.ts:250-260`).

## 6. (e) Rate limit and lockout on wrong phrases

Facts first. A wrong phrase **never reaches the service**. Matching is local: the phrase is derived against public hints the service already served (`recover.ts:154-157`) and compared by public key (`recoveryPhraseBridge.ts:124-127`). A guess produces `history-incomplete` with no network call. Security against guessing therefore rests on the 256-bit entropy (`recoveryPhrase.ts:21`). Anyone holding the signed-in account can fetch the hints and guess offline, so no online counter changes the real bound. Lockouts are defense in depth and UX only.

- **Local (main, per ceremony):** the window allows unlimited checksum and wordlist retries, because those are typos and not guesses. It allows at most **5** `history-incomplete` submits per ceremony. After the fifth, main settles the window as `too-many-attempts`. A per-account in-memory backoff then makes the next `recoverBeginPhrase` within **60 s** answer `too-many-attempts` without opening a window. The counter lives only in main's memory, keyed by the account hash, and nothing is persisted. Today `check` returns `null` for a non-match (`recoveryPhraseBridge.ts:133`), which accepts the entry and ends the ceremony with `history-incomplete`. The new behaviour returns a `no-match` problem to the window (the text only says "These words are not a recovery phrase for this account") so the person can retry within the same ceremony up to the cap.
- **Engine:** the coordinator claim (section 1) serializes ceremonies, so parallel windows cannot multiply attempts.
- **Service side:** only a **successful** match produces a `recovery-join` append (`recover.ts:204`, svc `db/migrations/0049_sync_keys.sql:747-750,794-796`). The service counts recent records of one kind for join and veto rate limits (svc `0049_sync_keys.sql:33`) and answers `rate_limited`, which the engine surfaces as `recover_refused/rate_limited` (omo `recovery/ports.ts:228`). The test fake refuses after 5 joins (omo `recovery/testing/fake-server.test-support.ts:110`). The account's existing members can veto a join (`recovery-join-vetoed`, svc `:797-804`). That veto is the real defense against a stolen phrase, and the desktop's join notice (omo `recovery/join-notice.ts`) shows it to them.

## 7. (f) RED tests to write

All canary tests use a fixed fixture phrase (omo `recovery/fixtures/phrase-v1.json`, desk `recoveryPasskey/fixtures/phrase-v1.json`). They search for every word, the joined phrase, and the entropy in hex, base64 and base64url, following the existing `encodings`/`renderings` helpers (omo `recovery/canary.test.ts:24-27`, `phrase-redaction.test.ts:22-36`).

Engine (omo):
1. `sync-rpc-recover.test.ts`: RPC `recover` with a phrase through a fake private-channel main that runs the real `recoverBeginPhrase` over a scripted surface. It asserts `recovered`, then greps the captured `warn`/`logger` sinks, the RPC request and response JSON, emitted `RecoveryEvent`s, console spies and the session transcript file for the canary. Expect zero hits.
2. The same with a **valid but unenrolled** phrase, then cancel. It asserts `recover_refused/history-incomplete` or `cancelled`, and that the canary grep finds zero hits in the same sinks plus the thrown or handled error text.
3. Wordlist and checksum mistakes (`wrong-word-count`, `unknown-word`, `checksum-mismatch`) followed by cancel: still zero hits, and the retry carries only a position.
4. Passkey recover, `no-recovery-key`, `surface-unavailable` (no `phraseRecover` descriptor), and `in_progress` while an enable holds the claim.
5. `features` lists `recover` only with the runtime plus the descriptor. `status.recovery.method` is present and correct for passkey, phrase, both and none, and absent when the keyring read fails.
6. The private-channel op schema rejects a `recoverBeginPhrase` payload that carries any extra field (strict), so words can never be smuggled through the engine.

Desktop (desk):
7. `omoMemorySync.test.ts`: a non-local caller's `recover` is answered `local-only` and the broker `connect` is **never called** (a spy). The local caller is forwarded.
8. `RpcAuthorization` / relay classification: `recover` is listed as local-only.
9. `recoveryPhraseWindow` and bridge world (`phraseRecoveryBridgeTestWorld.ts`): after success **and** after five no-match attempts, it greps main's logger, the trace span attributes, the crash-reporter breadcrumbs (fake) and the `ceremony` error messages for the canary, and expects zero hits. It asserts that the entropy buffers are all zero via a `fill` spy, the same way omo `bridge.ts:15-16` `onKeysDerived` does.
10. Lockout: the fifth no-match settles `too-many-attempts`, a begin within 60 s refuses without opening a window, and the next begin after 60 s opens one. A typo does not count.
11. `parseRecoveryPhrase` leaves `indices` zeroed (the RED for the section 4 required change).
12. Entry UI: the recover button appears only when `features` includes `recover` and sync is off on this device. A cancel leaves sync off.

## 8. Desktop UX

- **Where:** Settings > Memory > Sync across devices, on a device that does not sync yet, and only when `features` has `recover`.
- **Label from `status.recovery.method`:** `phrase` shows "Recover with your recovery phrase". `passkey` shows "Recover with your passkey". `both` shows two buttons. `none` shows no recover button, and the existing "approve from another device" path stays. If the field is absent (older engine), one generic "Recover your memory" button opens a method choice.
- **Flow:** pressing the button sends the verb. Main opens "Enter your recovery phrase" (an existing page mode, `recoveryPhraseWindow.ts:72,182`). Each answer has fixed copy:
  - `recovered`: "Your memory is recovered on this device and memory sync is on."
  - `recovered_read_only`: the CLI's copy (omo `sync-cli.ts:247-248`), "...another step is still pending before it can write."
  - `history-incomplete`: "That recovery phrase does not match this account's history."
  - `no-recovery-key`: offers the other method or approval from another device.
  - `too-many-attempts`: "Too many tries. Wait a minute and try again."
  - `local-only`: "Recover on the computer you are setting up." This appears only on remote clients, which do not show the button at all.
- `rootChanged` and `rootCheck` show the same notice as enable.

## 9. Open points for the security review
1. Whether a 5-per-ceremony cap and a 60 s backoff is worth the complexity, given that offline guessing is possible anyway. The recommendation is yes, as UX and defense in depth against a shoulder-surfed partial phrase.
2. Crash and heap reporter coverage of main while the window is open (section 3 residual).
3. JS string immutability for the textarea and IPC copy (the same residual as the CLI, #14157 item 3). The recommendation is to accept and document it, because Electron gives no byte-input path for a textarea.
