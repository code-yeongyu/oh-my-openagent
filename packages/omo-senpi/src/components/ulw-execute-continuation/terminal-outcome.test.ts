import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { IdleInjectionCoordinator } from "../../extension/idle-injection-coordinator"
import { EMPTY_TOOL_USE_DEMOTION_DIAGNOSTIC } from "../fallback-architect/detection"
import { createUlwLoopComponent } from "../ulw-loop"
import { activeStatus, createLogger } from "../ulw-loop/ulw-loop.test-support"
import { createUlwExecuteContinuationComponent } from "./index"

// https://github.com/code-yeongyu/senpi/issues/1520
const CODEX_ERROR = "Codex error: This request was blocked by our safety systems. Reason: Potentially unintended activity."
const clean = { type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }], willRetry: false }
const errorMessage = { role: "assistant", stopReason: "error", errorMessage: CODEX_ERROR, content: [] }
const demotionDiagnostic = { type: EMPTY_TOOL_USE_DEMOTION_DIAGNOSTIC, timestamp: 0, details: {} }
const abortedToolResult = {
  role: "toolResult",
  toolCallId: "call-1",
  toolName: "bash",
  isError: true,
  content: [{ type: "text", text: "Command aborted by user" }],
}
const blockedOutcomes = [
  { name: "terminal Codex safety error", event: { ...clean, messages: [errorMessage] }, blockedBy: "unfinished-turn" },
  {
    name: "ordinary provider failure",
    event: { ...clean, messages: [{ ...errorMessage, errorMessage: "Connection failed" }] },
    blockedBy: "unfinished-turn",
  },
  { name: "aborted run", event: { ...clean, aborted: true }, blockedBy: "aborted" },
  { name: "aborted assistant", event: { ...clean, messages: [{ role: "assistant", stopReason: "aborted" }] }, blockedBy: "unfinished-turn" },
  { name: "host-owned retry", event: { ...clean, willRetry: true }, blockedBy: "host-retry" },
  {
    name: "empty tool-use refusal",
    event: { ...clean, messages: [{ role: "assistant", stopReason: "toolUse", content: [], stopDetails: { type: "refusal" } }] },
    blockedBy: "refusal",
  },
  {
    name: "sensitive stop",
    event: { ...clean, messages: [{ role: "assistant", stopReason: "toolUse", content: [], stopDetails: { type: "sensitive" } }] },
    blockedBy: "refusal",
  },
  {
    // The host's own normalization: demoteToolUseWithoutToolCalls rewrites the stop reason to `stop`
    // and leaves the demotion diagnostic as the only surviving evidence of the malformed turn.
    name: "normalized empty-tool-use refusal",
    event: {
      ...clean,
      messages: [
        { role: "assistant", stopReason: "stop", content: [], diagnostics: [demotionDiagnostic], stopDetails: { type: "refusal" } },
      ],
    },
    blockedBy: "refusal",
  },
  {
    name: "normalized sensitive stop",
    event: {
      ...clean,
      messages: [
        { role: "assistant", stopReason: "stop", content: [], diagnostics: [demotionDiagnostic], stopDetails: { type: "sensitive" } },
      ],
    },
    blockedBy: "refusal",
  },
  { name: "missing outcome", event: { type: "agent_end" }, blockedBy: "missing-outcome" },
  { name: "empty outcome", event: { ...clean, messages: [] }, blockedBy: "missing-outcome" },
  { name: "missing stop reason", event: { ...clean, messages: [{ role: "assistant" }] }, blockedBy: "missing-outcome" },
  { name: "error behind custom tail", event: { ...clean, messages: [errorMessage, { role: "custom", content: "notice" }] }, blockedBy: "unfinished-turn" },
  {
    // A tool-call-bearing toolUse turn is a run stopped mid-tool-execution, which both host gates reject.
    name: "unfinished tool-use turn",
    event: {
      ...clean,
      messages: [{ role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", id: "call-1", name: "bash", arguments: {} }] }],
    },
    blockedBy: "unfinished-turn",
  },
  {
    // Esc during a long bash call: the assistant message looks finished, the tool result does not.
    name: "trailing aborted tool result",
    event: {
      ...clean,
      messages: [
        { role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", id: "call-1", name: "bash", arguments: {} }] },
        abortedToolResult,
      ],
    },
    blockedBy: "unfinished-turn",
  },
  {
    name: "aborted tool result behind a finished assistant",
    event: { ...clean, messages: [...clean.messages, abortedToolResult] },
    blockedBy: "aborted-tool-result",
  },
]
const continuableOutcomes = [
  {
    name: "explanatory assistant text",
    event: { ...clean, messages: [{ role: "assistant", stopReason: "stop", content: [{ type: "text", text: CODEX_ERROR }] }] },
  },
  { name: "an earlier failed attempt behind a clean tail", event: { ...clean, messages: [errorMessage, ...clean.messages, { role: "custom", content: "notice" }] } },
  {
    // The host treats a demoted empty tool-use turn as continuable; only its refusal details block it.
    name: "a demoted empty tool-use turn without refusal details",
    event: { ...clean, messages: [{ role: "assistant", stopReason: "stop", content: [], diagnostics: [demotionDiagnostic] }] },
  },
  {
    // One refusal definition: the stop reason is read first, so stale stopDetails on a plain stop is
    // not a refusal for this gate any more than it is for the fallback-architect nudge.
    name: "a plain stop carrying stale refusal details",
    event: { ...clean, messages: [{ role: "assistant", stopReason: "stop", content: [], stopDetails: { type: "refusal" } }] },
  },
  {
    name: "a trailing tool error that is not an abort",
    event: {
      ...clean,
      messages: [
        ...clean.messages,
        { ...abortedToolResult, content: [{ type: "text", text: "exit status 1: file not found" }] },
      ],
    },
  },
  { name: "a length stop", event: { ...clean, messages: [{ role: "assistant", stopReason: "length" }] } },
]
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function setup(component: "loop" | "boulder", coordinated: boolean) {
  const root = mkdtempSync(join(tmpdir(), "omo-terminal-outcome-"))
  roots.push(root)
  const pi = new FakeExtensionAPI()
  const logger = createLogger()
  const scheduled: Array<() => void> = []
  const coordinator = new IdleInjectionCoordinator(
    (message, options) => pi.sendMessage(message, { triggerTurn: true, deliverAs: options.deliverAs }),
    { scheduleFlush: (flush) => { scheduled.push(flush) } },
  )
  let status = activeStatus()
  let onProbe: (() => void) | undefined
  const advance = (revision: number) => {
    status = activeStatus(`G${revision}`)
    if (component === "boulder") {
      writeFileSync(join(root, ".omo", "boulder.json"), JSON.stringify({
        schema_version: 2, active_work_id: "w1", works: { w1: {
          work_id: "w1", active_plan: ".omo/plans/task.md", plan_name: "task",
          session_ids: ["senpi:qa-s1"], status: "active", started_at: "2026-09-09T00:00:00Z",
          updated_at: `2026-09-09T00:00:${String(revision).padStart(2, "0")}Z`,
        } },
      }))
    }
  }
  if (component === "boulder") {
    mkdirSync(join(root, ".omo", "plans"), { recursive: true })
    writeFileSync(join(root, ".omo", "plans", "task.md"), "## TODOs\n- [ ] 1. Task one\n")
  }
  advance(0)
  const hook = component === "loop" ? createUlwLoopComponent({
    resolveOmoBin: () => "/fixture/toolkit",
    planExists: () => true,
    runCommand: async () => {
      onProbe?.()
      return { code: 0, stdout: status }
    },
  }) : createUlwExecuteContinuationComponent()
  await hook.register(pi, {
    logger, config: { getFlag: () => false },
    ...(coordinated ? { idleCoordinator: coordinator } : {}),
  })
  const eventCtx = { cwd: root, sessionManager: { getSessionId: () => "qa-s1" } }
  const flush = () => {
    for (const pass of scheduled.splice(0)) pass()
  }
  return {
    pi, coordinator, scheduled, advance, logger,
    // Marks a run that the host is NOT settling yet (an automatic retry or a required auto-compaction
    // still owns the turn), so nothing may be delivered for it.
    async endTurn(event: unknown) {
      await pi.dispatch("agent_end", event, eventCtx)
      flush()
    },
    async settle() {
      await pi.dispatch("agent_settled", { type: "agent_settled" }, eventCtx)
      flush()
    },
    async end(event: unknown) {
      await this.endTurn(event)
      await this.settle()
    },
    // Runs while the awaited status probe is in flight, which is where the host's late-abort mutation
    // lands for ulw-loop (`agent-abort-provenance.js` join()).
    duringProbe(hook: (() => void) | undefined) {
      onProbe = hook
    },
  }
}

for (const component of ["loop", "boulder"] as const) {
  for (const coordinated of [false, true]) {
    describe(`${component} terminal outcome via ${coordinated ? "real coordinator" : "direct delivery"}`, () => {
      for (const { name, event, blockedBy } of blockedOutcomes) {
        it(`#given active plan and ${name} #when agent_end fires #then no automatic send or budget consumption`, async () => {
          const scenario = await setup(component, coordinated)
          // given nine failed edges would exhaust the continuation cap if counted
          for (let i = 0; i < 9; i++) await scenario.end(event)
          expect(scenario.pi.messages).toEqual([])
          expect(scenario.pi.userMessages).toEqual([])
          expect(scenario.coordinator.pendingCount()).toBe(0)
          expect(scenario.scheduled).toEqual([])
          // then every skip is observable with the outcome that caused it
          expect(scenario.logger.entries.filter((entry) => isTerminalOutcomeSkip(entry.details, blockedBy))).toHaveLength(9)
          // when the same active status ends cleanly, its signature and all eight slots remain available
          for (let i = 0; i < 9; i++) {
            scenario.advance(i)
            await scenario.end(clean)
          }
          // then the normal cap still applies
          expect(scenario.pi.messages).toHaveLength(8)
        })
      }

      for (const { name, event } of continuableOutcomes) {
        it(`#given ${name} #when the run settles #then it still continues`, async () => {
          const scenario = await setup(component, coordinated)
          await scenario.end(event)
          expect(scenario.pi.messages).toHaveLength(1)
        })
      }

      it("#given an already continued signature #when a failure intervenes #then it does not reset dedupe", async () => {
        const scenario = await setup(component, coordinated)
        await scenario.end(clean)
        // given a NEW plan revision: an ungated handler would deliver on this edge
        scenario.advance(1)
        await scenario.end({ ...clean, messages: [errorMessage] })
        expect(scenario.pi.messages).toHaveLength(1)
        // when the same revision then ends cleanly #then its unspent signature still continues
        await scenario.end(clean)
        expect(scenario.pi.messages).toHaveLength(2)
      })

      it("#given a run the host has not settled #when its turn is held for compaction or retry #then nothing is delivered until it settles", async () => {
        const scenario = await setup(component, coordinated)
        await scenario.endTurn(clean)
        expect(scenario.pi.messages).toEqual([])
        expect(scenario.coordinator.pendingCount()).toBe(0)
        await scenario.settle()
        expect(scenario.pi.messages).toHaveLength(1)
      })

      it("#given a late user abort #when the host mutates the recorded event before settling #then nothing is delivered", async () => {
        const scenario = await setup(component, coordinated)
        const event: Record<string, unknown> = { ...clean }
        await scenario.endTurn(event)
        // The host mutates the event object it already dispatched while the boundary is open.
        event["aborted"] = true
        event["abortSource"] = "user"
        await scenario.settle()
        expect(scenario.pi.messages).toEqual([])
        expect(scenario.logger.entries.filter((entry) => isTerminalOutcomeSkip(entry.details, "aborted"))).toHaveLength(1)
      })

      it("#given a settle with no recorded run #when it fires #then nothing is delivered", async () => {
        const scenario = await setup(component, coordinated)
        await scenario.settle()
        expect(scenario.pi.messages).toEqual([])
      })

      it("#given a recorded run #when user input arrives before the settle #then the user owns the edge", async () => {
        const scenario = await setup(component, coordinated)
        await scenario.endTurn(clean)
        await scenario.pi.dispatch(
          "input",
          { type: "input", text: "stop and do this instead", source: "interactive" },
          { cwd: "/repo", sessionManager: { getSessionId: () => "qa-s1" } },
        )
        await scenario.settle()
        expect(scenario.pi.messages).toEqual([])
      })
    })
  }
}

describe("loop terminal outcome across the awaited status probe", () => {
  it("#given a user abort while the toolkit probe runs #when the run settles #then the plan is not resubmitted", async () => {
    const scenario = await setup("loop", true)
    const event: Record<string, unknown> = { ...clean }
    // Senpi awaits agent_end handlers across the two-process toolkit spawn and, on a late Esc,
    // mutates this same event object (`dist/core/agent-abort-provenance.js:22-33`).
    scenario.duringProbe(() => {
      event["aborted"] = true
      event["abortSource"] = "user"
    })
    await scenario.end(event)
    expect(scenario.pi.messages).toEqual([])
    expect(scenario.coordinator.pendingCount()).toBe(0)
  })
})

function isTerminalOutcomeSkip(details: unknown, blockedBy: string): boolean {
  if (typeof details !== "object" || details === null) return false
  const record = details as Record<string, unknown>
  return record["reason"] === "terminal-outcome" && record["blockedBy"] === blockedBy
}
