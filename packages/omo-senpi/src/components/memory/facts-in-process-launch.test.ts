import { describe, expect, test } from "bun:test"
import type { CreateAgentSessionOptions } from "@code-yeongyu/senpi"
import type { ChildSessionListener, CreateChildSession } from "@oh-my-opencode/senpi-task"
import { mkdir, readFile } from "node:fs/promises"
import { join } from "node:path"

import { launchFactsInProcess } from "./facts-in-process-launch"
import { FACTS_RECORD_TOOL_NAME } from "./facts-record-tool"
import { fixture, runnerOptions } from "./facts-runner.test-support"
import { registrySnapshot } from "./kibitzer-runner.test-support"
import type { ReflectionModelCandidate } from "./worker/resolve-model"
import { writeRunJsonAtomic, type RunOutcome } from "./worker/run-artifacts"

const PRIMARY = "omo-mock/mock-1"
const FALLBACK = "omo-mock/mock-2"
const LAST = "omo-mock/mock-3"

type LaunchMode = "completed" | "create-failed" | "child-failed" | "record-stop"

function turnEvents(mode: LaunchMode): readonly { readonly type: "message_end"; readonly message: Record<string, unknown> }[] {
  if (mode === "child-failed") {
    return [{
      type: "message_end",
      message: { role: "assistant", content: [], stopReason: "error", errorMessage: "503 upstream unavailable" },
    }]
  }
  if (mode === "record-stop") {
    return [
      {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: "c1", name: FACTS_RECORD_TOOL_NAME, arguments: { scope: "project", text: "uses Bun", date: "2026-08-10" } }],
          stopReason: "toolUse",
        },
      },
      {
        type: "message_end",
        message: { role: "assistant", content: [], stopReason: "stop" },
      },
    ]
  }
  return [{
    type: "message_end",
    message: { role: "assistant", content: [], stopReason: "stop" },
  }]
}

async function launchFactsChild(
  fallbacks: readonly ReflectionModelCandidate[],
  mode: LaunchMode = "completed",
): Promise<{ readonly captured: readonly CreateAgentSessionOptions[]; readonly runDir: string }> {
  const { root, identity, queue } = await fixture()
  const runId = "facts-chain"
  const runDir = join(root, runId)
  await mkdir(runDir)
  await writeRunJsonAtomic(join(runDir, "ledger.json"), { version: 1, runId, kind: "facts" })
  const captured: CreateAgentSessionOptions[] = []
  const createSession: CreateChildSession = async (options) => {
    captured.push(options)
    if (mode === "create-failed" && captured.length === 1) throw new Error("primary session unavailable")
    const listeners = new Set<ChildSessionListener>()
    return {
      sessionId: `facts-child-${captured.length}`,
      prompt: async () => {
        for (const event of turnEvents(mode)) {
          for (const listener of listeners) listener(event)
        }
      },
      steer: async () => undefined,
      followUp: async () => undefined,
      abort: async () => undefined,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      getLastAssistantText: () => undefined,
      dispose: () => undefined,
    }
  }
  const registry = registrySnapshot([{ id: "mock-1" }, { id: "mock-2" }, { id: "mock-3" }])
  const options = runnerOptions(root, identity, queue, "empty", { createRunner: undefined, createSession })
  const cancelled = await launchFactsInProcess({
    runId,
    runDir,
    payload: {
      version: 1,
      identity: identity.id,
      today: "2026-08-10",
      entries: [],
      knownPeople: [],
      primaryHuman: { slug: "human", aliases: [] },
    },
    resolution: { kind: "resolved", category: "quick", model: PRIMARY, fallbacks },
    modelRegistry: registry,
    options,
    env: { HOME: root },
    configSources: [],
    batchId: "facts-chain-batch",
    queued: [],
    launchedAt: options.now?.().getTime() ?? 0,
    deadlineMs: 10_000,
  })
  expect(cancelled).toBe(false)
  return { captured, runDir }
}

async function launchSessionOptions(
  fallbacks: readonly ReflectionModelCandidate[],
  mode: LaunchMode = "completed",
): Promise<readonly CreateAgentSessionOptions[]> {
  return (await launchFactsChild(fallbacks, mode)).captured
}

async function readOutcome(runDir: string): Promise<RunOutcome> {
  return JSON.parse(await readFile(join(runDir, "outcome.json"), "utf8")) as RunOutcome
}

describe("launchFactsInProcess quick chain", () => {
  test("#given a quick fallback #when the facts child is created #then its runtime enables the remaining chain", async () => {
    const captured = await launchSessionOptions([{ model: FALLBACK }])

    expect(captured).toHaveLength(1)
    expect(captured[0]?.settingsManager?.getRetryFallbackSettings()).toMatchObject({
      modelFallback: true,
      chains: { [PRIMARY]: [FALLBACK] },
    })
  })

  test("#given a quick fallback #when the facts child is created #then its same-model retry budget is one", async () => {
    const captured = await launchSessionOptions([{ model: FALLBACK }])

    expect(captured).toHaveLength(1)
    expect(captured[0]?.settingsManager?.getRetrySettings().maxRetries).toBe(1)
  })

  test("#given no fallback #when the facts child is created #then model fallback stays disabled", async () => {
    const captured = await launchSessionOptions([])

    expect(captured).toHaveLength(1)
    expect(captured[0]?.settingsManager?.getRetryFallbackSettings()).toMatchObject({ modelFallback: false, chains: {} })
  })

  test("#given primary session creation fails #when the next candidate launches #then its chain contains only later rungs", async () => {
    const captured = await launchSessionOptions([{ model: FALLBACK }, { model: LAST }], "create-failed")

    expect(captured).toHaveLength(2)
    expect(captured[1]?.model?.id).toBe("mock-2")
    expect(captured[1]?.settingsManager?.getRetryFallbackSettings()).toMatchObject({
      modelFallback: true,
      chains: { [FALLBACK]: [LAST] },
    })
    expect(captured[1]?.settingsManager?.getRetrySettings().maxRetries).toBe(1)
  })

  test("#given the child turn fails #when the launch settles #then the outer loop does not launch another child", async () => {
    const captured = await launchSessionOptions([{ model: FALLBACK }], "child-failed")

    expect(captured).toHaveLength(1)
  })

  test("#given a facts child that records one fact and stops without assistant text #when the launch settles #then the run completes with childExit 0", async () => {
    const { runDir } = await launchFactsChild([], "record-stop")
    const outcome = await readOutcome(runDir)

    expect(outcome.childExit.code).toBe(0)
    expect(outcome.timedOut).toBe(false)
  })

  test("#given a facts child whose turn ends with stopReason error #when the launch settles #then the run still fails", async () => {
    const { runDir } = await launchFactsChild([], "child-failed")
    const outcome = await readOutcome(runDir)

    expect(outcome.childExit.code).toBe(1)
    expect(outcome.timedOut).toBe(false)
  })

  test("#given a facts child that records nothing and stops without assistant text #when the launch settles #then the run completes with childExit 0", async () => {
    const { runDir } = await launchFactsChild([], "completed")
    const outcome = await readOutcome(runDir)

    expect(outcome.childExit.code).toBe(0)
    expect(outcome.timedOut).toBe(false)
  })
})
