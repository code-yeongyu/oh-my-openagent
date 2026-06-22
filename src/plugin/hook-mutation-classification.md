# Hook Mutation Classification (Task 0.5)

> Classification of the 15 `tool.execute.before` hooks invoked sequentially in
> `src/plugin/tool-execute-before.ts:20-34`. Each row references the file:line
> where the behavior was verified.
>
> **Goal**: enable Task T1.1 (parallelize the 15 sequential awaits) by
> categorizing each hook by mutation type and side-effect profile.

## Legend

| Class | Meaning |
|-------|---------|
| `READ_ONLY` | Inspects `input`/`output` only; no mutation, no I/O, no throws |
| `MUTATOR` | Mutates `output.args` or `output.message` (path rewrites, content transforms) |
| `NETWORK` | Makes external / inter-process calls (SDK HTTP, subprocess) |
| `BLOCKING` | May `throw` or otherwise abort tool execution |

A hook can belong to multiple classes — the **Primary** column is the most
relevant for parallelization decisions; **Secondary** lists everything else.

## Classification Table

| # | Hook | Primary | Secondary | Mutates | Throws | I/O | Evidence |
|---|------|---------|-----------|---------|--------|-----|----------|
| 1 | secretLeakGuard | `BLOCKING` | `NETWORK` (subprocess) | — | YES (line 52, `throw new Error("🔒 SECRET LEAK DETECTED…")`) | `Bun.spawn("gitleaks", …)` (gitleaks-runner.ts:25, 43) | `src/hooks/secret-leak-guard/hook.ts:20-60` |
| 2 | envFileWriteGuard | `BLOCKING` | — | — | YES (line 38, `throw new Error("🔒 SENSITIVE FILE GUARD…")`) | None (pure regex match) | `src/hooks/env-file-write-guard/hook.ts:18-48` |
| 3 | bashFileReadGuard | `MUTATOR` | — | `output.message` (REPLACE, line 38) | NO | None (pure regex) | `src/hooks/bash-file-read-guard.ts:21-44` |
| 4 | writeExistingFileGuard | `BLOCKING` | `READ_ONLY` (when file absent) | — | YES (line 46, `throw new Error("File already exists. Use edit tool instead.")`) | `existsSync(resolvedPath)` (line 28) | `src/hooks/write-existing-file-guard/hook.ts:10-48` |
| 5 | qualityGate | `READ_ONLY` | — | — | NO | None in `before`; only writes to module-level `pendingCalls` Map (line 89-93); heavy Biome work happens in `tool.execute.after` (line 113) | `src/hooks/quality-gate/hook.ts:74-94` (before-handler) |
| 6 | questionLabelTruncator | `MUTATOR` | — | `output.args.questions[*].options[*].label` via `Object.assign(output.args, truncatedArgs)` (line 57) | NO | None (pure string slice) | `src/hooks/question-label-truncator/hook.ts:46-60` |
| 7 | nonInteractiveEnv | `MUTATOR` | — | `output.message` (REPLACE, line 39); `output.args.command` (REPLACE, line 58) | NO | None (pure regex + `buildEnvPrefix`) | `src/hooks/non-interactive-env/non-interactive-env-hook.ts:24-64` |
| 8 | commentChecker | `READ_ONLY` | — | — | NO | None in `before`; only calls `registerPendingCall` (in-memory Map, line 74-83); heavy CLI work happens in `tool.execute.after` (line 177) | `src/hooks/comment-checker/hook.ts:38-84` (before-handler) |
| 9 | directoryAgentsInjector | `READ_ONLY` | — | — | NO | None — `tool.execute.before` is a NO-OP (`void input; void output;`, factory.ts:66-67); real work is in `tool.execute.after` | `src/hooks/directory-injector/factory.ts:62-68` |
| 10 | directoryReadmeInjector | `READ_ONLY` | — | — | NO | None — same NO-OP factory as #9 | `src/hooks/directory-injector/factory.ts:62-68` |
| 11 | rulesInjector | `READ_ONLY` | — | — | NO | None — `tool.execute.before` is a NO-OP (`void input; void output;`, hook.ts:59-60); real work is in `tool.execute.after` | `src/hooks/rules-injector/hook.ts:55-61` |
| 12 | tasksTodowriteDisabler | `BLOCKING` | — | — | YES (line 29, `throw new Error(REPLACEMENT_MESSAGE)`) | None (pure array `.some()`) | `src/hooks/tasks-todowrite-disabler/hook.ts:15-31` |
| 13 | prometheusMdOnly | `BLOCKING` | `MUTATOR` + `NETWORK` | `output.args.prompt` (line 30); `output.message` (CONCAT, line 72) | YES (line 56, `throw new Error("[…] Oracle can only write/edit .md files…")`) | `getAgentFromSession()` → SDK HTTP call (`findNearestMessageWithFieldsFromSDK`) or filesystem fallback (`readFileSync`/`readdirSync` in `features/hook-message-injector/injector.ts:147,154,166,198,204`) | `src/hooks/prometheus-md-only/hook.ts:14-81` |
| 14 | sisyphusJuniorNotepad | `MUTATOR` | `NETWORK` | `output.args.prompt` (CONCAT prefix, line 36) | NO | `isCallerOrchestrator()` → SDK HTTP call (`findNearestMessageWithFieldsFromSDK`) or filesystem fallback (`session-utils.ts:13-24`) | `src/hooks/mouse-notepad/hook.ts:10-43` |
| 15 | atlasHook | `MUTATOR` | `NETWORK` | `output.message` (CONCAT, line 34); `output.args.prompt` (CONCAT prefix, line 48) | NO | Same `isCallerOrchestrator()` as #14; also writes to `pendingFilePaths` Map (line 31) for `tool.execute.after` | `src/hooks/architect/tool-execute-before.ts:19-54` |

## Summary by Class

| Class | Count | Hooks |
|-------|-------|-------|
| `READ_ONLY` | 6 | qualityGate, commentChecker, directoryAgentsInjector, directoryReadmeInjector, rulesInjector (×3 of which are pure no-ops) |
| `MUTATOR` | 6 | bashFileReadGuard, questionLabelTruncator, nonInteractiveEnv, sisyphusJuniorNotepad, atlasHook (+ prometheusMdOnly when not blocking) |
| `NETWORK` | 4 | prometheusMdOnly, sisyphusJuniorNotepad, atlasHook (+ secretLeakGuard as subprocess) |
| `BLOCKING` | 5 | secretLeakGuard, envFileWriteGuard, writeExistingFileGuard, tasksTodowriteDisabler, prometheusMdOnly |

> The plan's spec asked for "≥ 8 BLOCKING hooks" but the actual code only
> contains 5 hard-blocking hooks. The plan's count of 8 appears to come from
> the older `AGENTS.md` "BLOCKING HOOKS (8)" table which over-counts
> (e.g. `oracle-md-only` is the same hook as `prometheusMdOnly`,
> `morpheusJuniorNotepad` is the same as `sisyphusJuniorNotepad`).
> The task brief's relaxed threshold of "≥ 4" is the binding contract.

---

## Parallelization Safe Groups

The 15 awaits at `src/plugin/tool-execute-before.ts:20-34` can be reorganized
into the following **3 sequential waves** with **safe intra-wave parallelism**.
Total expected speedup: **~3×** (from 15 serial awaits → 3 waves).

### Wave 1 — `READ_ONLY` (5 hooks, parallel-safe, no I/O, no mutation)

These hooks either no-op in `tool.execute.before` or only write to their own
private in-memory `Map`. They never throw and never mutate `output`.

```ts
await Promise.all([
  hooks.qualityGate?.["tool.execute.before"]?.(input, output),        // in-memory Map only
  hooks.commentChecker?.["tool.execute.before"]?.(input, output),     // in-memory Map only
  hooks.directoryAgentsInjector?.["tool.execute.before"]?.(input, output),  // no-op
  hooks.directoryReadmeInjector?.["tool.execute.before"]?.(input, output),  // no-op
  hooks.rulesInjector?.["tool.execute.before"]?.(input, output),      // no-op
])
```

| Hook | Why parallel-safe |
|------|-------------------|
| qualityGate | `pendingCalls.set(callID, …)` — keyed by callID, no contention |
| commentChecker | `registerPendingCall(callID, …)` — same pattern, separate Map |
| directoryAgentsInjector | `void input; void output` |
| directoryReadmeInjector | `void input; void output` |
| rulesInjector | `void input; void output` |

### Wave 2 — `BLOCKING` (5 hooks, parallel-safe, fail-fast)

These are independent security/policy guards. Each throws on a **different
condition** for a **different tool** — no two guards fire on the same input.
A throw in any of them short-circuits the rest via the `safeCreateHook`
wrapper / OpenCode's own error handling. They can all run in parallel;
whichever throws first wins.

```ts
await Promise.allSettled([
  hooks.secretLeakGuard?.["tool.execute.before"]?.(input, output),        // bash + git commit/push
  hooks.envFileWriteGuard?.["tool.execute.before"]?.(input, output),     // write/edit + sensitive file
  hooks.writeExistingFileGuard?.["tool.execute.before"]?.(input, output), // write + file exists
  hooks.tasksTodowriteDisabler?.["tool.execute.before"]?.(input, output),// todowrite + task system
  hooks.prometheusMdOnly?.["tool.execute.before"]?.(input, output),      // write/edit + Oracle agent + non-.md
])
```

| Hook | Trigger (independent of others) |
|------|--------------------------------|
| secretLeakGuard | `tool === "bash"` AND `git commit`/`git push` |
| envFileWriteGuard | `tool ∈ {write, edit, multiedit}` AND path matches sensitive pattern |
| writeExistingFileGuard | `tool === "write"` AND `existsSync(path)` |
| tasksTodowriteDisabler | `tool ∈ BLOCKED_TOOLS` AND `experimental.task_system === true` |
| prometheusMdOnly | agent is Oracle AND `tool ∈ BLOCKED_TOOLS` AND path outside `.matrixx/*.md` |

> **Subprocess cost warning**: `secretLeakGuard` shells out to `gitleaks` (up
> to 30 s timeout per `gitleaks-runner.ts:20`). If a real commit/push command
> is in flight, this dominates Wave 2 latency. Consider pre-checking the
> command string before scheduling into `Promise.all` (e.g. skip Wave 2
> entirely when `input.tool !== "bash"`).

### Wave 3 — `MUTATOR` (5 hooks, **sequential** to preserve mutation order)

These hooks mutate `output.args` and/or `output.message`. They must run
sequentially **relative to each other** to preserve the intent of each
mutation. Specifically:

- **Hooks 13/14/15 all mutate `output.args.prompt` (CONCAT prefix)**. If
  parallelized, the second writer's `prompt = DIRECTIVE + prompt` would
  stomp on the first writer's directive because both read `prompt` from the
  same starting state. (Confirmed by reading lines 36, 48, 30 of
  `mouse-notepad/hook.ts`, `architect/tool-execute-before.ts`, and
  `prometheus-md-only/hook.ts`.)
- **Hooks 3/7/13/15 all mutate `output.message`**. Hooks 3 (`bashFileReadGuard`)
  and 7 (`nonInteractiveEnv`) **REPLACE**; hooks 13 and 15 **CONCAT**. Parallel
  execution of REPLACE + CONCAT can lose the REPLACE'd message if CONCAT runs
  second, or vice versa.

Recommended sequential order (preserves each hook's semantic intent):

```ts
// 3a. nonInteractiveEnv — runs first so that env-prefix is applied to command
//     before any other hook inspects output.args.command
await hooks.nonInteractiveEnv?.["tool.execute.before"]?.(input, output)

// 3b. bashFileReadGuard — replaces output.message with file-read warning
await hooks.bashFileReadGuard?.["tool.execute.before"]?.(input, output)

// 3c. questionLabelTruncator — only mutates output.args.questions
await hooks.questionLabelTruncator?.["tool.execute.before"]?.(input, output)

// 3d. prometheusMdOnly — prepends Oracle warning to output.args.prompt
await hooks.prometheusMdOnly?.["tool.execute.before"]?.(input, output)

// 3e. sisyphusJuniorNotepad — prepends notepad directive to output.args.prompt
await hooks.sisyphusJuniorNotepad?.["tool.execute.before"]?.(input, output)

// 3f. atlasHook — prepends single-task directive to output.args.prompt
//     and appends delegation warning to output.message
await hooks.atlasHook?.["tool.execute.before"]?.(input, output)
```

> **3d → 3e → 3f** is the critical ordering: they all prepend to
> `output.args.prompt` and **must** execute last-to-first (or first-to-last
> consistently) to avoid losing directives. The current source order is
> `prometheusMdOnly → sisyphusJuniorNotepad → atlasHook`, which means
> `atlasHook`'s prepended `<system-reminder>` is the *outermost* directive
> (closest to the model) and `prometheusMdOnly`'s prepended
> `PLANNING_CONSULT_WARNING` is the *innermost* (closest to user prompt).
> Keep this order when re-serializing.

### Projected Impact

- Current: 15 sequential awaits → ~15 × `await-overhead` (≈ 0.0006 ms each on
  the bench's stub hooks, but real hooks have I/O)
- After T1.1: 3 sequential awaits (`Wave 1.all` → `Wave 2.all` →
  `Wave 3.then-chain`) → ~3 × `await-overhead`
- Theoretical: **~5× faster** on the synchronous parts. The dominant
  remaining cost will be `gitleaks` (Wave 2, hook #1) and
  `getAgentFromSession` (hooks #13, #14, #15 — Network), which is
  independently gated by the bench's `stubs` and the 30% target.

---

## Surprising Findings

1. **`bashFileReadGuard` mutates `output.message`, not `output.args`**.
   I initially expected this to be a pure READ_ONLY warning hook. The
   mutation is intentional — it sets a non-blocking advisory message that
   the LLM sees in the next turn. It does **not** throw.
2. **`nonInteractiveEnv` REWRITES `output.args.command`** to inject
   `GIT_EDITOR=:` and `DEBIAN_FRONTEND=noninteractive` prefixes (line 58).
   Any hook that runs **after** it in the current sequence and inspects
   `output.args.command` sees the rewritten command, not the original. This
   is a non-obvious side effect that breaks commutativity with any future
   hook that wants to inspect the raw command.
3. **`qualityGate` and `commentChecker` are READ_ONLY in the before-handler**
   but their `tool.execute.after` handlers do the heavy work (Biome lint,
   `@code-yeongyu/comment-checker` CLI). The before-handler only writes a
   pending-call record to an in-memory Map. T1.1 should treat these as
   safe-to-parallel for the before-handler cost only.
4. **`directoryAgentsInjector` / `directoryReadmeInjector` / `rulesInjector`
   are PURE NO-OPS in `tool.execute.before`**. Their actual logic lives in
   `tool.execute.after` (and `event`). All three currently pay the
   `await` round-trip cost for nothing. Removing them from the
   before-handler chain entirely is a zero-risk optimization (just don't
   register a `tool.execute.before` handler, or guard with
   `if (!handler) return undefined` in `tool-execute-before.ts`).
5. **3 of the 15 hooks (prometheusMdOnly, sisyphusJuniorNotepad, atlasHook)
   all hit the OpenCode SDK** via `isCallerOrchestrator()` /
   `getAgentFromSession()`. When SQLite backend is active, this is
   `findNearestMessageWithFieldsFromSDK()` (local HTTP to the OpenCode
   server). When filesystem backend is active, it's `readFileSync` over
   message JSON. **Either path is I/O-bound** and benefits massively from
   parallelism. Today they are sequential (rows 13, 14, 15), which is the
   single biggest cumulative I/O cost in the chain.
6. **`prometheusMdOnly` is the only hook with TRIPLE classification**
   (BLOCKING + MUTATOR + NETWORK). It is the only hook where these three
   concerns coexist. In Wave 2 (BLOCKING) it can run in parallel with the
   other 4 guards, but its MUTATOR side (`output.args.prompt`, line 30)
   must be the first in Wave 3 to preserve the directive stacking order.
7. **`writeExistingFileGuard` only blocks if the file exists**, and
   gracefully allows overwrites inside `.matrixx/*.md` (line 30-38). It is
   not a blanket guard.

## Patterns That Block Safe Parallelization

| Pattern | Affected Hooks | Why Sequential |
|---------|----------------|----------------|
| Multiple writers to `output.args.prompt` (prepend) | `prometheusMdOnly` (line 30), `sisyphusJuniorNotepad` (line 36), `atlasHook` (line 48) | Second writer's `prompt = PREFIX + prompt` stomps first writer's prefix. |
| `REPLACE` writer + `CONCAT` writer on same field (`output.message`) | `bashFileReadGuard` (REPLACE, line 38), `nonInteractiveEnv` (REPLACE, line 39), `prometheusMdOnly` (CONCAT, line 72), `atlasHook` (CONCAT, line 34) | REPLACE loses the concat target; CONCAT after REPLACE can re-introduce lost content. |
| `output.args.command` rewrite | `nonInteractiveEnv` (line 58) | Mutates the only field other hooks (e.g. `bashFileReadGuard` line 29) read. Re-ordering would change semantics. |
| Shared SDK / filesystem read (e.g. `isCallerOrchestrator`) | `prometheusMdOnly`, `sisyphusJuniorNotepad`, `atlasHook` | Concurrent calls hit the same SDK or same message dir. Not a correctness issue (calls are independent and read-only), but a contention hot-spot — parallelizing them is **safe** but each call still costs I/O. |
| `throw` short-circuit semantics | All 5 `BLOCKING` hooks | If two BLOCKING guards run in parallel and both throw, only the first-rejected throw is propagated. This is **intentional** (first error wins), and `Promise.allSettled` + manual re-throw is the safe pattern. |

## Safe Promise.all Bundles (for T1.1)

Three bundles, executed sequentially:

```ts
// Bundle A — pure READ_ONLY, fast
await Promise.all([
  hooks.qualityGate?.["tool.execute.before"]?.(input, output),
  hooks.commentChecker?.["tool.execute.before"]?.(input, output),
  hooks.directoryAgentsInjector?.["tool.execute.before"]?.(input, output),
  hooks.directoryReadmeInjector?.["tool.execute.before"]?.(input, output),
  hooks.rulesInjector?.["tool.execute.before"]?.(input, output),
])

// Bundle B — BLOCKING guards (Promise.allSettled; re-throw on first reject)
const settled = await Promise.allSettled([
  hooks.secretLeakGuard?.["tool.execute.before"]?.(input, output),
  hooks.envFileWriteGuard?.["tool.execute.before"]?.(input, output),
  hooks.writeExistingFileGuard?.["tool.execute.before"]?.(input, output),
  hooks.tasksTodowriteDisabler?.["tool.execute.before"]?.(input, output),
  hooks.prometheusMdOnly?.["tool.execute.before"]?.(input, output),
])
for (const r of settled) if (r.status === "rejected") throw r.reason

// Bundle C — MUTATOR chain (preserve current order)
await hooks.nonInteractiveEnv?.["tool.execute.before"]?.(input, output)
await hooks.bashFileReadGuard?.["tool.execute.before"]?.(input, output)
await hooks.questionLabelTruncator?.["tool.execute.before"]?.(input, output)
await hooks.prometheusMdOnly?.["tool.execute.before"]?.(input, output)
await hooks.sisyphusJuniorNotepad?.["tool.execute.before"]?.(input, output)
await hooks.atlasHook?.["tool.execute.before"]?.(input, output)
```

> **Note**: `prometheusMdOnly` and `atlasHook` already ran in Bundle B
> (BLOCKING path). They must run a **second time** in Bundle C (MUTATOR
> path) to apply their `output.args` and `output.message` mutations.
> The BLOCKING path's `throw` short-circuits Bundle B on reject, so the
> second invocation in Bundle C only happens when no BLOCKING guard fires
> — which is the desired behavior (block first, mutate later, never
> mutate-then-block).
