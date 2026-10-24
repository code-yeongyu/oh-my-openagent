import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { CreateAgentSessionOptions } from "@code-yeongyu/senpi"
import type { OmoConfig } from "@oh-my-opencode/omo-config-core"
import type { ChildSessionListener, CreateChildSession } from "@oh-my-opencode/senpi-task"

import { createInProcessJudgeRunner, findModelReference, isModelUnavailableStart } from "../../task/judge-runner"
import { registrySnapshot } from "../facts-runner.test-support"
import { createKibitzerSidecarChildStarter, KibitzerSidecarStartError } from "./sidecar-model"
import { createWakeToolBudget } from "./tools/budget"
import { createKibitzerSidecarNudgeTool } from "./tools/nudge"

const root = mkdtempSync(join(tmpdir(), "kibitzer-start-ladder-"))
afterAll(() => rmSync(root, { recursive: true, force: true }))
const registry = registrySnapshot([{ id: "mock-1" }, { id: "mock-2" }, { id: "substitute" }])
const config: OmoConfig = { categories: { quick: { model: "omo-mock/mock-1", fallback_models: [{ model: "omo-mock/mock-2" }] } } }

function nudgeTool() {
  const budget = createWakeToolBudget(8)
  return createKibitzerSidecarNudgeTool({
    offered: new Set(), searched: new Set(), surfaced: new Set(), maxItems: 2, accepted: () => [], budget: () => budget,
  })
}

function sessionsOpeningSubstituteFor(refusedIds: ReadonlySet<string>) {
  const requested: string[] = []
  const createSession: CreateChildSession = async (options: CreateAgentSessionOptions) => {
    const asked = options.model
    if (asked === undefined) throw new Error("the starter must pass a model")
    requested.push(asked.id)
    const listeners = new Set<ChildSessionListener>()
    return {
      sessionId: `child-${requested.length}`,
      model: refusedIds.has(asked.id) ? registry.find("omo-mock", "substitute") : asked,
      prompt: async () => undefined,
      steer: async () => "handled",
      followUp: async () => "handled",
      abort: async () => undefined,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      getLastAssistantText: () => undefined,
      dispose: () => undefined,
    }
  }
  return { requested, createSession }
}

function starterFor(createSession: CreateChildSession, warnings: string[]) {
  return createKibitzerSidecarChildStarter({
    cwd: root,
    sessionDir: join(root, "recall", "sidecars", "cGFyZW50LTE"),
    agentDir: join(root, "agent"),
    loadConfig: () => config,
    modelRegistry: () => registry,
    loadPersona: () => "persona text",
    loadTaskRuntime: async () => ({ createInProcessJudgeRunner, findModelReference, isModelUnavailableStart }),
    createSession,
    logger: { debug: () => undefined, info: () => undefined, warn: (message) => { warnings.push(message) }, error: () => undefined },
  })
}

const wake = (generation: number) => ({ sessionId: "parent-1", generation, prompt: "<kibitzer-seed/>", tools: [nudgeTool()], maxItems: 2 })

describe("Kibitzer start ladder (#10536)", () => {
  test("#given the head candidate is refused after start #when a wake starts #then the next category candidate answers and later wakes begin there", async () => {
    // given
    const sessions = sessionsOpeningSubstituteFor(new Set(["mock-1"]))
    const warnings: string[] = []
    const start = starterFor(sessions.createSession, warnings)

    // when
    const first = await start(wake(1))
    await first.dispose()
    const second = await start(wake(2))
    await second.dispose()

    // then
    expect(sessions.requested).toEqual(["mock-1", "mock-2", "mock-2"])
    expect(warnings).toHaveLength(1)
  })

  test("#given every category candidate is refused #when a wake starts #then it fails typed with the substitution reason, and the next wake tries the chain again", async () => {
    // given
    const sessions = sessionsOpeningSubstituteFor(new Set(["mock-1", "mock-2"]))
    const start = starterFor(sessions.createSession, [])

    // when
    const failure = await start(wake(1)).catch((error: unknown) => error)
    const retry = await start(wake(2)).catch((error: unknown) => error)

    // then
    expect(failure).toBeInstanceOf(KibitzerSidecarStartError)
    expect(failure).toMatchObject({ code: "session_create_failed" })
    expect((failure as Error).message).toContain("refusing the substitution")
    expect(retry).toBeInstanceOf(KibitzerSidecarStartError)
    expect(sessions.requested).toEqual(["mock-1", "mock-2", "mock-1", "mock-2"])
  })

  test("#given a start failure that is not a pin refusal #when a wake starts #then the ladder stops at once", async () => {
    // given
    const requested: string[] = []
    const createSession: CreateChildSession = async (options) => {
      requested.push(options.model?.id ?? "")
      throw new Error("session store unavailable")
    }
    const start = starterFor(createSession, [])

    // when
    const failure = await start(wake(1)).catch((error: unknown) => error)

    // then
    expect(failure).toMatchObject({ code: "session_create_failed" })
    expect(requested).toEqual(["mock-1"])
  })
})
