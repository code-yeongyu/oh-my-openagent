import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { IdleInjectionCoordinator } from "../../extension/idle-injection-coordinator"
import type { ComponentContext } from "../../extension/types"
import { createStartWorkContinuationComponent } from "./index"

const cleanupRoots: string[] = []

function cleanupAll(): void {
  for (const root of cleanupRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
}

function createTempWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), "senpi-start-work-"))
  cleanupRoots.push(root)
  mkdirSync(join(root, ".omo", "plans"), { recursive: true })
  mkdirSync(join(root, ".omo", "start-work"), { recursive: true })
  return root
}

function writePlan(root: string, name: string, content: string): void {
  writeFileSync(join(root, ".omo", "plans", `${name}.md`), content)
}

function writeBoulderJson(root: string, content: unknown): void {
  writeFileSync(join(root, ".omo", "boulder.json"), JSON.stringify(content))
}

function createLogger(): ComponentContext["logger"] & { entries: { level: string; message: string; details?: unknown }[] } {
  const entries: { level: string; message: string; details?: unknown }[] = []
  return {
    info: (message: string, details?: unknown) => entries.push({ level: "info", message, details }),
    warn: (message: string, details?: unknown) => entries.push({ level: "warn", message, details }),
    error: (message: string, details?: unknown) => entries.push({ level: "error", message, details }),
    entries,
  }
}

function eventCtx(root: string, sessionId: string): unknown {
  return {
    cwd: root,
    sessionManager: { getSessionId: () => sessionId },
  }
}

function makeCoordinator(): {
  coordinator: IdleInjectionCoordinator
  delivered: string[]
} {
  const delivered: string[] = []
  const coordinator = new IdleInjectionCoordinator((message) => delivered.push(message.content))
  return { coordinator, delivered }
}

describe("omo-senpi start-work-continuation", () => {
  it("#given no boulder state #when agent_end fires #then stays quiet", async () => {
    const root = createTempWorkspace()
    const pi = new FakeExtensionAPI()
    const logger = createLogger()
    const { coordinator, delivered } = makeCoordinator()
    await createStartWorkContinuationComponent().register(pi, {
      logger,
      config: { getFlag: () => false },
      idleCoordinator: coordinator,
    })

    await pi.dispatch("agent_end", { type: "agent_end" }, eventCtx(root, "qa-s1"))

    expect(delivered).toEqual([])
    expect(pi.userMessages).toEqual([])
  })

  it("#given malformed boulder JSON #when agent_end fires #then no injection and no throw", async () => {
    const root = createTempWorkspace()
    writeFileSync(join(root, ".omo", "boulder.json"), "not-json")
    const pi = new FakeExtensionAPI()
    const logger = createLogger()
    const { coordinator, delivered } = makeCoordinator()
    await createStartWorkContinuationComponent().register(pi, {
      logger,
      config: { getFlag: () => false },
      idleCoordinator: coordinator,
    })

    const results = await pi.dispatch("agent_end", { type: "agent_end" }, eventCtx(root, "qa-s1"))
    expect(results).toBeDefined()
    expect(delivered).toEqual([])
    expect(pi.userMessages).toEqual([])
  })

  it("#given completed work #when agent_end fires #then no injection", async () => {
    const root = createTempWorkspace()
    writePlan(root, "t", "## TODOs\n- [ ] 1. One\n")
    writeBoulderJson(root, {
      schema_version: 2,
      active_work_id: "w1",
      works: {
        w1: {
          work_id: "w1",
          active_plan: ".omo/plans/t.md",
          plan_name: "t",
          session_ids: ["senpi:qa-s1"],
          status: "completed",
          started_at: "2026-07-17T00:00:00Z",
        },
      },
    })
    const pi = new FakeExtensionAPI()
    const { coordinator, delivered } = makeCoordinator()
    await createStartWorkContinuationComponent().register(pi, {
      logger: createLogger(),
      config: { getFlag: () => false },
      idleCoordinator: coordinator,
    })

    await pi.dispatch("agent_end", { type: "agent_end" }, eventCtx(root, "qa-s1"))

    expect(delivered).toEqual([])
  })

  it("#given work owned by another harness #when agent_end fires #then no injection", async () => {
    const root = createTempWorkspace()
    writePlan(root, "t", "## TODOs\n- [ ] 1. One\n")
    writeBoulderJson(root, {
      schema_version: 2,
      active_work_id: "w1",
      works: {
        w1: {
          work_id: "w1",
          active_plan: ".omo/plans/t.md",
          plan_name: "t",
          session_ids: ["codex:qa-s1"],
          status: "active",
          started_at: "2026-07-17T00:00:00Z",
        },
      },
    })
    const pi = new FakeExtensionAPI()
    const { coordinator, delivered } = makeCoordinator()
    await createStartWorkContinuationComponent().register(pi, {
      logger: createLogger(),
      config: { getFlag: () => false },
      idleCoordinator: coordinator,
    })

    await pi.dispatch("agent_end", { type: "agent_end" }, eventCtx(root, "qa-s1"))

    expect(delivered).toEqual([])
  })

  it("#given active work with remaining tasks #when agent_end fires #then injects continuation directive", async () => {
    const root = createTempWorkspace()
    writePlan(root, "t", "## TODOs\n- [ ] 1. Task one\n- [ ] 2. Task two\n")
    writeBoulderJson(root, {
      schema_version: 2,
      active_work_id: "w1",
      works: {
        w1: {
          work_id: "w1",
          active_plan: ".omo/plans/t.md",
          plan_name: "t",
          session_ids: ["senpi:qa-s1"],
          status: "active",
          started_at: "2026-07-17T00:00:00Z",
          updated_at: "2026-07-17T01:00:00Z",
        },
      },
    })
    const pi = new FakeExtensionAPI()
    const { coordinator, delivered } = makeCoordinator()
    await createStartWorkContinuationComponent().register(pi, {
      logger: createLogger(),
      config: { getFlag: () => false },
      idleCoordinator: coordinator,
    })

    await pi.dispatch("agent_end", { type: "agent_end" }, eventCtx(root, "qa-s1"))

    expect(delivered).toHaveLength(1)
    const content = delivered[0] ?? ""
    expect(content).toContain("Plan file:")
    expect(content).toContain("t.md")
    expect(content).toContain("[Status: 0/2")
    expect(content).toContain("next: 1.")
    expect(content).toContain("senpi:qa-s1")
  })

  it("#given zero remaining tasks but total > 0 #when agent_end fires #then still injects final-gate directive", async () => {
    const root = createTempWorkspace()
    writePlan(root, "t", "## TODOs\n- [x] 1. Task one\n- [x] 2. Task two\n")
    writeBoulderJson(root, {
      schema_version: 2,
      active_work_id: "w1",
      works: {
        w1: {
          work_id: "w1",
          active_plan: ".omo/plans/t.md",
          plan_name: "t",
          session_ids: ["senpi:qa-s1"],
          status: "active",
          started_at: "2026-07-17T00:00:00Z",
          updated_at: "2026-07-17T01:00:00Z",
        },
      },
    })
    const pi = new FakeExtensionAPI()
    const { coordinator, delivered } = makeCoordinator()
    await createStartWorkContinuationComponent().register(pi, {
      logger: createLogger(),
      config: { getFlag: () => false },
      idleCoordinator: coordinator,
    })

    await pi.dispatch("agent_end", { type: "agent_end" }, eventCtx(root, "qa-s1"))

    expect(delivered).toHaveLength(1)
    const content = delivered[0] ?? ""
    expect(content).toContain("[Status: 2/2")
    expect(content).toContain("Final gate")
    expect(content).toMatch(/final gate|Final Verification/i)
  })

  it("#given active work #when directive renders #then it instructs honoring the recorded PR delivery mode", async () => {
    const root = createTempWorkspace()
    writePlan(root, "t", "## TODOs\n- [ ] 1. Task one\n")
    writeBoulderJson(root, {
      schema_version: 2,
      active_work_id: "w1",
      works: {
        w1: {
          work_id: "w1",
          active_plan: ".omo/plans/t.md",
          plan_name: "t",
          session_ids: ["senpi:qa-s1"],
          status: "active",
          started_at: "2026-07-17T00:00:00Z",
          updated_at: "2026-07-17T01:00:00Z",
        },
      },
    })
    const pi = new FakeExtensionAPI()
    const { coordinator, delivered } = makeCoordinator()
    await createStartWorkContinuationComponent().register(pi, {
      logger: createLogger(),
      config: { getFlag: () => false },
      idleCoordinator: coordinator,
    })

    await pi.dispatch("agent_end", { type: "agent_end" }, eventCtx(root, "qa-s1"))

    expect(delivered).toHaveLength(1)
    const content = delivered[0] ?? ""
    expect(content).toContain("--make-pr")
    expect(content).toContain("--ship")
    expect(content).toContain("delivery mode")
  })

  it("#given paused work #when agent_end fires #then injects continuation directive", async () => {
    const root = createTempWorkspace()
    writePlan(root, "t", "## TODOs\n- [ ] 1. Task one\n")
    writeBoulderJson(root, {
      schema_version: 2,
      active_work_id: "w1",
      works: {
        w1: {
          work_id: "w1",
          active_plan: ".omo/plans/t.md",
          plan_name: "t",
          session_ids: ["senpi:qa-s1"],
          status: "paused",
          started_at: "2026-07-17T00:00:00Z",
          updated_at: "2026-07-17T01:00:00Z",
        },
      },
    })
    const pi = new FakeExtensionAPI()
    const { coordinator, delivered } = makeCoordinator()
    await createStartWorkContinuationComponent().register(pi, {
      logger: createLogger(),
      config: { getFlag: () => false },
      idleCoordinator: coordinator,
    })

    await pi.dispatch("agent_end", { type: "agent_end" }, eventCtx(root, "qa-s1"))

    expect(delivered).toHaveLength(1)
    expect(delivered[0]).toContain("[Status: 0/1")
  })

  // Case A: No-progress same-signature recovery allows bounded retry instead of permanent instant stall
  it("#given active work #when agent_end repeats with identical signature #then allows bounded recovery retry", async () => {
    const root = createTempWorkspace()
    writePlan(root, "t", "## TODOs\n- [ ] 1. Task one\n")
    writeBoulderJson(root, {
      schema_version: 2,
      active_work_id: "w1",
      works: {
        w1: {
          work_id: "w1",
          active_plan: ".omo/plans/t.md",
          plan_name: "t",
          session_ids: ["senpi:qa-s1"],
          status: "active",
          started_at: "2026-07-17T00:00:00Z",
          updated_at: "2026-07-17T01:00:00Z",
        },
      },
    })
    const pi = new FakeExtensionAPI()
    const logger = createLogger()
    const { coordinator, delivered } = makeCoordinator()
    await createStartWorkContinuationComponent({ maxSameSignatureRetries: 1 }).register(pi, {
      logger,
      config: { getFlag: () => false },
      idleCoordinator: coordinator,
    })

    // Turn 1: initial continuation
    await pi.dispatch("agent_end", { type: "agent_end" }, eventCtx(root, "qa-s1"))
    expect(delivered).toHaveLength(1)

    // Turn 2: same signature (no progress yet) -> bounded retry continuation is emitted
    await pi.dispatch("agent_end", { type: "agent_end" }, eventCtx(root, "qa-s1"))
    expect(delivered).toHaveLength(2)

    // Verify structured logging
    const scheduledEntries = logger.entries.filter((e) => e.message === "omo-senpi start-work-continuation scheduled")
    expect(scheduledEntries).toHaveLength(2)
    expect(scheduledEntries[1]?.details).toMatchObject({
      isSameSignatureRetry: true,
      sameSignatureRetries: 1,
    })
  })

  // Case B: Retry remains strictly bounded when repeatedly producing no progress
  it("#given no progress on signature S #when retry limit is reached #then stops with retry-budget-exhausted", async () => {
    const root = createTempWorkspace()
    writePlan(root, "t", "## TODOs\n- [ ] 1. Task one\n")
    writeBoulderJson(root, {
      schema_version: 2,
      active_work_id: "w1",
      works: {
        w1: {
          work_id: "w1",
          active_plan: ".omo/plans/t.md",
          plan_name: "t",
          session_ids: ["senpi:qa-s1"],
          status: "active",
          started_at: "2026-07-17T00:00:00Z",
          updated_at: "2026-07-17T01:00:00Z",
        },
      },
    })
    const pi = new FakeExtensionAPI()
    const logger = createLogger()
    const { coordinator, delivered } = makeCoordinator()
    await createStartWorkContinuationComponent({ maxSameSignatureRetries: 2 }).register(pi, {
      logger,
      config: { getFlag: () => false },
      idleCoordinator: coordinator,
    })

    // 1 initial + 2 retries = 3 continuations
    await pi.dispatch("agent_end", { type: "agent_end" }, eventCtx(root, "qa-s1")) // initial (1)
    await pi.dispatch("agent_end", { type: "agent_end" }, eventCtx(root, "qa-s1")) // retry 1 (2)
    await pi.dispatch("agent_end", { type: "agent_end" }, eventCtx(root, "qa-s1")) // retry 2 (3)
    expect(delivered).toHaveLength(3)

    // 4th turn: retry budget exhausted -> suppressed
    await pi.dispatch("agent_end", { type: "agent_end" }, eventCtx(root, "qa-s1"))
    expect(delivered).toHaveLength(3)

    const exhausted = logger.entries.find(
      (e) => e.message === "omo-senpi start-work-continuation skipped" && (e.details as any)?.reason === "retry-budget-exhausted",
    )
    expect(exhausted).toBeDefined()
    expect(exhausted?.details).toMatchObject({
      reason: "retry-budget-exhausted",
      retries: 2,
      maxRetries: 2,
    })
  })

  // Case C: Normal plan/checklist advancement clears stale retry state
  it("#given signature changes from S to S2 #when agent_end fires #then retry budget is reset for S2", async () => {
    const root = createTempWorkspace()
    writePlan(root, "t", "## TODOs\n- [ ] 1. Task one\n- [ ] 2. Task two\n")
    const baseState = {
      schema_version: 2,
      active_work_id: "w1",
      works: {
        w1: {
          work_id: "w1",
          active_plan: ".omo/plans/t.md",
          plan_name: "t",
          session_ids: ["senpi:qa-s1"],
          status: "active",
          started_at: "2026-07-17T00:00:00Z",
          updated_at: "2026-07-17T01:00:00Z",
        },
      },
    }
    writeBoulderJson(root, baseState)
    const pi = new FakeExtensionAPI()
    const logger = createLogger()
    const { coordinator, delivered } = makeCoordinator()
    await createStartWorkContinuationComponent({ maxSameSignatureRetries: 1 }).register(pi, {
      logger,
      config: { getFlag: () => false },
      idleCoordinator: coordinator,
    })

    // S: initial (1) + retry (2)
    await pi.dispatch("agent_end", { type: "agent_end" }, eventCtx(root, "qa-s1"))
    await pi.dispatch("agent_end", { type: "agent_end" }, eventCtx(root, "qa-s1"))
    expect(delivered).toHaveLength(2)

    // Now advance plan to S2 (1 task completed, updated_at changed)
    writePlan(root, "t", "## TODOs\n- [x] 1. Task one\n- [ ] 2. Task two\n")
    const updatedState = structuredClone(baseState)
    updatedState.works.w1.updated_at = "2026-07-17T02:00:00Z"
    writeBoulderJson(root, updatedState)

    // S2: should successfully deliver and have fresh retry budget
    await pi.dispatch("agent_end", { type: "agent_end" }, eventCtx(root, "qa-s1")) // S2 initial (3)
    expect(delivered).toHaveLength(3)

    // S2 retry: should also work because retry budget was re-armed
    await pi.dispatch("agent_end", { type: "agent_end" }, eventCtx(root, "qa-s1")) // S2 retry (4)
    expect(delivered).toHaveLength(4)
  })

  // Case D: User intervention resets continuation counter and retry budget
  it("#given exhausted retry budget #when user input arrives #then state resets and continuation resumes", async () => {
    const root = createTempWorkspace()
    writePlan(root, "t", "## TODOs\n- [ ] 1. Task one\n")
    writeBoulderJson(root, {
      schema_version: 2,
      active_work_id: "w1",
      works: {
        w1: {
          work_id: "w1",
          active_plan: ".omo/plans/t.md",
          plan_name: "t",
          session_ids: ["senpi:qa-s1"],
          status: "active",
          started_at: "2026-07-17T00:00:00Z",
          updated_at: "2026-07-17T01:00:00Z",
        },
      },
    })
    const pi = new FakeExtensionAPI()
    const { coordinator, delivered } = makeCoordinator()
    await createStartWorkContinuationComponent({ maxSameSignatureRetries: 1 }).register(pi, {
      logger: createLogger(),
      config: { getFlag: () => false },
      idleCoordinator: coordinator,
    })

    // S: initial (1) + retry (2) -> exhausted
    await pi.dispatch("agent_end", { type: "agent_end" }, eventCtx(root, "qa-s1"))
    await pi.dispatch("agent_end", { type: "agent_end" }, eventCtx(root, "qa-s1"))
    await pi.dispatch("agent_end", { type: "agent_end" }, eventCtx(root, "qa-s1")) // exhausted
    expect(delivered).toHaveLength(2)

    // User inputs something
    await pi.dispatch("input", { type: "input", text: "please continue with task 1", source: "user" }, eventCtx(root, "qa-s1"))

    // Continuation should resume immediately on next agent_end
    await pi.dispatch("agent_end", { type: "agent_end" }, eventCtx(root, "qa-s1"))
    expect(delivered).toHaveLength(3)
  })

  // Case E: Overall continuation cap enforcement
  it("#given 9 consecutive agent_end events with changing signature #when cap is 8 #then only 8 injections are delivered", async () => {
    const root = createTempWorkspace()
    writePlan(root, "t", "## TODOs\n- [ ] 1. Task one\n")
    const baseState = {
      schema_version: 2,
      active_work_id: "w1",
      works: {
        w1: {
          work_id: "w1",
          active_plan: ".omo/plans/t.md",
          plan_name: "t",
          session_ids: ["senpi:qa-s1"],
          status: "active",
          started_at: "2026-07-17T00:00:00Z",
          updated_at: "2026-07-17T01:00:00Z",
        },
      },
    }
    writeBoulderJson(root, baseState)
    const pi = new FakeExtensionAPI()
    const { coordinator, delivered } = makeCoordinator()
    await createStartWorkContinuationComponent().register(pi, {
      logger: createLogger(),
      config: { getFlag: () => false },
      idleCoordinator: coordinator,
    })

    for (let i = 0; i < 9; i++) {
      const varied = structuredClone(baseState)
      varied.works.w1.updated_at = `2026-07-17T01:00:0${i}Z`
      writeBoulderJson(root, varied)
      await pi.dispatch("agent_end", { type: "agent_end" }, eventCtx(root, "qa-s1"))
    }

    expect(delivered).toHaveLength(8)
  })

  it("#given cap reached #when user input arrives #then resets and continuation resumes", async () => {
    const root = createTempWorkspace()
    writePlan(root, "t", "## TODOs\n- [ ] 1. Task one\n")
    const baseState = {
      schema_version: 2,
      active_work_id: "w1",
      works: {
        w1: {
          work_id: "w1",
          active_plan: ".omo/plans/t.md",
          plan_name: "t",
          session_ids: ["senpi:qa-s1"],
          status: "active",
          started_at: "2026-07-17T00:00:00Z",
          updated_at: "2026-07-17T01:00:00Z",
        },
      },
    }
    writeBoulderJson(root, baseState)
    const pi = new FakeExtensionAPI()
    const { coordinator, delivered } = makeCoordinator()
    await createStartWorkContinuationComponent().register(pi, {
      logger: createLogger(),
      config: { getFlag: () => false },
      idleCoordinator: coordinator,
    })

    for (let i = 0; i < 8; i++) {
      const varied = structuredClone(baseState)
      varied.works.w1.updated_at = `2026-07-17T01:00:0${i}Z`
      writeBoulderJson(root, varied)
      await pi.dispatch("agent_end", { type: "agent_end" }, eventCtx(root, "qa-s1"))
    }
    expect(delivered).toHaveLength(8)

    await pi.dispatch("input", { type: "input", text: "hello", source: "user" }, eventCtx(root, "qa-s1"))
    const varied = structuredClone(baseState)
    varied.works.w1.updated_at = "2026-07-17T01:00:10Z"
    writeBoulderJson(root, varied)
    await pi.dispatch("agent_end", { type: "agent_end" }, eventCtx(root, "qa-s1"))

    expect(delivered).toHaveLength(9)
  })

  it("#given eligible boulder work #when user input arrives #then appends start-work steering reminder", async () => {
    const root = createTempWorkspace()
    writePlan(root, "t", "## TODOs\n- [ ] 1. Task one\n")
    writeBoulderJson(root, {
      schema_version: 2,
      active_work_id: "w1",
      works: {
        w1: {
          work_id: "w1",
          active_plan: ".omo/plans/t.md",
          plan_name: "t",
          session_ids: ["senpi:qa-s1"],
          status: "active",
          started_at: "2026-07-17T00:00:00Z",
          updated_at: "2026-07-17T01:00:00Z",
        },
      },
    })
    const pi = new FakeExtensionAPI()
    await createStartWorkContinuationComponent().register(pi, {
      logger: createLogger(),
      config: { getFlag: () => false },
    })

    const results = await pi.dispatch(
      "input",
      { type: "input", text: "hello", source: "user", streamingBehavior: "steer" },
      eventCtx(root, "qa-s1"),
    )

    expect(results).toHaveLength(1)
    const result = results[0]
    expect(result).toMatchObject({ action: "transform" })
    if (result && typeof result === "object" && "text" in result) {
      expect(result.text).toContain("<omo-senpi-start-work>")
      expect(result.text).toContain("hello")
    }
  })

  it("#given extension-sourced input #when eligible boulder work exists #then no transform", async () => {
    const root = createTempWorkspace()
    writePlan(root, "t", "## TODOs\n- [ ] 1. Task one\n")
    writeBoulderJson(root, {
      schema_version: 2,
      active_work_id: "w1",
      works: {
        w1: {
          work_id: "w1",
          active_plan: ".omo/plans/t.md",
          plan_name: "t",
          session_ids: ["senpi:qa-s1"],
          status: "active",
          started_at: "2026-07-17T00:00:00Z",
          updated_at: "2026-07-17T01:00:00Z",
        },
      },
    })
    const pi = new FakeExtensionAPI()
    await createStartWorkContinuationComponent().register(pi, {
      logger: createLogger(),
      config: { getFlag: () => false },
    })

    const results = await pi.dispatch(
      "input",
      { type: "input", text: "hello", source: "extension" },
      eventCtx(root, "qa-s1"),
    )

    expect(results).toEqual([{ action: "continue" }])
  })

  it("#given missing session manager #when agent_end fires #then skips silently", async () => {
    const root = createTempWorkspace()
    const pi = new FakeExtensionAPI()
    const { coordinator, delivered } = makeCoordinator()
    await createStartWorkContinuationComponent().register(pi, {
      logger: createLogger(),
      config: { getFlag: () => false },
      idleCoordinator: coordinator,
    })

    await pi.dispatch("agent_end", { type: "agent_end" }, { cwd: root })

    expect(delivered).toEqual([])
  })
})

process.on("beforeExit", cleanupAll)
