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

function createLogger(): ComponentContext["logger"] & { entries: unknown[] } {
  const entries: unknown[] = []
  return {
    info: (_message: string, details?: unknown) => entries.push({ level: "info", details }),
    warn: (_message: string, details?: unknown) => entries.push({ level: "warn", details }),
    error: (_message: string, details?: unknown) => entries.push({ level: "error", details }),
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
  const coordinator = new IdleInjectionCoordinator((content) => delivered.push(content))
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

    await expect(
      pi.dispatch("agent_end", { type: "agent_end" }, eventCtx(root, "qa-s1")),
    ).resolves.toBeDefined()
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

  it("#given identical boulder signature twice #when agent_end repeats #then second is suppressed", async () => {
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
    await pi.dispatch("agent_end", { type: "agent_end" }, eventCtx(root, "qa-s1"))

    expect(delivered).toHaveLength(1)
  })

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
      // Vary the signature each iteration so stale-signature suppression does not mask the cap.
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
      { type: "input", text: "hello", source: "user" },
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
