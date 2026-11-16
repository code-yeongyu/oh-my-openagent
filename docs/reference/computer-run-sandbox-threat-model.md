# computer.run sandbox: threat model and compatibility matrix (QuickJS)

Status: design reference for the opt-in QuickJS run sandbox (#12230). Docs only: nothing here changes
code or defaults. Line numbers are at `dev` 7adadfb805.

`computer` runs (`{ action: "run", code }` and `computer.run(fn)` from the eval kernel) execute
model-written JavaScript; the CUA adapter (`computer_actions`) also executes its batches as a run body that the
host generates from schema-validated actions (`senpi-desktop-tool/src/cua-actions.ts:146`). Today all of
that code runs in a `node:vm` context of the host process. This document fixes, before any implementation PR, what the replacement must stop, which engine it
uses, what crosses the boundary, how async host calls work, which limits exist, which existing run bodies
break, and how the setting rolls out.

## 1. Current surface (`node:vm`)

`packages/senpi-desktop-service/src/run/runtime.ts` builds one context per run:

| Line | Global | Reaches |
|---|---|---|
| 142 | `vm.createContext({...}, { microtaskMode: "afterEvaluate" })` | fresh context, own microtask queue |
| 144 | `desktop` | the run facade (`createDesktopFacade`), every engine method through `host.service.call` |
| 150 | `wait(ms \| predicate, { timeout, interval })` | host `setTimeout` polling (`run/wait.ts`) |
| 151 | `assert(condition, message)` | throws `ComputerRunError("assertion")` |
| 154 | `tool` | a `Proxy`: `tool.<name>(params)` calls `host.executeTool(name, params, { signal })`, the host tool pipeline (`senpi-desktop-tool/src/tool.ts:33`) |
| 163 | `console.*` | run output text |

The body is wrapped at lines 173-176 as `(async () => {<code>})()` and evaluated at line 177 with
`runInContext(..., { timeout })`;
every resume after an `await` is a bounded `runInContext` drain (`resumeVm`, line 126).

The doc comment of `runComputerCode` says it plainly (`runtime.ts:90-93`, repeated in
`packages/senpi-desktop-service/README.md:19`): "The vm is not a security boundary." The prelude guide agrees
(`packages/senpi-desktop-prelude/docs/computer.md:55`, "Not sandboxed"). Concretely:

- Every function placed in the context (`desktop.click`, `wait`, `assert`, the `tool` proxy, `console.log`)
  is a host-realm function. `desktop.click.constructor` is the host `Function`, so
  `desktop.click.constructor("return process")()` returns the host `process`, and from there `require`,
  the filesystem, the network and child processes. The context's own globals are irrelevant once one host
  object is reachable.
- `tool` reaches every tool the host session has, by name. Permission rules still apply to each call, but
  a grant to run `computer` code becomes a way to drive `bash`, `write`, `read` and the rest from code the
  user never sees as separate tool calls.
- `timeout` bounds synchronous stretches only. Heap is unbounded (a run can grow the host heap until the
  whole agent process dies) and recursion uses the host thread's stack.
- The run shares the host event loop and heap with the agent session.

## 2. Threats

In scope (the QuickJS cell must stop these):

| Id | Threat | Today (vm) | Required under quickjs |
|---|---|---|---|
| T1 | Realm escape through a host object (`x.constructor.constructor("return process")()`) | open | no host object ever enters the VM; every bridged value is copied (JSON) and every bridged function is a VM-realm stub |
| T2 | Ambient host APIs: `process`, `require`, `import()`, `fetch`, `Bun`, `Deno`, `WebAssembly`, `SharedArrayBuffer`/`Atomics`, timers, file and socket access | reachable via T1 | absent: `typeof X === "undefined"`, use throws `ReferenceError`; `import()` rejects (no module loader). The pinned engine defines `SharedArrayBuffer` itself (an inert buffer in wasm memory, `Atomics` absent); the cell prelude deletes `globalThis.SharedArrayBuffer` before user code so the absent list holds as stated |
| T3 | Tool reach: `tool.<name>` calls any host tool | open by design | `tool` is not bridged (`ReferenceError`) |
| T4 | Host DoS: infinite loop, heap growth, deep recursion, call flooding the engine | loop bounded; heap, stack and call count unbounded | wall, heap, stack and call-count limits, each a structured error (section 6); the host stays healthy and the next run works |
| T5 | Host-object mutation / prototype pollution of shared facade objects, inside the VM or on the host side | possible (facade objects live in the host realm) | impossible in the VM: it holds stubs only, the host keeps its objects in a per-run handle table. On the host side, arguments from the VM are data: they are parsed from JSON and passed to the engine, never merged into host state (section 4) |
| T6 | Work leaked past the run's end (pending promises, timers) resuming later | frozen by design (no drain after end) | the VM and its worker are destroyed at settle; nothing survives the run |
| T7 | Oversized results/output exhausting host memory or the model context | `cloneSafe` copy, size unbounded | return value and output are serialized across the boundary and capped (section 6) |
| T8 | Engine (QuickJS) memory-safety bug or trap | n/a | wasm linear memory in a worker thread: a crash or trap kills the worker, not the host, and the run settles at once with `sandbox` (section 5); the engine version is exact-pinned |

Out of scope (stated so nobody relies on the sandbox for them):

- Host-generated bodies. The CUA adapter's batch script is built by the host from validated actions; the
  setting governs model-written run code (M6).
- Code in the eval kernel itself. The js kernel's `computer` global already calls the `computer` tool
  through the kernel's own `tool` bridge; the run sandbox constrains only the body of one `run`. What a
  kernel cell may do is the eval tool's permission model, not this document's.
- Policy inside the bridge. `read_only`, the foreground control grant, the user's stop chord, `Suspended`,
  and the engine's own refusals keep applying to every bridged call exactly as they do under vm. The sandbox
  adds no new policy and removes none.
- Prompt injection through screen text. A script that obeys injected text can still do whatever the
  `computer` facade allows; that risk is handled by the policy above and by `computer-safety` guidance.
- Same-uid processes. Code running as the user can run the engine binary directly; the sandbox does not
  change that (the same limit the computer-use design records for the engine).
- Timing and other side channels inside the run.

## 3. Engine choice: `quickjs-wasi`

Candidates the design names: `quickjs-emscripten` (MIT) or a QuickJS wasm build Bun can load directly.

Decision: **`quickjs-wasi` (MIT), exact-pinned to the version the distribution already ships (3.6.2), run
in a `node:worker_threads` worker, one fresh VM per run.**

Reasons:

1. It is already proven in the shipped runtime. Senpi's eval sandbox cell (`@code-yeongyu/senpi-codemode`,
   `src/kernels/sandbox/`) depends on `quickjs-wasi` 3.6.2, and omo stages it and its `quickjs.wasm`
   (637,405 bytes) as required sidecars of the omo-ai distribution, nested under senpi-codemode
   (`script/engine-sidecar-sources.ts:110-157`, `script/engine-sidecar-sources.test.ts:213-220`). Using the
   same pin means the same engine build and the same behaviour, not zero weight (see the resolution below).
2. It already does what section 6 needs and it is proven on Bun: `QuickJS.create({ memoryLimit,
   maxStackSize, interruptHandler })`, where the interrupt handler reads a `SharedArrayBuffer` flag the host
   sets, so a spinning script stops without the host thread being blocked. omo's native eval smoke asserts the
   sandbox cell reports `quickjs`, has no `process` and no `fetch` (`script/qa/omo-native-eval-smoke-assertions.mjs:42-77`).
3. `quickjs-emscripten` would be a new dependency with several build variants (sync vs asyncify), a
   larger payload, and no in-repo precedent; its asyncify variant is the only one that lets a host call be
   awaited synchronously, which we do not need (section 5 settles promises from the host instead).
4. A plain wasm instance with no WASI file or socket imports wired in gives T2 by construction: the only
   way out of the VM is the bridge function we register.

Resolution (decided here for row 22): `senpi-desktop-service` takes `quickjs-wasi` as its own exact-pinned
dependency (3.6.2, matching senpi-codemode's) and writes its own small worker. The service runtime ships inside
the bundle `packages/omo-senpi/plugin/extensions/omo-computer-use.js` (163,697 bytes today, no QuickJS in it), so
the bundle keeps `quickjs-wasi` external and the sidecar list gains an entry for the service's own copy with its
`.wasm`. The sidecar rule stages the whole dependency directory
(`script/engine-sidecar-sources.ts:116`): 1,524,119 bytes, of which `dist` plus `quickjs.wasm` are 946,844 and five
`extensions/*.so` are 540,178 (not needed by the service; row 22 may exclude `extensions/` from its entry). Row 22
measures the staged copy and puts the number
and the bundle-size ceiling in its PR body. The alternative, loading the wasm through senpi-codemode's nested
path, is rejected: it couples the service to another package's install layout. The service does not import
senpi-codemode's vendored `pi-codemode` runtime either (another package's internal, with its own vendoring
record).

## 4. Bridge surface

The cell exposes exactly two run names, `computer` (alias `desktop`) and `assert`, plus `console` for output.
Only `computer` is bridged to the host; `assert` and `console` are implemented inside the VM and make no host
call (an `assert` failure reaches the host only as the run's rejection):

| Global | Under quickjs |
|---|---|
| `computer` | the run facade, as VM-side stubs generated from the four method tables in `senpi-desktop-protocol/src/call.ts` (`DESKTOP_METHODS` :13, `DISPLAY_METHODS` :42, `WINDOW_METHODS` :57, `ELEMENT_METHODS` :79): every method returns a promise settled by the host call queue |
| `desktop` | the same object as `computer` (kept so existing bodies that say `desktop.` keep working) |
| `assert(condition, message?)` | VM-side; throws an error the host maps to `ComputerRunError("assertion")` |
| `console.log/info/warn/error/debug` | VM-side; formats in the VM and appends to run output (capped), never a host call |

Not bridged: `tool`, `wait`, and anything else. `wait`'s job moves to `computer.verify` (a condition the
engine checks with its own deadline; it lands with the verify helper row).

Handles. The facade returns three handle kinds, and each becomes a VM stub:

| Kind | Created by | Methods | Snapshot fields (read without a call) |
|---|---|---|---|
| window | `desktop.window(...)` (`WindowHandle`, `run/handles.ts:42-48`) | `WINDOW_METHODS` | `id`, `app`, `title`, `pid`, `bounds`, `focused` |
| element | `desktop.ref(...)`, `win.find(...)`, `el.children()` (`ElementHandle`, `run/handles.ts:111-119`) | `ELEMENT_METHODS` | `ref`, `role`, `nativeRole`, `title`, `description`, `enabled`, `focused`, `childCount` |
| display | `desktop.display("all" \| "active" \| id)` (`InputTarget` over `DISPLAY_METHODS`, `run/facade.ts:58-63`) | `DISPLAY_METHODS` | `id` |

A stub carries its engine identity (window `id`, element `ref`, or `display:<selector>`, the same keys the
facade already re-resolves on every call, `run/handles.ts:41,110`) plus its snapshot fields as plain JSON
properties, so bodies that read `editor.title` or `el.role` synchronously (`run.test.ts:103` does) keep working.
The host keeps no per-handle objects: a stub's call names its identity and the host re-resolves it exactly as the
vm facade does, so a body that creates thousands of handles costs the host nothing between calls. An identity
from an earlier run is refused like any unknown id/ref today.

Values. Everything crosses as JSON: arguments host-ward, results VM-ward. Functions, `RegExp` and other
non-JSON values are refused at the boundary with a `TypeError` in the VM (a facade method that needs a
predicate takes a declarative query instead, as `find` does today). Arguments are data: the host parses them
and passes them to the engine request; it never `Object.assign`s or spreads a VM-derived object into a host
object that outlives the call (today's facade spreads caller params into the engine request object,
`run/handles.ts:136`, which is safe only because that object is the request itself). A `"__proto__"` key in
an argument stays an inert own property.

Serialization rules, both directions (the builder of row 32 implements exactly these):

- Host-ward arguments go through `JSON.stringify` with an explicit replacer that throws a VM `TypeError` on a
  function, `RegExp`, symbol, `bigint`, `NaN` or `Infinity` (plain `JSON.stringify` would silently drop the first
  two, turn the next into `{}` and the last two into `null`). `undefined` in an argument list is kept as an absent
  trailing argument or an absent property, as JavaScript calls already treat it.
- VM-ward results travel in an envelope `{ "ok": true, "value": <json> }`; an `undefined` result (for example
  `el.value()`, `run/handles.ts:146-148`) is the envelope without `value`, and `pid` and other optional snapshot
  fields are simply absent, so the VM sees `undefined`, not `null`.
- Dotted method names in the tables (`clipboard.read`, `control.acquire`, `menu.items`, ...) become nested stub
  namespaces (`computer.clipboard.read()`), exactly the shape the vm facade exposes.

## 5. Async host call queue

The VM is single-threaded and its host function cannot block, so a bridged call is a message:

1. VM: `computer.window({ app })` calls the registered bridge with `(callId, method, argsJson)` and returns a
   pending VM promise.
2. Worker posts `{ type: "call", id, method, args }` to the host.
3. Host: the queue runs **one SDK call at a time** per run, FIFO. A second call that arrives while one is in
   flight waits in the queue; it is never sent to the engine concurrently. `Promise.all([...])` in the script
   is therefore legal and serialized.
4. Host replies `{ id, ok, payload }`; the worker settles that promise and runs `executePendingJobs()` to
   resume the script.
5. Each call goes through the same facade code path the vm mode uses (`facadeMethod` -> `guardRun` ->
   `host.service.call`), so read-only refusal, the run signal, audit records and engine cancellation are
   shared, not reimplemented.
6. A script that awaits nothing the host can ever settle (no call in flight, nothing queued, VM job queue
   empty) fails at once with `stalled` instead of hanging to its wall deadline.
7. One live worker per session: a second run in the same desktop session (`service.ts:35` allows concurrent
   calls) waits FIFO for the first to settle, with its own `timeout` counted from submission, so parallel
   `computer` calls never hold more than one 64 MiB VM per session.

Abort and deadline: `worker.terminate()` is the wall enforcement of record. The host first sets the
interrupt flag (QuickJS polls it at interpreter checkpoints, so it stops ordinary loops at once), cancels the
in-flight engine call (`$/cancel`, as today) and drops queued calls, then terminates the worker without
waiting for the flag to be seen: a single long builtin (regex backtracking, a huge `repeat`) never reaches a
checkpoint, and terminate still ends it. The run settles with the error. The failed-run control revoke
(`runtime.ts:199`) applies unchanged.

Worker crash: a worker `error` or `exit` before the run settled (a wasm trap, an engine bug, T8) settles the
run at once with `ComputerRunError("sandbox")`, cancels the in-flight call, revokes the grant, and the next
run starts a fresh worker. A crash never leaves a run pending until its wall deadline.

Result size, VM-ward: an engine result is checked against a per-result cap (8 MiB serialized) on the host
before it is copied into the VM; over the cap, the bridged call rejects inside the VM with
`ComputerRunError("payloadSize")` naming the size (the worker applies the same rule host-ward: an argument list
over 1 MiB is rejected before it is posted), so the script can narrow the query (`observe({ since })`, a
subtree) instead of the run dying on the 64 MiB heap.

## 6. Limits and structured errors

All limits are per run. `ComputerRunErrorReason` (`run/context.ts:10`) gains six values: `calls`, `memory`,
`stack`, `payloadSize`, `stalled`, `sandbox`. Existing values keep their meaning; in particular `unavailable`
stays "this engine lacks the feature" (`run/observe.ts:33`, `run/hold-call.ts:10`) and is not reused for a crash.

| Limit | Default | Enforced by | Error (`ComputerRunError.reason`) | Fatal to the run? |
|---|---|---|---|---|
| Wall | the run's `timeout` (default 60 s, max 600 s, `senpi-desktop-tool/src/params.ts:3-5`) | host timer, interrupt flag, then `worker.terminate()` (section 5) | `timeout` (existing) | yes |
| Bridged calls | 1,000 per run | host call queue counter | `calls` | yes |
| Heap | 64 MiB VM memory | `memoryLimit` | `memory` (QuickJS `InternalError: out of memory`) | yes |
| Stack | QuickJS `maxStackSize` guard | `maxStackSize` | `stack` (QuickJS `RangeError: Maximum call stack size exceeded`, reported by the host) | yes |
| Bridged payload, either direction | 8 MiB serialized per result (VM-ward), 1 MiB per argument list (host-ward) | host before copying a result in; worker before posting arguments out | `payloadSize`, as a rejection of that one call inside the VM | no: catchable, the body can narrow its query |
| Stall | nothing in flight, nothing queued, VM job queue empty | host, after each drain | `stalled` | yes, at once |
| Worker crash | n/a | worker `error`/`exit` handler | `sandbox` | yes, at once |
| Output + return value | 1 MiB serialized per run | worker, before posting | none: truncated (see note) | no |

Note on output: an oversized console stream is cut with a visible marker. An oversized return value is
never handed to the model as broken JSON: it becomes a string holding the first part of its serialization
followed by the marker `[return value truncated: N bytes, cap 1 MiB]`. Neither fails the run; the row exists
so row 22 tests the cap, not to add an error code.

Every fatal limit error settles the run, revokes the control grant, leaves the host process and the desktop
session usable, and the next run in the same session succeeds. The numbers are starting values for row 22;
they are constants in one file, measured in the row 22 PR body, not settings.

## 7. Compatibility matrix

Under quickjs, a body that references `tool` or `wait` breaks. Every such body found by the scan in
section 10 is one row. "vm-only" means the body keeps running under vm and, in run.test.ts, gets a quickjs
counterpart that asserts the `ReferenceError` (row 32); no test is skipped.

| Id | Site | Uses | What it does | Migration |
|---|---|---|---|---|
| M1 | `packages/senpi-desktop-service/test/run.test.ts:303` | `tool` | "reaches the host executeTool from tool.<name> inside the run" (`tool.read`) | not available under quickjs; vm-only. Row 32 keeps it under vm and adds a quickjs counterpart expecting `ReferenceError: tool is not defined` |
| M2 | `packages/omo-senpi/scripts/qa/computer-control-live-macos-scenarios.mjs:149` | `wait` | `interrupted` live scenario: acquire the grant, then `await wait(30000)` to keep the run open while the driver aborts it | `wait` -> `computer.verify` with a condition that never holds and a 30 s deadline (keeps a host call in flight, so the abort still cancels it); until verify exists the driver pins `computer.run_sandbox: "vm"` |
| M3 | `packages/senpi-desktop-prelude/docs/computer.md:54` | `wait` (doc) | guide entry: functions receive `{ desktop, wait, assert }`; "Not sandboxed" | when quickjs is selectable, the guide says functions receive `{ computer, desktop, assert }` under quickjs, `wait` -> `computer.verify`, and states the sandbox per setting (regenerated guide, P14) |
| M4 | `packages/senpi-desktop-prelude/README.md:22` | `wait` (doc) | documents the serialized `computer.run(fn)` call `({ desktop, wait, assert }, ...args)` | same doc change as M3, in step with M5 |
| M5 | `packages/senpi-desktop-prelude/src/prelude.js:132` | `wait` (generated) | `computer.run(fn)` serializes every function as `return await (fn)({ desktop, wait, assert }, ...args);` | **blocks every function-form run under quickjs**: the shorthand `wait` is a reference, so even a function that never uses `wait` throws `ReferenceError`. The generated call must stop naming absent globals (pass `{ desktop, computer: desktop, assert }` under quickjs, or one runtime-provided scope object). Owner: the prelude rows (P4a/P14), which must also regenerate the two tracked `assets.generated.json` copies and `test/assets.sha256.json` (plan row 26, `senpi-desktop-prelude/scripts/generate-assets.ts`); a prerequisite of the default flip; the test harness that executes the generated body, `packages/senpi-desktop-prelude/test/js-facade.test.ts:141` (`new AsyncFunction("desktop", "wait", "assert", code)`), changes in the same PR; row 32's quickjs tests include a body in this generated shape |
| M6 | `packages/senpi-desktop-tool/src/cua-actions.ts:147` | `wait` (generated) | `actionsScript()`: the CUA adapter's batch body; the published `wait` action runs `await wait(a.ms)` | host-generated from schema-validated JSON, not model-written JS, so sandboxing it gains nothing, ON CONDITION that every model-provided value enters the script only through `JSON.stringify` (`cua-actions.ts:147-148`: `actions` and `bounds`); any change that splices model text into the script any other way voids this exemption and moves the body to quickjs. The CUA adapter keeps running its batches under `vm` whatever `computer.run_sandbox` says. Mechanism (row 22): `ComputerRunRequest` (`run/runtime.ts:30`, internal, not a published parameter) gains `origin: "model" | "host"`, default `model`; the CUA adapter's path (`cua-adapter.ts:63-66` -> `tool.ts:98-110` -> `runComputerCode`) passes `host`, and the dispatcher sends every `host` run to `vm` (row 22 test 12). This holds until P14 executes CUA actions directly through the SDK (where `wait` is a host sleep, no script). Published `computer_actions` parameters do not change |
| M7 | `packages/senpi-desktop-tool/test/control.test.ts:97` | `wait` | "sends control.revoke when the tool call is aborted mid-run while granted": holds the run with `wait(() => false, { timeout: 4000 })` | vm-only today (the test exercises vm); a quickjs counterpart holds the run with `computer.verify` once it exists |
| M8 | `packages/senpi-desktop-tool/test/execute.test.ts:121` | `tool` | tool-level run that calls `tool.read` through the host pipeline | not available under quickjs; vm-only |

Model-facing contract text. The model reads these before it writes a run body, and each promises `wait` and
`tool` in scope:

| Id | Site | Uses | What it is | Migration |
|---|---|---|---|---|
| M9 | `docs/reference/computer.md:22` | `wait`, `tool` (contract text) | omo `computer` tool reference: `run` takes a body with `desktop`, `wait`, `assert` and `tool` | see below |
| M10 | `packages/omo-senpi/scripts/qa/fused-equivalence-golden/darwin-arm64/E21.json:1878` | `wait`, `tool` (contract text) | recorded golden of the tool description (darwin-arm64) | see below |
| M11 | `packages/omo-senpi/scripts/qa/fused-equivalence-golden/darwin-arm64/E21.json:1919` | `wait`, `tool` (contract text) | recorded golden of the `code` parameter description (darwin-arm64) | see below |
| M12 | `packages/omo-senpi/scripts/qa/fused-equivalence-golden/darwin-arm64/E21.json:3714` | `wait`, `tool` (contract text) | second recorded copy of the tool description (darwin-arm64) | see below |
| M13 | `packages/omo-senpi/scripts/qa/fused-equivalence-golden/darwin-arm64/E21.json:3755` | `wait`, `tool` (contract text) | second recorded copy of the `code` parameter description (darwin-arm64) | see below |
| M14 | `packages/omo-senpi/scripts/qa/fused-equivalence-golden/linux-x64/E21.json:1878` | `wait`, `tool` (contract text) | recorded golden of the tool description (linux-x64) | see below |
| M15 | `packages/omo-senpi/scripts/qa/fused-equivalence-golden/linux-x64/E21.json:1919` | `wait`, `tool` (contract text) | recorded golden of the `code` parameter description (linux-x64) | see below |
| M16 | `packages/omo-senpi/scripts/qa/fused-equivalence-golden/linux-x64/E21.json:3714` | `wait`, `tool` (contract text) | second recorded copy of the tool description (linux-x64) | see below |
| M17 | `packages/omo-senpi/scripts/qa/fused-equivalence-golden/linux-x64/E21.json:3755` | `wait`, `tool` (contract text) | second recorded copy of the `code` parameter description (linux-x64) | see below |
| M18 | `packages/omo-senpi/src/components/computer-use/published-parameters.fixture.json:42` | `wait`, `tool` (contract text) | frozen published `code` parameter description | see below |
| M19 | `packages/senpi-desktop-tool/src/params.ts:41` | `wait`, `tool` (contract text) | `code` parameter description of the `run` action (published) | see below |
| M20 | `packages/senpi-desktop-tool/src/params.ts:77` | `wait`, `tool` (contract text) | `code` parameter description of the flat schema (published) | see below |
| M21 | `packages/senpi-desktop-tool/src/tool-definition.ts:27` | `wait`, `tool` (contract text) | `computer` tool description the model reads | see below |
| M22 | `packages/senpi-desktop-service/README.md:18` | `wait`, `tool` (developer docs) | the service README: the run context's globals are `desktop`, `wait(ms \| predicate, ...)`, `assert`, `console` and `tool.<name>(params)` | developer-facing, not read by the model: row 22 updates it with the dispatch to describe both modes (vm: all five; quickjs: `computer`/`desktop`, `assert`, `console`) |

Migration for M9-M21 (M22 is the developer README, migrated by row 22 as its row says): while `vm` is the default these texts are accurate. Once `quickjs` is selectable (row 32)
they are inaccurate for a session that selects it; this document is the record of that until the flip. Plan row
36 freezes `published-parameters.fixture.json`, so the text cannot change inside this plan. The flip's follow-up
PR makes the descriptions setting-neutral or per-setting (`computer`/`desktop` and `assert` always; `wait` and
`tool` only under `vm`), re-records the fixture and both E21 goldens (linux-x64 here, darwin-arm64 on a Mac) with
the reason, and updates `docs/reference/computer.md`. That PR is a flip prerequisite (section 8).

Not rows: the doc comment at `runtime.ts:91` names the vm globals but is implementation prose, not model-facing
(row 22 updates it with the dispatch); `packages/senpi-desktop-prelude/src/prelude.py:200` builds
`{"action": "run", "code": code}` from a code string the caller wrote, a pass-through with no scope of its own.

The remaining bodies (134 of 156 scanned entries) need no change: they use only `desktop`/`computer`,
`assert`, `console` and plain JS, including the display-handle bodies that depend on section 4's third handle
kind (`display.test.ts`, `zoom.test.ts`, `global-input-grant.test.ts`, `computer-use-e2e.mjs:144`,
`fused-equivalence-e2e.mjs:215`).

Existing users who need `tool` inside a run keep it by leaving `computer.run_sandbox` at `vm`, which stays
selectable after any default change.

## 8. Flag plan

- Setting: `computer.run_sandbox: "vm" | "quickjs"`, native harness only, reserved by the settings row of the
  computer-use v2 plan; default `vm`.
- Row 22 (P5b-i): QuickJS cell with limits and the escape battery, `assert` only; the setting selects the
  path for model-origin runs, host-origin (CUA) runs stay on `vm` (M6); default stays `vm`.
- Row 32 (P5b-ii): `computer`/`desktop` + `assert` bridge through the host call queue; run.test.ts runs over
  both modes except M1; default stays `vm`.
- Row 35 (P13b): the computer-use eval and bench. It does not select `computer.run_sandbox`, is not blocked by
  row 32, and its model arms use a fake model server, so it is a baseline, not evidence that model-written code
  survives quickjs.
- Row 36 (P14a): keeps the default at `vm`, keeps the published parameters unchanged, and opens the follow-up
  issue for the flip, attaching the row 35 eval evidence. That issue names its gate: the model+tool eval arm
  re-run with `computer.run_sandbox: "quickjs"` after row 32 merges, with a real model on a sanctioned QA
  account.
- The flip to `quickjs` happens in a later release, only after: live macOS QA of the bridged path; the
  quickjs model+tool eval run named above passing; M5 fixed; M2/M7 migrated or pinned to `vm`; M6 still on
  `vm` (under its JSON-only condition) or replaced by direct SDK execution; and M9-M21 made accurate for both
  settings, with the fixture and goldens re-recorded. `vm` remains a supported value after the flip.

## 9. Required tests

Row 22 (`packages/senpi-desktop-service`, quickjs mode):

1. Escape battery, each throwing `ReferenceError` and `typeof X === "undefined"`: `require("fs")`,
   `process.exit()`, `fetch("x")`, `Bun.file("x")`, `tool.computer({})`, `wait(1)`.
2. Realm escape: `assert.constructor("return typeof process")()` returns `"undefined"` (the VM's own
   `Function`), and `Object.keys(globalThis)` holds no host name.
3. `import("fs")` rejects; `WebAssembly`, `SharedArrayBuffer` (deleted by the cell prelude; the engine defines it),
   `Atomics`, `setTimeout` are undefined.
4. Limits, each with its reason: `while (true) {}` -> `timeout`; `const a = []; for (;;) a.push("x".repeat(1e6))`
   -> `memory`; `const f = () => f(); f()` -> `stack`; the host is healthy and the next run in the same
   session returns its value.
5. A pure-JS body returns its value (`return 1 + 1` -> `2`, `details.sandbox === "quickjs"`).
6. Control: under `vm`, `return typeof tool` is `"object"`; under `quickjs` it is `"undefined"`.
7. Every existing run.test.ts case still passes in `vm` mode.
8. A single long builtin (`/(a+)+$/.test("a".repeat(40) + "b")`) under a short `timeout` settles with `timeout`
   by `worker.terminate()`; the next run works.
9. Worker crash: a worker that exits before the run settles (test hook) settles the run at once with
   `sandbox`, not at the wall deadline; the next run works.
10. Output caps: a console stream past 1 MiB is cut with the marker; a return value past 1 MiB comes back as a
    string ending in the truncation marker, never as invalid JSON.
11. Stall: `await new Promise(() => {})` settles with `stalled` well before a 30 s `timeout`.
12. Host origin: with `computer.run_sandbox: "quickjs"`, a CUA batch containing a `wait` step runs (the request
    carries `origin: "host"`, the dispatcher keeps it on `vm`, `details.sandbox === "vm"`), while a model `run`
    of `wait(1)` in the same session throws `ReferenceError`.

Row 32 (bridge):

1. run.test.ts parametrized over `vm` and `quickjs` for every body except M1; M1 runs under `vm` and its
   quickjs counterpart asserts the `ReferenceError`; zero skipped.
2. `computer` and `desktop` are the same bridged object; `const w = await computer.window({ app: "Fake" });
   return (await w.screenshot()).width` returns the fake width.
3. One call at a time: `await Promise.all([computer.windows(), computer.displays()])` resolves both, and the
   fake engine observes the second request only after the first response.
4. `calls` limit: a loop of bridged calls past the cap fails with `calls`, the in-flight call is cancelled.
5. Read-only refusal, abort (`$/cancel` for the in-flight call) and timeout behave as in vm mode.
6. Handles: a handle from one run is unknown in the next run; a non-JSON argument is a VM `TypeError`.
7. The generated `computer.run(fn)` shape (M5) runs under quickjs once the prelude stops naming `wait`;
   until then the test pins today's failure (`ReferenceError`), so the gap is visible.
8. `tool` and `wait` remain absent after bridging.
9. Display handles: `const all = await desktop.display("all"); return (await all.screenshot({ silent: true })).width`
   returns the fake composite width, and `await (await desktop.display("2")).click(20, 10)` reaches the engine
   with the display target.
10. Snapshot fields: `const w = await desktop.window({ app: "Code" }); return [w.title, w.id]` and
    `const el = await desktop.ref("e1"); return el.role` return the snapshot without an extra engine call.
11. Arguments are data: a call whose argument object carries a `"__proto__"` key leaves `Object.prototype` on
    the host unchanged and the engine receives the key as an own property.
12. Payload caps: a fake engine result past 8 MiB, and an argument list past 1 MiB, each reject that call inside
    the VM with `payloadSize`; a `try/catch` in the body recovers and the run returns normally.
13. Serialization: `computer.windows(() => true)` and `computer.click(NaN, 1)` throw a VM `TypeError` before any
    engine request; `(await computer.ref("e1")).value()` on an element with no value returns `undefined`;
    `computer.clipboard.read` is a nested function.
14. One worker per session: two concurrent `run` calls in one session execute one after the other (the fake engine
    sees the second run's first request only after the first run settled), each within its own timeout.

## 10. How the matrix was built

Two scans, both re-runnable from the repository root.

Plain grep over the acceptance-named sources (every hit classified below the output):

```sh
grep -nE '\bwait\(|\btool\.[A-Za-z_]+\(|\{ desktop, wait' packages/senpi-desktop-service/test/run.test.ts packages/omo-senpi/scripts/qa/*.mjs packages/senpi-desktop-prelude/docs/computer.md
```

```text
packages/senpi-desktop-service/test/run.test.ts:303:    const result = await run(service, `return (await tool.read({ path: "notes.txt" })).content[0].text;`, {
packages/omo-senpi/scripts/qa/agent-toolkit-catalog-qa.mjs:39:    return tool.execute("qa-call", {}, undefined, undefined, {})
packages/omo-senpi/scripts/qa/claim-receipt-e2e.mjs:43:        code: "const r = await tool.bash({ command: \"echo 'bun test (simulated)'; printf ' 3 pass\\\\n 0 fail\\\\n'\" }); print(r.text)",
packages/omo-senpi/scripts/qa/computer-control-live-macos-scenarios.mjs:149:      run(`${acquire} await wait(30000); return JSON.stringify(state)`),
packages/omo-senpi/scripts/qa/desktop-toolkit-rpc-e2e.mjs:35:  code: 'const r = await tool.omo_desktop_toolkit({ op: "acquire", toolkit: "browser" }); print("TOOLKIT_RESULT " + JSON.stringify(r.details ?? r))',
packages/omo-senpi/scripts/qa/fused-equivalence-support.mjs:186:const pauseSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
packages/omo-senpi/scripts/qa/kernel-tools-python-e2e.mjs:3:// omo child by that Python cell (`tool.task(..., tools=["add"])`); the child calls it and the call runs back in the parent kernel.
packages/omo-senpi/scripts/qa/kernel-tools-python-e2e.mjs:28:const CALL_CHILD = "reply = tool.task(prompt='MOCK' + 'ROLE=quick add 1 and 2 with the add tool', subagent_type='fixture', tools=['add'])\nreply"
packages/omo-senpi/scripts/qa/parallelism-eval-e2e.mjs:43:          '  tool.read({ path: "qa-note.txt" }),',
packages/omo-senpi/scripts/qa/parallelism-eval-e2e.mjs:44:          '  tool.bash({ command: "printf qa-eval-e2e" }),',
packages/omo-senpi/scripts/qa/plan-gated-agents-e2e.mjs:202:          code: `const started = await tool.workflow(${JSON.stringify({ action: "start", definition: DAG_RETIRED_DEFINITION })});\nconsole.log(JSON.stringify(started));`,
packages/omo-senpi/scripts/qa/probe-continuation.mjs:139:      wait(250)
packages/omo-senpi/scripts/qa/probe-continuation.mjs:176:function wait(milliseconds) {
packages/omo-senpi/scripts/qa/probe-continuation.mjs:177:  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
packages/omo-senpi/scripts/qa/task-host-e2e-storm.mjs:13:      code: `var result = await tool.bash({ command: "true # storm-${index}" });
packages/omo-senpi/scripts/qa/task-lane-spill-e2e.mjs:254:  // Attached and NOT unref'd on purpose: a detached+unref'd helper is never wait()ed on, so it
packages/omo-senpi/scripts/qa/task-load-skills-e2e.mjs:81:        code: `const result = await tool.bash({ command: "printf 'bounded executor output\\\\n' > executor.txt && git add executor.txt && git -c user.name='QA Executor' -c  [...]
packages/omo-senpi/scripts/qa/ulw-goal-footer-tui.mjs:190:                'const out = await tool.bash({ command: \'"$OMO_BIN" ulw-loop create-goals\' })',
packages/senpi-desktop-prelude/docs/computer.md:4:    Every helper is one `tool.computer({ action: "call", chain })` call. Permission tiers: inspection needs `computer:read`, input and mutation need `computer:exec`; a denied call  [...]
packages/senpi-desktop-prelude/docs/computer.md:55:    One multi-step JS run in the persistent desktop session. Functions receive `{ desktop, wait, assert }` (`desktop` = same helpers) and cannot capture cell closures; `args` pass [...]
```

Classification of the grep hits: run.test.ts:303 = M1; computer-control-live-macos-scenarios.mjs:149 = M2;
computer.md:55 = M3 (its entry starts at line 54). Every other hit is not a `computer` run body:
`claim-receipt-e2e.mjs:43`, `desktop-toolkit-rpc-e2e.mjs:35`, `kernel-tools-python-e2e.mjs:28`,
`parallelism-eval-e2e.mjs:43-44`, `plan-gated-agents-e2e.mjs:202`, `task-host-e2e-storm.mjs:13`,
`task-load-skills-e2e.mjs:81` and `ulw-goal-footer-tui.mjs:190` are eval-kernel cells whose `tool` is the
codemode bridge; `agent-toolkit-catalog-qa.mjs:39` is host test code calling a tool definition;
`fused-equivalence-support.mjs:186` and `probe-continuation.mjs:139-177` are host `Atomics.wait` helpers;
`task-lane-spill-e2e.mjs:254` is a comment; `computer.md:4` describes the prelude's own transport.

AST scan (TypeScript parser) over the same sources plus every other file that builds a run body: it finds
each `code` of an `action: "run"` object, each argument of a local or imported run-building helper
(`run(service, code)`, `run(code)`, `runCode`, `onWindow(title, body)`), each `computer.run(...)` argument,
the facade's generated `code = ...`, every code-shaped literal that awaits `desktop.` (this is how the
CUA adapter's generated batch body is found; producer sources under `packages/senpi-desktop-*/src` and the
computer-use component are scanned whether or not they mention a run call), and in Markdown each `computer.run(` / `action: "run"` entry; in-scope
`const` strings, `[...].join()` and `it.each`/`[...].map` tables are expanded. A second pass parses every
other string literal of those files; one that fails to parse is still listed when a regex sees `tool.`,
`wait(`, or a backticked `` `tool` `` / `` `wait` ``. Contract text (a backticked `desktop` followed
by a backticked `wait` or `tool`, with or without its own signature inside the backticks) in source literals, Markdown lines and JSON lines (the fixture, the goldens) is
a matrix row of its own (M9-M22). `.py` files are walked for `"action": "run"` dicts. The script and its full output are kept as local
evidence of the row (`.omo/evidence/` is never committed; the PR body carries their sha256 lines); its summary at 7adadfb805:

```text
A  packages/senpi-desktop-service/test/run.test.ts  bodies=20  tool_or_wait=1
A  packages/omo-senpi/scripts/qa/computer-control-live-macos-desktop.mjs  bodies=6  tool_or_wait=0
A  packages/omo-senpi/scripts/qa/computer-control-live-macos-scenarios.mjs  bodies=6  tool_or_wait=1
A  packages/omo-senpi/scripts/qa/computer-control-rpc-e2e.mjs  bodies=1  tool_or_wait=0
A  packages/omo-senpi/scripts/qa/computer-use-e2e.mjs  bodies=5  tool_or_wait=0
A  packages/omo-senpi/scripts/qa/fused-equivalence-e2e.mjs  bodies=1  tool_or_wait=0
A  packages/omo-senpi/scripts/qa/task-stats-renderer.mjs  bodies=1  tool_or_wait=0
A  packages/senpi-desktop-prelude/docs/computer.md  bodies=1  tool_or_wait=1
B  docs/reference/computer.md  bodies=1  tool_or_wait=1
B  packages/omo-senpi/scripts/qa/fused-equivalence-golden/darwin-arm64/E21.json  bodies=4  tool_or_wait=4
B  packages/omo-senpi/scripts/qa/fused-equivalence-golden/linux-x64/E21.json  bodies=4  tool_or_wait=4
B  packages/omo-senpi/src/components/computer-use/index.telemetry.test.ts  bodies=1  tool_or_wait=0
B  packages/omo-senpi/src/components/computer-use/published-parameters.fixture.json  bodies=1  tool_or_wait=1
B  packages/omo-senpi/src/components/computer-use/telemetry.test.ts  bodies=3  tool_or_wait=0
B  packages/senpi-desktop-prelude/README.md  bodies=1  tool_or_wait=1
B  packages/senpi-desktop-prelude/src/prelude.js  bodies=1  tool_or_wait=1
B  packages/senpi-desktop-prelude/src/prelude.py  bodies=2  tool_or_wait=0
B  packages/senpi-desktop-prelude/test/js-facade.test.ts  bodies=2  tool_or_wait=0
B  packages/senpi-desktop-prelude/test/py-facade.test.ts  bodies=1  tool_or_wait=0
B  packages/senpi-desktop-service/README.md  bodies=1  tool_or_wait=1
B  packages/senpi-desktop-service/test/control-boundaries.test.ts  bodies=4  tool_or_wait=0
B  packages/senpi-desktop-service/test/display.test.ts  bodies=5  tool_or_wait=0
B  packages/senpi-desktop-service/test/holds.test.ts  bodies=7  tool_or_wait=0
B  packages/senpi-desktop-service/test/legacy-capabilities.test.ts  bodies=1  tool_or_wait=0
B  packages/senpi-desktop-service/test/observe.test.ts  bodies=6  tool_or_wait=0
B  packages/senpi-desktop-service/test/zoom.test.ts  bodies=7  tool_or_wait=0
B  packages/senpi-desktop-tool/README.md  bodies=1  tool_or_wait=0
B  packages/senpi-desktop-tool/src/cua-actions.ts  bodies=1  tool_or_wait=1
B  packages/senpi-desktop-tool/src/params.ts  bodies=2  tool_or_wait=2
B  packages/senpi-desktop-tool/src/tool-definition.ts  bodies=1  tool_or_wait=1
B  packages/senpi-desktop-tool/test/audit-dir.characterization.test.ts  bodies=3  tool_or_wait=0
B  packages/senpi-desktop-tool/test/control.test.ts  bodies=2  tool_or_wait=1
B  packages/senpi-desktop-tool/test/execute.test.ts  bodies=4  tool_or_wait=1
B  packages/senpi-desktop-tool/test/launch-refusal.test.ts  bodies=2  tool_or_wait=0
B  packages/senpi-desktop-tool/test/permission.test.ts  bodies=2  tool_or_wait=0
B  packages/senpi-desktop-tool/test/tool-definition.test.ts  bodies=2  tool_or_wait=0
B  packages/senpi-task/src/run-stats-eval.test.ts  bodies=1  tool_or_wait=0
B  script/qa/desktop/macos/scenario.ts  bodies=4  tool_or_wait=0
B  packages/senpi-desktop-service/test/control.test.ts  bodies=18  tool_or_wait=0
B  packages/senpi-desktop-service/test/full-access-consent.test.ts  bodies=9  tool_or_wait=0
B  packages/senpi-desktop-service/test/global-input-grant.test.ts  bodies=7  tool_or_wait=0
B  script/qa/desktop/macos/scenarios-input.ts  bodies=3  tool_or_wait=0
B  script/qa/desktop/macos/scenarios-safety.ts  bodies=1  tool_or_wait=0

## totals: bodies=156 (tier A 41, tier B 115); referencing tool/wait=22; bodies that did not parse=5

ROW A packages/senpi-desktop-service/test/run.test.ts:303 refs=tool kind=helper run() :: return (await tool.read({ path: "notes.txt" })).content[0].text;
ROW A packages/omo-senpi/scripts/qa/computer-control-live-macos-scenarios.mjs:149 refs=wait kind=helper run() :: const state = await desktop.control.acquire({ reason: __SUB__ }); await wait(30000); return JSON.stringify(state)
ROW A packages/senpi-desktop-prelude/docs/computer.md:54 refs=wait kind=markdown entry :: computer.run(fnOrCode, { args?, read_only?, timeout? }?) → value One multi-step JS run in the persistent desktop session. Functions receive `{ desktop [...]
ROW B docs/reference/computer.md:22 refs=tool,wait kind=contract text (markdown) :: | `run` | `code`: JavaScript async function body with `desktop`, `wait`, `assert` and `tool`; optional `read_only` and `timeout` in seconds | The returned v [...]
ROW B packages/omo-senpi/scripts/qa/fused-equivalence-golden/darwin-arm64/E21.json:1878 refs=tool,wait kind=contract text (json) :: "description": "Drive the user's real desktop (experimental): windows, screenshots, native mouse and keyboar [...]
ROW B packages/omo-senpi/scripts/qa/fused-equivalence-golden/darwin-arm64/E21.json:1919 refs=tool,wait kind=contract text (json) :: "description": "run (required): JavaScript async function body; `desktop`, `wait`, `assert`, `tool` in scope [...]
ROW B packages/omo-senpi/scripts/qa/fused-equivalence-golden/darwin-arm64/E21.json:3714 refs=tool,wait kind=contract text (json) :: "description": "Drive the user's real desktop (experimental): windows, screenshots, native mouse and keyboar [...]
ROW B packages/omo-senpi/scripts/qa/fused-equivalence-golden/darwin-arm64/E21.json:3755 refs=tool,wait kind=contract text (json) :: "description": "run (required): JavaScript async function body; `desktop`, `wait`, `assert`, `tool` in scope [...]
ROW B packages/omo-senpi/scripts/qa/fused-equivalence-golden/linux-x64/E21.json:1878 refs=tool,wait kind=contract text (json) :: "description": "Drive the user's real desktop (experimental): windows, screenshots, native mouse and keyboard i [...]
ROW B packages/omo-senpi/scripts/qa/fused-equivalence-golden/linux-x64/E21.json:1919 refs=tool,wait kind=contract text (json) :: "description": "run (required): JavaScript async function body; `desktop`, `wait`, `assert`, `tool` in scope; ` [...]
ROW B packages/omo-senpi/scripts/qa/fused-equivalence-golden/linux-x64/E21.json:3714 refs=tool,wait kind=contract text (json) :: "description": "Drive the user's real desktop (experimental): windows, screenshots, native mouse and keyboard i [...]
ROW B packages/omo-senpi/scripts/qa/fused-equivalence-golden/linux-x64/E21.json:3755 refs=tool,wait kind=contract text (json) :: "description": "run (required): JavaScript async function body; `desktop`, `wait`, `assert`, `tool` in scope; ` [...]
ROW B packages/omo-senpi/src/components/computer-use/published-parameters.fixture.json:42 refs=tool,wait kind=contract text (json) :: "description": "run (required): JavaScript async function body; `desktop`, `wait`, `assert`, `tool` in sco [...]
ROW B packages/senpi-desktop-prelude/README.md:22 refs=wait kind=markdown entry :: - `{ action: "run", code, read_only?, timeout? }`: `code` is an async function body. `computer.run(fn, { args })` serializes `fn` and each argument (JSON dat [...]
ROW B packages/senpi-desktop-prelude/src/prelude.js:132 refs=wait kind=generated code = ... :: return await (__SUB__)({ desktop, wait, assert }__SUB__);
ROW B packages/senpi-desktop-service/README.md:18 refs=tool,wait kind=contract text (markdown) :: - The context's globals are `desktop` (the facade), `wait(ms | predicate, {timeout, interval})`, `assert(condition, message)`, `console`, and  [...]
ROW B packages/senpi-desktop-tool/src/cua-actions.ts:147 refs=wait kind=code-shaped literal :: const actions = __SUB__; let bounds = __SUB__; const steps = []; const outside = (x, y) => bounds !== null && (x < 0 || y < 0 || x >= bounds.widt [...]
ROW B packages/senpi-desktop-tool/src/params.ts:41 refs=tool,wait kind=contract text :: JavaScript async function body; `desktop`, `wait`, `assert`, `tool` in scope; `return` sets the value
ROW B packages/senpi-desktop-tool/src/params.ts:77 refs=tool,wait kind=contract text :: run (required): JavaScript async function body; `desktop`, `wait`, `assert`, `tool` in scope; `return` sets the value
ROW B packages/senpi-desktop-tool/src/tool-definition.ts:27 refs=tool,wait kind=contract text :: - `{action:"run", code, read_only?, timeout?}` runs a JavaScript async function body with `desktop`, `wait`, `assert`, and `tool` in scope; `re [...]
ROW B packages/senpi-desktop-tool/test/control.test.ts:97 refs=wait kind=object action:run :: await desktop.control.acquire({ reason: 'click Run' }); await desktop.windows(); await wait(() => false, { timeout: 4000, interval: 50 });
ROW B packages/senpi-desktop-tool/test/execute.test.ts:121 refs=tool kind=object action:run :: return await tool.read({ path: "a.txt" });
```

Matrix rows M1-M22 equal the scan's 22 flagged entries (8 run bodies or scope docs, 13 model-facing contract texts, 1 developer README). The 5 bodies the parser could not read cleanly are the
three `"private typed text"` telemetry fixtures (prose, not code), `prelude.js:132` (flagged anyway, M5) and
`script/qa/desktop/macos/scenario.ts:67` (a `${...}` prefix fragment; no `tool`/`wait`).
