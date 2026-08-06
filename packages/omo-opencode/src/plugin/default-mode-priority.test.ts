import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { OhMyOpenCodeConfig } from "../config"
import type { DefaultModeConfig } from "../config/schema/default-mode"
import { _resetForTesting, setMainSession } from "../features/claude-code-session-state"
import { createKeywordDetectorHook } from "../hooks/keyword-detector"
import { unsafeTestValue } from "../../../../test-support/unsafe-test-value"
import { createChatMessageHandler, type ChatMessageHandlerOutput } from "./chat-message"
import type { ChatMessageHooks } from "./chat-message/types"
import { createSystemTransformHandler } from "./system-transform"
import type { PluginContext } from "./types"

const ULTRAWORK_INSTRUCTION_MARKER = "<ultrawork-mode>matrix ultrawork instructions"
const FIRST_TURN_PROMPT = "ship the default-mode priority behavior"
const DEFAULT_ULTRAWORK_TOAST = "Default ultrawork mode enabled. All agents at your disposal."

type ToastCall = {
  readonly body: {
    readonly title: string
    readonly message: string
    readonly variant: string
    readonly duration: number
  }
}

type GoalCall = {
  readonly sessionID: string
  readonly objective: string
}

type MatrixCase = {
  readonly name: string
  readonly ultrawork: boolean
  readonly goal: boolean
  readonly expectUltraworkSystem: boolean
  readonly expectToast: boolean
  readonly expectGoal: boolean
}

const DEFAULT_MODE_CASES = [
  {
    name: "neither default mode enabled",
    ultrawork: false,
    goal: false,
    expectUltraworkSystem: false,
    expectToast: false,
    expectGoal: false,
  },
  {
    name: "ultrawork default mode only",
    ultrawork: true,
    goal: false,
    expectUltraworkSystem: true,
    expectToast: true,
    expectGoal: false,
  },
  {
    name: "goal default mode only",
    ultrawork: false,
    goal: true,
    expectUltraworkSystem: false,
    expectToast: false,
    expectGoal: true,
  },
  {
    name: "ultrawork and goal default modes together",
    ultrawork: true,
    goal: true,
    expectUltraworkSystem: true,
    expectToast: true,
    expectGoal: true,
  },
] satisfies readonly MatrixCase[]

function createDefaultMode(testCase: MatrixCase): DefaultModeConfig {
  return {
    ultrawork: testCase.ultrawork,
    goal: testCase.goal,
  }
}

function createPluginContext(toasts: ToastCall[]): PluginContext {
  return unsafeTestValue<PluginContext>({
    client: {
      tui: {
        showToast: async (toast: ToastCall): Promise<void> => {
          toasts.push(toast)
        },
      },
    },
  })
}

function createPluginConfig(defaultMode: DefaultModeConfig): OhMyOpenCodeConfig {
  return unsafeTestValue<OhMyOpenCodeConfig>({
    default_mode: defaultMode,
  })
}

function createFirstMessageVariantGate() {
  let isFirstMessage = true
  return {
    shouldOverride: (_sessionID: string): boolean => isFirstMessage,
    markApplied: (_sessionID: string): void => {
      isFirstMessage = false
    },
  }
}

function createHooks(goalEnabled: boolean, goalCalls: GoalCall[]): ChatMessageHooks {
  return unsafeTestValue<ChatMessageHooks>({
    goal: goalEnabled
      ? {
          setGoal: (sessionID: string, objective: string) => {
            goalCalls.push({ sessionID, objective })
            return { objective, status: "active" }
          },
          getGoal: () => null,
          pauseGoal: () => null,
          resumeGoal: () => null,
          clearGoal: () => true,
          markComplete: () => null,
        }
      : null,
  })
}

async function renderSystemPrompt(defaultMode: DefaultModeConfig): Promise<string> {
  const handler = createSystemTransformHandler(
    defaultMode,
    () => ULTRAWORK_INSTRUCTION_MARKER,
  )
  const output = { system: ["base system prompt"] }

  await handler(
    {
      sessionID: "system-transform-session",
      model: { id: "gpt-5.5", providerID: "openai" },
    },
    output,
  )

  return output.system.join("\n")
}

async function collectDefaultModeToasts(
  defaultMode: DefaultModeConfig,
  sessionID: string,
): Promise<readonly ToastCall[]> {
  const toasts: ToastCall[] = []
  const hook = createKeywordDetectorHook(
    createPluginContext(toasts),
    undefined,
    undefined,
    undefined,
    defaultMode,
  )

  await hook["chat.message"](
    { sessionID, agent: "sisyphus" },
    {
      message: {},
      parts: [{ type: "text", text: FIRST_TURN_PROMPT }],
    },
  )

  return toasts
}

async function collectGoalCreations(
  defaultMode: DefaultModeConfig,
  sessionID: string,
): Promise<readonly GoalCall[]> {
  const goalCalls: GoalCall[] = []
  const handler = createChatMessageHandler({
    ctx: createPluginContext([]),
    pluginConfig: createPluginConfig(defaultMode),
    firstMessageVariantGate: createFirstMessageVariantGate(),
    hooks: createHooks(defaultMode.goal ?? false, goalCalls),
  })
  const output: ChatMessageHandlerOutput = {
    message: {},
    parts: [{ type: "text", text: FIRST_TURN_PROMPT }],
  }

  await handler(
    {
      sessionID,
      agent: "sisyphus",
      model: { providerID: "openai", modelID: "gpt-5.5" },
    },
    output,
  )

  return goalCalls
}

describe("default-mode priority matrix", () => {
  beforeEach(() => {
    _resetForTesting()
  })

  afterEach(() => {
    _resetForTesting()
  })

  for (const testCase of DEFAULT_MODE_CASES) {
    test(`#given ${testCase.name} #when first user turn runs #then prompt toast and loop state match config`, async () => {
      // given
      const defaultMode = createDefaultMode(testCase)
      const sessionID = `default-mode-${testCase.ultrawork}-${testCase.goal}`
      setMainSession(sessionID)

      // when
      const systemPrompt = await renderSystemPrompt(defaultMode)
      const toasts = await collectDefaultModeToasts(defaultMode, sessionID)
      const goalCalls = await collectGoalCreations(defaultMode, sessionID)

      // then
      expect(systemPrompt.includes(ULTRAWORK_INSTRUCTION_MARKER)).toBe(
        testCase.expectUltraworkSystem,
      )
      expect(toasts.map((toast) => toast.body.message)).toEqual(
        testCase.expectToast ? [DEFAULT_ULTRAWORK_TOAST] : [],
      )
      expect(goalCalls.length > 0).toBe(testCase.expectGoal)
      if (testCase.expectGoal) {
        expect(goalCalls).toHaveLength(1)
        expect(goalCalls[0]?.sessionID).toBe(sessionID)
        expect(goalCalls[0]?.objective).toBe(FIRST_TURN_PROMPT)
      }
    })
  }
})
