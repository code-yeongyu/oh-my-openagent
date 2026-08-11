import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildIdentityPaths } from "@oh-my-opencode/memory-core"

import { collectReflection } from "../palace/collectors"
import {
  REFLECTION_COMPLETION_ENTRY_TYPE,
  consumePendingReflectionCompletions,
  recordReflectionCompletion,
  registerReflectionCompletionRenderer,
  type ReflectionCompletionRecord,
} from "./completion"
import { CapturedCompletionApi } from "./runner.test-support"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

function record(): ReflectionCompletionRecord {
  return {
    schemaVersion: 1,
    runId: "run-offline",
    identity: "agent-test",
    category: "quick",
    model: "omo-mock/mock-1",
    thinking: "high",
    conversationIds: ["conversation-a"],
    outcome: "merged",
    startedAt: "2026-08-09T12:00:00.000Z",
    finishedAt: "2026-08-09T12:00:01.000Z",
    delivery: { status: "pending" },
  }
}

describe("reflection completion flow", () => {
  test("#given no live source session #when completion is recorded #then it remains durable and pending", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "reflection-completion-"))
    roots.push(root)

    // when
    const written = await recordReflectionCompletion(root, record())

    // then
    expect(written.delivery.status).toBe("pending")
    const persisted: unknown = JSON.parse(await readFile(join(root, "run-offline.json"), "utf8"))
    expect(persisted).toEqual(written)
    expect(persisted).toMatchObject({
      runId: "run-offline",
      outcome: "merged",
      finishedAt: "2026-08-09T12:00:01.000Z",
    })
  })

  test("#given a worker completion record #when the landed palace collector reads reflection outcomes #then runId outcome and finishedAt match its contract", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "reflection-completion-"))
    roots.push(root)
    const paths = buildIdentityPaths(root, "agent-test")
    await recordReflectionCompletion(join(paths.reflection, "completions"), record())

    // when
    const reflection = await collectReflection(paths, { limit: 5 })

    // then
    expect(reflection.outcomes).toEqual([{
      runId: "run-offline",
      outcome: "merged",
      finishedAt: "2026-08-09T12:00:01.000Z",
    }])
  })

  test("#given a pending offline completion #when its source session starts #then appendEntry notify and consumed state happen without a model message", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "reflection-completion-"))
    roots.push(root)
    await recordReflectionCompletion(root, record())
    const api = new CapturedCompletionApi()
    const notifications: Array<{ message: string; level: string }> = []
    registerReflectionCompletionRenderer(api)

    // when
    const consumed = await consumePendingReflectionCompletions(root, {
      sessionId: "conversation-a",
      api,
      ui: { notify: (message, level) => notifications.push({ message, level }) },
    })

    // then
    expect(consumed).toHaveLength(1)
    expect(api.renderers.map((item) => item.customType)).toEqual([REFLECTION_COMPLETION_ENTRY_TYPE])
    expect(api.entries).toEqual([{ customType: REFLECTION_COMPLETION_ENTRY_TYPE, data: consumed[0] }])
    expect(notifications).toHaveLength(1)
    expect(consumed[0]?.delivery).toMatchObject({ status: "consumed", sessionId: "conversation-a" })
  })
})
