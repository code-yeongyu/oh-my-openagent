import { describe, expect, test } from "bun:test"

import type { DelegateFallbackEntry } from "@oh-my-opencode/delegate-core"
import { OmoTaskSettingsSchema, type OmoConfig } from "@oh-my-opencode/omo-config-core"
import type { ChildPlanner, PlanResolution, PlanResolutionError } from "@oh-my-opencode/senpi-task"

import type { SenpiExtensionAPI } from "../../extension/types"
import {
  CATEGORY_UNAVAILABLE_MESSAGE_TYPE,
  createCategoryUnavailableWarningPlanner,
} from "./category-unavailable-warning"
import { createTaskChildPlanner } from "./planner"
import { TaskRuntimeContext } from "./runtime-context"

type SentMessage = {
  readonly message: Record<string, unknown>
  readonly options: Record<string, unknown>
}

type CapturedNotify = {
  readonly message: string
  readonly type?: string
}

const QUICK_CHAIN: readonly DelegateFallbackEntry[] = [
  { providers: ["kimi-coding", "kimi-for-coding"], model: "kimi-for-coding-highspeed" },
  { providers: ["openai"], model: "gpt-5.4-mini", variant: "minimal" },
]

function deadChainError(category: string): PlanResolutionError {
  return {
    code: "model_unavailable",
    message: `No available model for category "${category}".`,
    category,
    attempted_chain: QUICK_CHAIN,
    missing_providers: ["kimi-coding", "kimi-for-coding"],
    availableCategories: ["deep", "writing"],
  }
}

function plainUnavailableError(category: string): PlanResolutionError {
  return {
    code: "model_unavailable",
    message: `No available model for category "${category}".`,
    availableCategories: ["deep", "writing"],
  }
}

function setup(options: {
  readonly error: PlanResolutionError
  readonly omoConfig?: OmoConfig
  readonly settings?: ReturnType<typeof OmoTaskSettingsSchema.parse>
  readonly sessionId?: string
  readonly withUi?: boolean
}) {
  const messages: SentMessage[] = []
  const notifies: CapturedNotify[] = []
  const pi = {
    sendMessage: (message: Record<string, unknown>, options: Record<string, unknown>) => {
      messages.push({ message, options })
    },
  } as unknown as SenpiExtensionAPI
  const runtime = new TaskRuntimeContext("/tmp/category-unavailable-warning-test")
  const ui = {
    notify: (message: string, type?: string) => { notifies.push({ message, type }) },
  }
  runtime.captureFrom({
    sessionManager: { getSessionId: () => options.sessionId ?? "session-1" },
    ...(options.withUi === false
      ? {}
      : { ui: ui as unknown as Parameters<TaskRuntimeContext["captureFrom"]>[0]["ui"] }),
  })
  const inner: ChildPlanner = () => ({ kind: "error", error: options.error })
  const planner = createCategoryUnavailableWarningPlanner({
    planner: inner,
    pi,
    runtime,
    omoConfig: options.omoConfig ?? {},
    settings: options.settings ?? OmoTaskSettingsSchema.parse({}),
  })
  return { planner, messages, notifies, runtime }
}

function plan(planner: ChildPlanner, category: string): PlanResolution {
  return planner({ prompt: "p", parent_session_id: "parent-1", depth: 0, category })
}

const EXPECTED_TEXT =
  'Category "quick" has no usable model: none of its fallback-chain providers are connected (kimi-coding, kimi-for-coding).'

describe("createCategoryUnavailableWarningPlanner", () => {
  test("#given a dead-chain model_unavailable #when planned #then it notifies and sends the custom message", () => {
    // given
    const { planner, messages, notifies } = setup({ error: deadChainError("quick") })

    // when
    plan(planner, "quick")

    // then
    expect(notifies).toEqual([{ message: EXPECTED_TEXT, type: "warning" }])
    expect(messages).toHaveLength(1)
    expect(messages[0]?.message).toEqual({
      customType: CATEGORY_UNAVAILABLE_MESSAGE_TYPE,
      content: EXPECTED_TEXT,
      display: true,
      details: {
        category: "quick",
        reason: "no_chain_rung_available",
        attempted_chain: QUICK_CHAIN,
        missing_providers: ["kimi-coding", "kimi-for-coding"],
        available_categories: ["deep", "writing"],
      },
    })
    expect(messages[0]?.options).toEqual({})
  })

  test("#given repeated dead-chain failures #when planned #then it warns exactly once per session per category", () => {
    // given
    const { planner, messages, notifies, runtime } = setup({ error: deadChainError("quick") })

    // when
    plan(planner, "quick")
    plan(planner, "quick")
    runtime.captureFrom({ sessionManager: { getSessionId: () => "session-2" } })
    plan(planner, "quick")

    // then
    expect(notifies).toHaveLength(2)
    expect(messages).toHaveLength(2)
  })

  test("#given a non-dead-chain model_unavailable #when planned #then it stays silent", () => {
    // given
    const { planner, messages, notifies } = setup({ error: plainUnavailableError("quick") })

    // when
    plan(planner, "quick")

    // then
    expect(notifies).toHaveLength(0)
    expect(messages).toHaveLength(0)
  })

  test("#given global suppression #when planned #then it stays silent", () => {
    // given
    const { planner, messages, notifies } = setup({
      error: deadChainError("quick"),
      settings: OmoTaskSettingsSchema.parse({ warnings: { unavailable_categories: false } }),
    })

    // when
    plan(planner, "quick")

    // then
    expect(notifies).toHaveLength(0)
    expect(messages).toHaveLength(0)
  })

  test("#given a per-category opt-in over global suppression #when planned #then it warns", () => {
    // given
    const { planner, messages, notifies } = setup({
      error: deadChainError("quick"),
      omoConfig: { categories: { quick: { warn_unavailable: true } } },
      settings: OmoTaskSettingsSchema.parse({ warnings: { unavailable_categories: false } }),
    })

    // when
    plan(planner, "quick")

    // then
    expect(notifies).toHaveLength(1)
    expect(messages).toHaveLength(1)
  })

  test("#given a per-category opt-out over global default #when planned #then it stays silent", () => {
    // given
    const { planner, messages, notifies } = setup({
      error: deadChainError("quick"),
      omoConfig: { categories: { quick: { warn_unavailable: false } } },
    })

    // when
    plan(planner, "quick")

    // then
    expect(notifies).toHaveLength(0)
    expect(messages).toHaveLength(0)
  })

  test("#given a user-configured category with an explicit model #when a chain error arrives #then it stays silent", () => {
    // given
    const { planner, messages, notifies } = setup({
      error: deadChainError("quick"),
      omoConfig: { categories: { quick: { model: "omo-mock/mock-parent", warn_unavailable: true } } },
    })

    // when
    plan(planner, "quick")

    // then
    expect(notifies).toHaveLength(0)
    expect(messages).toHaveLength(0)
  })

  test("#given no captured ui #when planned #then the custom message still fires", () => {
    // given
    const { planner, messages, notifies } = setup({ error: deadChainError("quick"), withUi: false })

    // when
    plan(planner, "quick")

    // then
    expect(notifies).toHaveLength(0)
    expect(messages).toHaveLength(1)
  })

  test("#given the real child planner and a stripped registry #when a dead-chain category is planned #then the error carries chain details", () => {
    // given
    const stripped = {
      getAvailable: () => [{ provider: "omo-mock", id: "mock-parent" }],
      find: () => undefined,
    }
    const planner = createTaskChildPlanner({}, {}, () => stripped)

    // when
    const result = plan(planner, "quick")

    // then
    expect(result.kind).toBe("error")
    if (result.kind !== "error") throw new Error("Expected error plan")
    expect(result.error.code).toBe("model_unavailable")
    expect(result.error.category).toBe("quick")
    expect(result.error.attempted_chain).toBeDefined()
    expect(result.error.missing_providers).toContain("openai")
  })
})
