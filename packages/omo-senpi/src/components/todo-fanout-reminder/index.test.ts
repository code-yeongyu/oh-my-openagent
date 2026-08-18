/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext, ComponentLogger } from "../../extension/types"
import { createSessionArming, type SessionArming } from "../ultrawork/index"
import { createTodoFanoutReminderComponent } from "./index"

const DISABLED_FLAG = "omo-senpi-todo-fanout-reminder-disabled"

function createTestContext(pi: FakeExtensionAPI): ComponentContext {
  const logger: ComponentLogger = {
    info() {},
    warn() {},
    error() {},
  }
  return {
    logger,
    config: {
      getFlag(name) {
        return pi.getFlag(name)
      },
    },
  }
}

function sessionEventCtx(sessionId: string): { sessionManager: { getSessionId(): string } } {
  return { sessionManager: { getSessionId: () => sessionId } }
}

function todoResultPayload(op: string, isError = false): Record<string, unknown> {
  return {
    type: "tool_result",
    toolCallId: `tc-${op}`,
    toolName: "todo",
    input: { op },
    content: [{ type: "text", text: `todo ${op} ok` }],
    isError,
    details: {},
  }
}

interface ToolResultTransform {
  content: ReadonlyArray<{ type: string; text?: string }>
}

async function dispatchTodoResult(
  pi: FakeExtensionAPI,
  payload: Record<string, unknown>,
  eventCtx?: unknown,
): Promise<ToolResultTransform | undefined> {
  const [result] = await pi.dispatch("tool_result", payload, eventCtx)
  return result as ToolResultTransform | undefined
}

function reminderTextOf(transform: ToolResultTransform): string {
  const last = transform.content[transform.content.length - 1]
  return typeof last?.text === "string" ? last.text : ""
}

async function registerComponent(
  pi: FakeExtensionAPI,
  arming: SessionArming,
): Promise<void> {
  await createTodoFanoutReminderComponent(arming).register(pi, createTestContext(pi))
}

describe("omo-senpi todo-fanout-reminder component", () => {
  it("#given an ultrawork-armed session #when the first todo init result arrives #then exactly one system-reminder is appended with the fan-out decision and todo-freshness directives", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const arming = createSessionArming()
    arming.markArmed("session-1")
    await registerComponent(pi, arming)

    // when
    const transform = await dispatchTodoResult(pi, todoResultPayload("init"), sessionEventCtx("session-1"))

    // then
    expect(transform).toBeDefined()
    expect(transform?.content[0]).toMatchObject({ type: "text", text: "todo init ok" })
    expect(transform?.content).toHaveLength(2)
    const reminder = reminderTextOf(transform as ToolResultTransform)
    expect(reminder).toContain("<system-reminder>")
    expect(reminder).toContain("</system-reminder>")
    expect(reminder).toContain("ultrawork")
    expect(reminder).toContain("fan-out")
    expect(reminder).toContain("categor")
    expect(reminder).toContain("todo")
    expect(reminder).toContain("fresh")
  })

  it("#given an armed session already reminded #when more todo results arrive #then no duplicate reminder is appended", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const arming = createSessionArming()
    arming.markArmed("session-1")
    await registerComponent(pi, arming)
    await dispatchTodoResult(pi, todoResultPayload("init"), sessionEventCtx("session-1"))

    // when
    const second = await dispatchTodoResult(pi, todoResultPayload("append"), sessionEventCtx("session-1"))
    const third = await dispatchTodoResult(pi, todoResultPayload("done"), sessionEventCtx("session-1"))

    // then
    expect(second).toBeUndefined()
    expect(third).toBeUndefined()
  })

  it("#given a session without ultrawork armed #when the first todo init result arrives #then no reminder is appended", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const arming = createSessionArming()
    await registerComponent(pi, arming)

    // when
    const transform = await dispatchTodoResult(pi, todoResultPayload("init"), sessionEventCtx("session-1"))

    // then
    expect(transform).toBeUndefined()
  })

  it("#given an armed session #when the todo result is an error #then no reminder is appended", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const arming = createSessionArming()
    arming.markArmed("session-1")
    await registerComponent(pi, arming)

    // when
    const transform = await dispatchTodoResult(pi, todoResultPayload("init", true), sessionEventCtx("session-1"))

    // then
    expect(transform).toBeUndefined()
  })

  it("#given an armed session #when a non-todo tool result arrives #then no reminder is appended", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const arming = createSessionArming()
    arming.markArmed("session-1")
    await registerComponent(pi, arming)
    const payload = { ...todoResultPayload("init"), toolName: "edit" }

    // when
    const transform = await dispatchTodoResult(pi, payload, sessionEventCtx("session-1"))

    // then
    expect(transform).toBeUndefined()
  })

  it("#given an armed session whose first todo op only views #when a task-adding op follows #then the reminder fires on the adding op", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const arming = createSessionArming()
    arming.markArmed("session-1")
    await registerComponent(pi, arming)

    // when
    const view = await dispatchTodoResult(pi, todoResultPayload("view"), sessionEventCtx("session-1"))
    const init = await dispatchTodoResult(pi, todoResultPayload("init"), sessionEventCtx("session-1"))

    // then
    expect(view).toBeUndefined()
    expect(init).toBeDefined()
  })

  it("#given a reminded session #when an accepted compaction arrives #then the gate resets and a later task-adding op reminds again", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const arming = createSessionArming()
    arming.markArmed("session-1")
    await registerComponent(pi, arming)
    await dispatchTodoResult(pi, todoResultPayload("init"), sessionEventCtx("session-1"))

    // when
    await pi.dispatch("session_compact", { accepted: true }, sessionEventCtx("session-1"))
    const afterCompact = await dispatchTodoResult(pi, todoResultPayload("append"), sessionEventCtx("session-1"))

    // then
    expect(afterCompact).toBeDefined()
  })

  it("#given a reminded session #when the session shuts down #then the gate is cleared", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const arming = createSessionArming()
    arming.markArmed("session-1")
    await registerComponent(pi, arming)
    await dispatchTodoResult(pi, todoResultPayload("init"), sessionEventCtx("session-1"))

    // when
    await pi.dispatch("session_shutdown", {}, sessionEventCtx("session-1"))
    const afterShutdown = await dispatchTodoResult(pi, todoResultPayload("append"), sessionEventCtx("session-1"))

    // then
    expect(afterShutdown).toBeDefined()
  })

  it("#given a host exposing no session id #when todo results arrive #then the reminder fires once on the anonymous slot", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const arming = createSessionArming()
    arming.markArmed(undefined)
    await registerComponent(pi, arming)

    // when
    const first = await dispatchTodoResult(pi, todoResultPayload("init"))
    const second = await dispatchTodoResult(pi, todoResultPayload("append"))

    // then
    expect(first).toBeDefined()
    expect(second).toBeUndefined()
  })

  it("#given the component disabled flag #when an armed session adds todos #then no reminder is appended", async () => {
    // given
    const pi = new FakeExtensionAPI()
    pi.registerFlag(DISABLED_FLAG, { type: "boolean", default: false })
    pi.setFlag(DISABLED_FLAG, true)
    const arming = createSessionArming()
    arming.markArmed("session-1")
    await registerComponent(pi, arming)

    // when
    const transform = await dispatchTodoResult(pi, todoResultPayload("init"), sessionEventCtx("session-1"))

    // then
    expect(transform).toBeUndefined()
  })
})
