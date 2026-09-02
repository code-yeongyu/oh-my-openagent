import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { releaseAllPromptAsyncReservationsForTesting } from "../../shared/prompt-async-gate"
import { hasInternalNoReplyMarker, isSyntheticOrInternalTextPart } from "../../shared/internal-initiator-marker"
import { createGoalHook } from "./index"

type RecordedPromptAsync = {
  path: { id: string }
  body: {
    parts: Array<{ type: string; text: string; synthetic?: boolean }>
  }
}

function makePluginInput(recorded?: RecordedPromptAsync[]): PluginInput {
  return {
    directory: mkdtempSync(join(tmpdir(), "goal-hook-")),
    client: {
      session: {
        messages: {
          create: async () => ({ id: "msg-1" }),
        },
        ...(recorded
          ? {
              promptAsync: async (input: RecordedPromptAsync) => {
                recorded.push(input)
                return { id: "msg-async-1" }
              },
            }
          : {}),
      },
    },
  } as unknown as PluginInput
}

describe("createGoalHook", () => {
  test("setGoal and getGoal round trip", () => {
    const ctx = makePluginInput()
    const hook = createGoalHook(ctx, { projectDir: ctx.directory })

    const goal = hook.setGoal("s1", "Ship it")

    expect(goal.objective).toBe("Ship it")
    expect(hook.getGoal("s1")?.objective).toBe("Ship it")
  })

  test("clearGoal removes goal", () => {
    const ctx = makePluginInput()
    const hook = createGoalHook(ctx, { projectDir: ctx.directory })
    hook.setGoal("s1", "Ship it")

    hook.clearGoal("s1")

    expect(hook.getGoal("s1")).toBeNull()
  })

  test("session.deleted clears goal", async () => {
    const ctx = makePluginInput()
    const hook = createGoalHook(ctx, { projectDir: ctx.directory })
    hook.setGoal("s1", "Ship it")

    await hook.event({ event: { type: "session.deleted", properties: { sessionID: "s1" } } })

    expect(hook.getGoal("s1")).toBeNull()
  })

  test("session.idle injects continuation for active goal", async () => {
    const ctx = makePluginInput()
    const hook = createGoalHook(ctx, { projectDir: ctx.directory })
    hook.setGoal("s1", "Ship it")

    await hook.event({ event: { type: "session.idle", properties: { sessionID: "s1" } } })

    // No crash; injection is best-effort.
    expect(hook.getGoal("s1")?.status).toBe("active")
  })

  test("session.idle skips paused goal", async () => {
    const ctx = makePluginInput()
    const hook = createGoalHook(ctx, { projectDir: ctx.directory })
    hook.setGoal("s1", "Ship it")
    hook.pauseGoal("s1")

    await hook.event({ event: { type: "session.idle", properties: { sessionID: "s1" } } })

    expect(hook.getGoal("s1")?.status).toBe("paused")
  })

  test("event without sessionID is ignored", async () => {
    const ctx = makePluginInput()
    const hook = createGoalHook(ctx, { projectDir: ctx.directory })
    hook.setGoal("s1", "Ship it")

    await hook.event({ event: { type: "session.idle", properties: {} } })

    expect(hook.getGoal("s1")?.status).toBe("active")
  })
})

describe("goal hook compaction anchor", () => {
  afterEach(() => {
    releaseAllPromptAsyncReservationsForTesting()
  })

  test("session.compacted re-anchors the original objective as an internal prompt", async () => {
    // given: a goal created from a multi-deliverable user request
    const recorded: RecordedPromptAsync[] = []
    const ctx = makePluginInput(recorded)
    const hook = createGoalHook(ctx, { projectDir: ctx.directory })
    hook.setGoal("s1", "Build the exporter\n- csv output\n- json output")

    // when: the session is compacted
    await hook.event({ event: { type: "session.compacted", properties: { sessionID: "s1" } } })

    // then: exactly one internal prompt carries the original objective and its pending deliverables
    expect(recorded).toHaveLength(1)
    const dispatched = recorded[0]
    expect(dispatched.path.id).toBe("s1")
    const part = dispatched.body.parts[0]
    expect(part.type).toBe("text")
    expect(part.text).toContain("<session-goal>")
    expect(part.text).toContain("<original_objective>")
    expect(part.text).toContain("<current_objective>")
    expect(part.text).toContain("Build the exporter")
    expect(part.text).toContain("csv output")
    expect(part.text).toContain("json output")
    // and: it is marked synthetic/internal so it is not classified as a genuine latest user message
    expect(part.synthetic).toBe(true)
    expect(isSyntheticOrInternalTextPart(part)).toBe(true)
    expect(hasInternalNoReplyMarker(part.text)).toBe(true)
  })

  test("session.compacted anchors an explicitly redirected goal with its new original", async () => {
    const recorded: RecordedPromptAsync[] = []
    const ctx = makePluginInput(recorded)
    const hook = createGoalHook(ctx, { projectDir: ctx.directory })
    hook.setGoal("s1", "Build the exporter\n- csv output\n- json output")
    hook.setGoal("s1", "Finish the csv output only")

    await hook.event({ event: { type: "session.compacted", properties: { sessionID: "s1" } } })

    expect(recorded).toHaveLength(1)
    expect(recorded[0].body.parts[0].text).toContain(
      "<original_objective>\nFinish the csv output only\n</original_objective>",
    )
  })

  test("session.compacted skips sessions without a goal", async () => {
    const recorded: RecordedPromptAsync[] = []
    const ctx = makePluginInput(recorded)
    const hook = createGoalHook(ctx, { projectDir: ctx.directory })

    await hook.event({ event: { type: "session.compacted", properties: { sessionID: "s-none" } } })

    expect(recorded).toHaveLength(0)
  })

  test("session.compacted skips completed goals", async () => {
    const recorded: RecordedPromptAsync[] = []
    const ctx = makePluginInput(recorded)
    const hook = createGoalHook(ctx, { projectDir: ctx.directory })
    hook.setGoal("s1", "Done deal")
    hook.markComplete("s1")

    await hook.event({ event: { type: "session.compacted", properties: { sessionID: "s1" } } })

    expect(recorded).toHaveLength(0)
  })
})
