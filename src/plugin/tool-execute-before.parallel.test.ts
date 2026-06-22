/**
 * Task T1.1: 100-parallel-call race test for `tool.execute.before`.
 *
 * Validates that the 3-wave parallelization (Promise.all + Promise.allSettled
 * + sequential mutator chain) is safe under concurrent invocation:
 *
 *   1. Cross-call state isolation: 100 concurrent handler invocations with
 *      unique inputs (callID, sessionID, tool) each produce a correct
 *      output. No call's output is contaminated by another call's input.
 *
 *   2. Per-invocation hook coverage: every fast-fail hook is called for
 *      every invocation. This proves the refactor did not accidentally
 *      short-circuit any wave (e.g., an early return that skips Wave 3).
 *
 *   3. prometheusMdOnly dual-invocation: since this hook runs in BOTH
 *      Wave 2 (BLOCKING) and Wave 3 (MUTATOR), it must be called exactly
 *      TWICE per invocation (200 total across 100 invocations).
 *
 * Task T1.4: `resolveSessionAgent` overlap test for the task tool.
 *
 * Validates that the network call for task-tool agent resolution runs in
 * PARALLEL with Wave 3 mutators (started before the mutator chain, awaited
 * after). Total elapsed time must be ~max(atlasHook, resolve) instead of
 * atlasHook + resolve.
 *
 * Uses spyOn (not `mock.module()`) to keep the test isolated from
 * CI's mock-heavy test list (see AGENTS.md "Tests that MUST be isolated").
 */
import { describe, expect, spyOn, test } from "bun:test"
import * as sessionAgentResolver from "./session-agent-resolver"
import { createToolExecuteBeforeHandler } from "./tool-execute-before"

type CreatedHooks = Parameters<typeof createToolExecuteBeforeHandler>[0]["hooks"]
type PluginContext = Parameters<typeof createToolExecuteBeforeHandler>[0]["ctx"]

const FAST_FAIL_HOOK_NAMES = [
  // Wave 1: READ_ONLY
  "qualityGate",
  "commentChecker",
  "directoryAgentsInjector",
  "directoryReadmeInjector",
  "rulesInjector",
  // Wave 2: BLOCKING
  "secretLeakGuard",
  "envFileWriteGuard",
  "writeExistingFileGuard",
  "tasksTodowriteDisabler",
  "prometheusMdOnly",
  // Wave 3: MUTATOR
  "nonInteractiveEnv",
  "bashFileReadGuard",
  "questionLabelTruncator",
  "sisyphusJuniorNotepad",
  "atlasHook",
] as const

type FastFailHookName = (typeof FAST_FAIL_HOOK_NAMES)[number]

const TOOLS = ["bash", "read", "edit", "write", "webfetch"] as const

function buildStubHooks(spies: Record<FastFailHookName, ReturnType<typeof spyOn>>) {
  // Build a minimal but type-compatible CreatedHooks object. Hooks not in
  // FAST_FAIL_HOOK_NAMES are stubbed as no-ops (not under test for race
  // correctness here). Each fast-fail hook is replaced with a spy that
  // also stamps the callID onto output.args so we can detect cross-call
  // contamination.
  const hooks: Record<string, unknown> = {}

  // All fast-fail hooks are present, keyed by their CreatedHooks property name.
  for (const name of FAST_FAIL_HOOK_NAMES) {
    // Stub the underlying hook: just record the (input, output) it was called
    // with so we can verify ordering/per-invocation coverage. We use spyOn
    // on a plain object method (no real implementation needed).
    const obj = {
      "tool.execute.before": async (input: { callID: string }, output: { args: Record<string, unknown> }) => {
        // Stamp the callID into output.args so we can detect cross-call
        // contamination: if any call sees another call's callID, the
        // output was clobbered by concurrent mutation.
        output.args.callID = input.callID
      },
    }
    hooks[name] = obj
    spies[name] = spyOn(obj, "tool.execute.before")
  }

  // Stub remaining CreatedHooks fields to no-op. The handler uses optional
  // chaining (`?.["tool.execute.before"]?.`) so undefined entries are fine,
  // but we need a structurally compatible object for the type system.
  const NOOP_HOOKS = {
    "tool.execute.before": async () => {},
  }
  for (const name of [
    "categorySkillReminder",
    "autoSlashCommand",
    "stopContinuationGuard",
    "compactionContextInjector",
    "compactionTodoPreserver",
    "todoContinuationEnforcer",
    "unstableAgentBabysitter",
    "backgroundNotificationHook",
    "keywordDetector",
    "contextInjectorMessagesTransform",
    "thinkingBlockValidator",
    "toolPairValidator",
    "designIntentPreserver",
    "toolOutputTruncator",
    "emptyTaskResponseDetector",
    "hashlineReadEnhancer",
    "jsonErrorRecovery",
    "todoDescriptionOverride",
    "readImageResizer",
    "webfetchRedirectGuard",
    "hashlineEditDiffEnhancer",
    "taskNotepad",
    "contextWindowMonitor",
    "preemptiveCompaction",
    "sessionRecovery",
    "sessionNotification",
    "thinkMode",
    "anthropicContextWindowLimitRecovery",
    "autoUpdateChecker",
    "agentUsageReminder",
    "interactiveBashSession",
    "matrixLoop",
    "editErrorRecovery",
    "delegateTaskRetry",
    "startWork",
    "taskResumeInfo",
    "anthropicEffort",
    "runtimeFallback",
  ] as const) {
    if (hooks[name] === undefined) {
      hooks[name] = NOOP_HOOKS
    }
  }

  return hooks as unknown as CreatedHooks
}

describe("tool.execute.before — T1.6 slashcommand regex precompilation", () => {
  test("slashcommand regex precompiled at module load", async () => {
    //#given
    const capturedRegexes: RegExp[] = []
    const origMatch = String.prototype.match
    const matchSpy = spyOn(String.prototype, "match").mockImplementation(function(
      this: string,
      searchValue: RegExp | string,
    ) {
      if (searchValue instanceof RegExp) {
        capturedRegexes.push(searchValue)
      }
      return origMatch.call(this, searchValue)
    })

    try {
      const spies = {} as Record<FastFailHookName, ReturnType<typeof spyOn>>
      const hooks = buildStubHooks(spies)
      ;(hooks as Record<string, unknown>).matrixLoop = {
        "tool.execute.before": async () => {},
        startLoop: () => {},
        cancelLoop: () => {},
      }
      const ctx: PluginContext = { client: {} } as PluginContext
      const handler = createToolExecuteBeforeHandler({ ctx, hooks })

      const input = {
        tool: "slashcommand" as const,
        sessionID: "ses_t16",
        callID: "call_1",
      }
      const output = {
        args: { command: "/matrix-loop" } as Record<string, unknown>,
      }

      //#when
      // 3 calls is enough to prove the regex is stable across invocations.
      await handler(input, output)
      await handler(input, output)
      await handler(input, output)

      //#then
      // Group captures by `.source`. For each source with ≥ 2 captures,
      // every captured instance must be === identical (the same precompiled
      // module-level constant).
      const bySource = new Map<string, RegExp>()
      let multiInstanceAssertions = 0
      for (const r of capturedRegexes) {
        const existing = bySource.get(r.source)
        if (existing === undefined) {
          bySource.set(r.source, r)
        } else {
          // Same source across calls → same instance (precompiled)
          expect(r).toBe(existing)
          multiInstanceAssertions++
        }
      }
      // Sanity: we made at least one identity assertion (otherwise the
      // test is vacuous — e.g., the slashcommand branches didn't fire).
      expect(multiInstanceAssertions).toBeGreaterThan(0)
    } finally {
      matchSpy.mockRestore()
    }
  })

  test("slashcommand command lowercased once per call", async () => {
    //#given
    // Spy on String.prototype.toLowerCase to count calls. After the T1.6
    // refactor, the `command = rawCommand?.replace(...).toLowerCase()`
    // computation happens ONCE per slashcommand invocation (the two
    // slashcommand blocks were merged and the `command` was hoisted).
    let toLowerCaseCount = 0
    const origToLowerCase = String.prototype.toLowerCase
    const toLowerSpy = spyOn(String.prototype, "toLowerCase").mockImplementation(function(
      this: string,
    ) {
      toLowerCaseCount++
      return origToLowerCase.call(this)
    })

    try {
      const spies = {} as Record<FastFailHookName, ReturnType<typeof spyOn>>
      const hooks = buildStubHooks(spies)
      const ctx: PluginContext = { client: {} } as PluginContext
      const handler = createToolExecuteBeforeHandler({ ctx, hooks })

      const input = {
        tool: "slashcommand" as const,
        sessionID: "ses_t16",
        callID: "call_1",
      }
      const output = {
        args: { command: "/matrix-loop \"do something\"" } as Record<string, unknown>,
      }

      //#when
      const before = toLowerCaseCount
      await handler(input, output)
      const after = toLowerCaseCount

      //#then
      // Exactly 1 toLowerCase call per hook invocation (was 2 before the
      // T1.6 refactor: the matrixLoop and stop-continuation blocks each
      // computed `command` independently).
      expect(after - before).toBe(1)
    } finally {
      toLowerSpy.mockRestore()
    }
  })
})

describe("tool.execute.before — T1.1 parallel safety", () => {
  test(
    "100 parallel invocations produce correct output",
    async () => {
      //#given
      const spies = {} as Record<FastFailHookName, ReturnType<typeof spyOn>>
      const hooks = buildStubHooks(spies)
      const ctx: PluginContext = { client: {} } as PluginContext
      const handler = createToolExecuteBeforeHandler({ ctx, hooks })

      const N = 100
      const calls = Array.from({ length: N }, (_, i) => ({
        input: {
          tool: TOOLS[i % TOOLS.length] as string,
          sessionID: `ses_${i}`,
          callID: `call_${i}`,
        },
        output: { args: {} as Record<string, unknown> },
      }))

      //#when
      await Promise.all(calls.map(({ input, output }) => handler(input, output)))

      //#then — 1: cross-call isolation
      // Every output's stamped callID must match the input's callID.
      // If any output carries a different callID, the parallel mutation
      // raced (e.g., Wave 3's sequential chain was actually parallel,
      // or hooks share state outside their callID scope).
      for (let i = 0; i < N; i++) {
        const expected = `call_${i}`
        const actual = calls[i]?.output.args.callID
        expect(actual).toBe(expected)
      }

      //#then — 2: per-invocation hook coverage (single-call hooks called 100x)
      const SINGLE_CALL_HOOKS: FastFailHookName[] = [
        "qualityGate",
        "commentChecker",
        "directoryAgentsInjector",
        "directoryReadmeInjector",
        "rulesInjector",
        "secretLeakGuard",
        "envFileWriteGuard",
        "writeExistingFileGuard",
        "tasksTodowriteDisabler",
        "nonInteractiveEnv",
        "bashFileReadGuard",
        "questionLabelTruncator",
        "sisyphusJuniorNotepad",
        "atlasHook",
      ]
      for (const name of SINGLE_CALL_HOOKS) {
        expect(spies[name]).toBeDefined()
        expect(spies[name]?.mock.calls.length).toBe(N)
      }

      //#then — 3: prometheusMdOnly dual-invocation (Wave 2 + Wave 3)
      // It must be called exactly 2N times across all invocations.
      expect(spies.prometheusMdOnly).toBeDefined()
      expect(spies.prometheusMdOnly?.mock.calls.length).toBe(N * 2)
    },
    10_000,
  )
})

describe("tool.execute.before — T1.4 resolveSessionAgent overlap", () => {
  test(
    "resolveSessionAgent runs in parallel with Wave 3 mutators",
    async () => {
      //#given
      const spies = {} as Record<FastFailHookName, ReturnType<typeof spyOn>>
      const hooks = buildStubHooks(spies)

      // Make atlasHook (last Wave-3 MUTATOR) take 100ms. This is the dominant
      // sequential cost in the mutator chain. With T1.4 the resolve network
      // call must run concurrently, so total time stays ~100ms.
      spies.atlasHook.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100))
      })

      // Mock resolveSessionAgent to take 100ms and return a fixed agent.
      // The handler imports it via live binding; spyOn on the namespace
      // intercepts the call (same pattern as `keyword-detector/index.test.ts`).
      const resolveSpy = spyOn(
        sessionAgentResolver,
        "resolveSessionAgent",
      ).mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100))
        return "resolved-agent"
      })

      const ctx: PluginContext = { client: {} } as PluginContext
      const handler = createToolExecuteBeforeHandler({ ctx, hooks })

      const input = { tool: "task", sessionID: "ses_x", callID: "call_x" }
      const output = { args: { session_id: "ses_target" } as Record<string, unknown> }

      //#when
      const start = performance.now()
      await handler(input, output)
      const elapsed = performance.now() - start

      //#then — 1: resolveSessionAgent was called with the right session_id
      expect(resolveSpy).toHaveBeenCalled()
      expect(resolveSpy.mock.calls[0]?.[1]).toBe("ses_target")

      //#then — 2: the resolved agent was applied to output.args.subagent_type
      // (proves the contract: the task tool still receives a resolved agent)
      expect(output.args.subagent_type).toBe("resolved-agent")

      //#then — 3: total elapsed time proves parallelism
      // Sequential (old): 100ms (atlasHook) + 100ms (resolve) ≈ 200ms
      // Parallel   (new): max(100ms, 100ms) ≈ 100ms
      // Threshold 150ms gives ~50ms headroom for timer inaccuracy + microtask
      // scheduling overhead. A sequential run would fail by ~50ms.
      expect(elapsed).toBeLessThan(150)
    },
    5_000,
  )
})
