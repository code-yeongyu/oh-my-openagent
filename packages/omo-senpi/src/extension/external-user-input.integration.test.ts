import { afterEach, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { evaluateInvocationGuard } from "@oh-my-opencode/senpi-task"
import type { EventTelemetryProperties } from "@oh-my-opencode/telemetry-core"

import { dispatchRunEnd, enableFakeExtensionEvents, emitFakeExtensionEvent } from "../../test-support/fake-extension-api"
import { createFallbackArchitectComponent } from "../components/fallback-architect"
import { FALLBACK_ARCHITECT_REMINDER_TYPE } from "../components/fallback-architect/directive"
import { MemoryFakeExtensionAPI } from "../components/memory/memory.test-support"
import { ACCEPTED_TURNS_ENTRY_TYPE, createMemoryNudgeWiring } from "../components/memory/nudge-wiring"
import { createSkillPointersComponent, ULW_PLAN_CUSTOM_TYPE } from "../components/skill-pointers"
import { createSkillInvocationTracker } from "../components/task/skill-invocation-tracker"
import { createOmoNativePromptComponent } from "../components/telemetry/omo-native-prompt"
import { createUlwExecuteContinuationComponent } from "../components/ulw-execute-continuation"
import { createUlwLoopComponent } from "../components/ulw-loop"
import { activeStatus } from "../components/ulw-loop/ulw-loop.test-support"
import { installExternalUserInputApi } from "./external-user-input"
import type { ComponentContext } from "./types"

const roots: string[] = []
const componentContext: ComponentContext = {
  logger: { info() {}, warn() {}, error() {} },
  config: { getFlag: () => false },
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

// Unlike the shared fake, the host feeds each input transform to the next handler.
// The bridge must preserve that chain without mutating the host's source or input ID.
class InputChainAPI extends MemoryFakeExtensionAPI {
  override async dispatch(event: string, payload: unknown, ctx?: unknown): Promise<unknown[]> {
    if (event !== "input" || !isRecord(payload)) return super.dispatch(event, payload, ctx)
    let current = { ...payload }
    const results: unknown[] = []
    for (const registration of this.handlers) {
      if (registration.event !== event) continue
      const result = await registration.handler(current, ctx)
      results.push(result)
      if (!isRecord(result)) continue
      if (result.action === "handled") break
      if (result.action === "transform") {
        current = {
          ...current,
          text: result.text,
          ...(result.images === undefined ? {} : { images: result.images }),
        }
      }
    }
    return results
  }
}

function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), "senpi-external-input-"))
  roots.push(cwd)
  const sessionId = randomUUID()
  const ctx = { cwd, sessionManager: { getSessionId: () => sessionId, getEntries: () => [] } }
  const pi = new InputChainAPI()
  enableFakeExtensionEvents(pi)
  installExternalUserInputApi(pi)
  return { pi, ctx, cwd, sessionId }
}

function input(inputId: string, text = "continue", extra: Record<string, unknown> = {}) {
  return { type: "input", inputId, source: "extension", text, ...extra }
}

function submit<T>(
  pi: InputChainAPI,
  ctx: ReturnType<typeof fixture>["ctx"],
  send: () => Promise<T>,
): Promise<T> {
  let pending: Promise<T> | undefined
  const request = {
    sessionId: ctx.sessionManager.getSessionId(),
    handled: false,
    send: () => { pending = send() },
  }
  emitFakeExtensionEvent(pi, "omo:send-user-input", request)
  expect(request.handled).toBe(true)
  if (pending === undefined) throw new Error("External send was not dispatched by the bridge")
  return pending
}

function externalInput(
  pi: InputChainAPI,
  ctx: ReturnType<typeof fixture>["ctx"],
  payload: ReturnType<typeof input>,
): Promise<unknown[]> {
  return submit(pi, ctx, () => pi.dispatch("input", payload, ctx))
}

function disposition(pi: InputChainAPI, inputId: string, value: string) {
  return pi.dispatch("input_disposition", { type: "input_disposition", inputId, disposition: value })
}

function touch(pi: InputChainAPI, ctx: unknown, path: string) {
  return pi.dispatch("tool_result", {
    type: "tool_result", toolCallId: randomUUID(), toolName: "read",
    input: { path }, content: [], isError: false,
  }, ctx)
}

function settled(pi: InputChainAPI, ctx: unknown) {
  return dispatchRunEnd(pi, {
    type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }],
  }, ctx)
}

function transforms(results: unknown[]) {
  return results.filter((result): result is Record<string, unknown> & { text: string } =>
    isRecord(result) && result.action === "transform" && typeof result.text === "string")
}

function writeBoulder(cwd: string, sessionId: string, revision: number): void {
  mkdirSync(join(cwd, ".omo", "plans"), { recursive: true })
  writeFileSync(join(cwd, ".omo", "plans", "task.md"), "## TODOs\n- [ ] 1. Finish task\n")
  writeFileSync(join(cwd, ".omo", "boulder.json"), JSON.stringify({
    schema_version: 2,
    active_work_id: "work",
    works: {
      work: {
        work_id: "work", active_plan: ".omo/plans/task.md", plan_name: "task",
        session_ids: [`senpi:${sessionId}`], status: "active",
        started_at: "2026-10-23T00:00:00Z",
        updated_at: `2026-10-23T00:00:${String(revision).padStart(2, "0")}Z`,
      },
    },
  }))
}

async function bounded<T>(promise: Promise<T>, signal: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out awaiting ${signal}`)), 2_000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

describe("external input provenance through real consumers", () => {
  test.each(["ulw plan the change", "make a work plan before coding"])(
    "unlocks the real plan guard only after a external request and artifact: %s",
    async (requestText) => {
      // given
      const { pi, ctx, cwd, sessionId } = fixture()
      const tracker = createSkillInvocationTracker(pi)
      const verdicts = () => ["plan-consultant", "plan-reviewer"].map((name) =>
        evaluateInvocationGuard(name, tracker.stateFor(sessionId)).kind)
      await pi.dispatch("session_start", { type: "session_start" }, ctx)

      // when
      await pi.dispatch("input", input("ordinary", requestText), ctx)
      await touch(pi, ctx, join(cwd, "skills", "ulw-plan", "SKILL.md"))
      expect(tracker.stateFor(sessionId).hasUserRequested("ulw-plan")).toBe(false)
      expect(verdicts()).toEqual(["deny", "deny"])

      await externalInput(pi, ctx, input("requested", requestText))
      expect(tracker.stateFor(sessionId).hasUserRequested("ulw-plan")).toBe(true)
      expect(verdicts()).toEqual(["deny", "deny"])
      await touch(pi, ctx, join(cwd, ".omo", "plans", "task.md"))

      // then
      expect(verdicts()).toEqual(["allow", "allow"])
      await touch(pi, ctx, join(cwd, "skills", "ulw-execute", "SKILL.md"))
      await externalInput(pi, ctx, input("requested-again", requestText))
      expect(verdicts()).toEqual(["deny", "deny"])
      await pi.dispatch("session_shutdown", { type: "session_shutdown" }, ctx)
    },
  )

  test("an artifact plus ordinary extension requests cannot unlock plan review", async () => {
    // given
    const { pi, ctx, cwd, sessionId } = fixture()
    const tracker = createSkillInvocationTracker(pi)
    await pi.dispatch("session_start", { type: "session_start" }, ctx)
    await touch(pi, ctx, join(cwd, ".omo", "plans", "task.md"))

    // when
    await pi.dispatch("input", input("ordinary", "/skill:ulw-plan plan this"), ctx)
    await externalInput(pi, ctx, input("unrelated", "fix the login bug"))

    // then
    expect(tracker.stateFor(sessionId).hasUserRequested("ulw-plan")).toBe(false)
    expect(evaluateInvocationGuard("plan-reviewer", tracker.stateFor(sessionId)).kind).toBe("deny")
    await pi.dispatch("session_shutdown", { type: "session_shutdown" }, ctx)
  })

  test.each([undefined, "steer", "followUp"] as const)(
    "skill pointers deliver external requests atomically in %s mode",
    async (streamingBehavior) => {
      // given
      const { pi, ctx, sessionId } = fixture()
      await createSkillPointersComponent().register(pi, componentContext)
      const tracker = createSkillInvocationTracker(pi)
      await pi.dispatch("session_start", { type: "session_start" }, ctx)
      const payload = input("external-plan", "ulw plan the change", { streamingBehavior })

      // when
      expect(transforms(await pi.dispatch("input", input("ordinary", payload.text, {
        streamingBehavior,
      }), ctx))).toEqual([])
      expect(pi.messages).toEqual([])
      const changed = transforms(await externalInput(pi, ctx, payload))

      // then
      expect(tracker.stateFor(sessionId).hasUserRequested("ulw-plan")).toBe(true)
      if (streamingBehavior === undefined) {
        expect(changed).toEqual([])
        expect(pi.messages.map(({ message }) => [message.customType, message.display]))
          .toEqual([[ULW_PLAN_CUSTOM_TYPE, false]])
      } else {
        expect(pi.messages).toEqual([])
        expect(changed).toHaveLength(1)
        expect(changed[0].text.startsWith(`${payload.text}\n`)).toBe(true)
      }
      expect(payload.source).toBe("extension")
      await pi.dispatch("session_shutdown", { type: "session_shutdown" }, ctx)
    },
  )

  test.each(["ulw-execute", "ulw-loop"] as const)(
    "external input resets the %s cap and stale state, but extension input does not",
    async (workflow) => {
      // given
      const { pi, ctx, cwd, sessionId } = fixture()
      let revision = 0
      if (workflow === "ulw-execute") {
        await createUlwExecuteContinuationComponent().register(pi, componentContext)
      } else {
        await createUlwLoopComponent({
          planExists: () => true,
          readStatus: async () => ({ code: 0, stdout: activeStatus(`goal-${revision}`) }),
        }).register(pi, componentContext)
      }
      await pi.dispatch("session_start", { type: "session_start" }, ctx)
      for (; revision < 8; revision += 1) {
        if (workflow === "ulw-execute") writeBoulder(cwd, sessionId, revision)
        await settled(pi, ctx)
      }
      await pi.dispatch("input", input("ordinary"), ctx)
      await settled(pi, ctx)
      expect(pi.messages).toHaveLength(8)

      // when
      const changed = transforms(await externalInput(pi, ctx, input("queued", "continue", {
        streamingBehavior: "steer",
      })))
      expect(changed).toHaveLength(1)
      await settled(pi, ctx)
      await settled(pi, ctx)
      expect(pi.messages).toHaveLength(9)
      expect(transforms(await externalInput(pi, ctx, input("idle")))).toHaveLength(0)
      await settled(pi, ctx)

      // then
      expect(pi.messages).toHaveLength(10)
      const customType = workflow === "ulw-execute"
        ? "omo-senpi:ulw-execute-continuation" : "omo-senpi:ulw-continuation"
      expect(pi.messages.every(({ message, options }) =>
        message.customType === customType && message.display === false
        && options?.deliverAs === "followUp" && options.triggerTurn === true)).toBe(true)
      await pi.dispatch("session_shutdown", { type: "session_shutdown" }, ctx)
    },
  )

  test("the host awaits queued SDK status and chains both real continuation transforms", async () => {
    // given
    const { pi, ctx, cwd, sessionId } = fixture()
    writeBoulder(cwd, sessionId, 0)
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    let holdProbe = false
    await createUlwExecuteContinuationComponent().register(pi, componentContext)
    await createUlwLoopComponent({
      planExists: () => true,
      readStatus: async (statusCwd, statusSessionId) => {
        expect([statusCwd, statusSessionId]).toEqual([cwd, sessionId])
        if (holdProbe) {
          entered.resolve()
          await release.promise
        }
        return { code: 0, stdout: activeStatus() }
      },
    }).register(pi, componentContext)
    const observed: unknown[] = []
    pi.on("input", (payload) => { observed.push(payload) })
    await pi.dispatch("session_start", { type: "session_start" }, ctx)
    const images = [{ type: "image", data: "AA==", mimeType: "image/png" }]
    const payload = input("queued", "keep working", { streamingBehavior: "steer", images })

    // when
    holdProbe = true
    const pending = externalInput(pi, ctx, payload)
    try {
      await bounded(entered.promise, "queued ulw-loop status probe")
      expect(observed).toEqual([])
    } finally {
      release.resolve()
    }
    const changed = transforms(await bounded(pending, "host input dispatch"))

    // then
    expect(changed).toHaveLength(2)
    expect(changed[0].text.startsWith(`${payload.text}\n\n`)).toBe(true)
    expect(changed[1].text.startsWith(`${changed[0].text}\n\n`)).toBe(true)
    expect(observed).toEqual([{ ...payload, text: changed[1].text, source: "rpc" }])
    expect(payload.source).toBe("extension")
    expect(changed.every((result) => result.images === images)).toBe(true)
    expect(transforms(await pi.dispatch("input", input("ordinary", "continue", {
      streamingBehavior: "steer",
    }), ctx))).toHaveLength(0)
    await pi.dispatch("session_shutdown", { type: "session_shutdown" }, ctx)
  })

  test("fallback reminders follow external prompts without promoting nested extension input", async () => {
    // given
    const { pi, ctx } = fixture()
    await createFallbackArchitectComponent({ hasArchitectCategory: () => true }).register(pi, componentContext)
    await pi.dispatch("session_start", { type: "session_start" }, ctx)
    await pi.dispatch("message_end", {
      type: "message_end", message: { role: "assistant", stopReason: "error", stopDetails: { type: "refusal" } },
    }, ctx)
    await pi.dispatch("model_select", {
      type: "model_select", source: "fallback",
      previousModel: { provider: "anthropic", id: "claude-fable-5" },
      model: { provider: "anthropic", id: "claude-opus-5-5" },
    }, ctx)
    const reminders = () => pi.messages.filter(({ message }) =>
      message.customType === FALLBACK_ARCHITECT_REMINDER_TYPE)
    await pi.dispatch("input", input("ordinary"), ctx)
    expect(reminders()).toHaveLength(0)

    // when
    await submit(pi, ctx, async () => {
      expect(transforms(await pi.dispatch("input", input("external", "continue", {
        streamingBehavior: "steer",
      }), ctx))).toHaveLength(0)
      await pi.dispatch("input", input("nested-extension"), ctx)
    })

    // then
    expect(reminders()).toHaveLength(1)
    expect(reminders()[0].message.display).toBe(false)
    await externalInput(pi, ctx, input("next-external"))
    expect(reminders()).toHaveLength(2)
    await pi.dispatch("session_shutdown", { type: "session_shutdown" }, ctx)
  })

  test("memory counts accepted external turns once using host input IDs and dispositions", async () => {
    // given
    const { pi, ctx, sessionId } = fixture()
    const memory = createMemoryNudgeWiring({
      resolveContext: () => undefined,
      resolveSettings: () => ({ enabled: true, everyUserTurns: 2 }),
    })
    memory.register(pi)
    await pi.dispatch("session_start", { type: "session_start" }, ctx)
    await pi.dispatch("input", input("ordinary"), ctx)
    await disposition(pi, "ordinary", "started")
    for (const value of ["rejected", "handled"] as const) {
      await externalInput(pi, ctx, input(value))
      await disposition(pi, value, value)
    }
    expect(memory.provenance(sessionId)?.userTurns).toBe(0)
    expect(pi.entries).toEqual([])

    // when
    await externalInput(pi, ctx, input("accepted-queued", "continue", { streamingBehavior: "steer" }))
    expect(memory.provenance(sessionId)?.userTurns).toBe(0)
    await disposition(pi, "unknown-input-id", "started")
    expect(pi.entries).toEqual([])
    await disposition(pi, "accepted-queued", "queued")
    await disposition(pi, "accepted-queued", "started")
    await externalInput(pi, ctx, input("accepted-started"))
    await disposition(pi, "accepted-started", "started")

    // then
    expect(memory.provenance(sessionId)).toEqual({ sessionId, userTurns: 2 })
    expect(pi.entries).toEqual([1, 2].map((priorUserTurns) => ({
      customType: ACCEPTED_TURNS_ENTRY_TYPE,
      data: { version: 1, sessionId, priorUserTurns, sessionBaselineTurns: 0 },
    })))
    await pi.dispatch("session_shutdown", { type: "session_shutdown" }, ctx)
  })

  test("telemetry classifies external prompts as RPC and excludes extensions from ordinals", async () => {
    // given
    const { pi, ctx } = fixture()
    const captures: EventTelemetryProperties[] = []
    await createOmoNativePromptComponent({
      client: { captureEvent: (_name, properties) => { captures.push(properties) } },
      hashSessionId: () => "fixture-session-hash",
    }).register(pi, componentContext)
    await pi.dispatch("session_start", { type: "session_start" }, ctx)

    // when
    await submit(pi, ctx, async () => {
      await pi.dispatch("input", input("first", "ulw ship it"), ctx)
      await pi.dispatch("input", input("nested", "ulw internal"), ctx)
    })
    expect(captures).toEqual([])
    await disposition(pi, "first", "started")
    await disposition(pi, "nested", "started")
    await pi.dispatch("input", input("ordinary", "ulw internal"), ctx)
    await disposition(pi, "ordinary", "started")
    await externalInput(pi, ctx, input("second", "continue", { streamingBehavior: "followUp" }))
    await disposition(pi, "second", "queued")
    await disposition(pi, "second", "started")
    await externalInput(pi, ctx, input("third"))
    await disposition(pi, "third", "started")
    await pi.dispatch("input", input("native", "continue", { source: "interactive" }), ctx)
    await disposition(pi, "native", "started")

    // then
    expect(captures.map((properties) => [
      properties.input_source, properties.is_real_user_prompt, properties.real_prompt_ordinal_bucket,
    ])).toEqual([
      ["rpc", true, "1"], ["extension", false, "1"], ["extension", false, "1"],
      ["rpc", true, "2_3"], ["rpc", true, "2_3"], ["interactive", true, "4_10"],
    ])
    expect(captures[0]).toMatchObject({
      is_effective_ultrawork_invocation: true, invocation_stage: "first_arm", keyword_variant: "ulw",
    })
    expect(captures[1].suppression_reason).toBe("extension_source")
    expect(captures[3]).toMatchObject({ queue_mode: "follow_up", is_turn_start: false })
    await pi.dispatch("session_shutdown", { type: "session_shutdown" }, ctx)
    expect(captures).toHaveLength(6)
  })
})
