import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { OhMyOpenCodeConfig } from "../config"
import type { DefaultModeConfig } from "../config/schema/default-mode"
import type { CreatedHooks } from "../create-hooks"
import { _resetForTesting, setMainSession } from "../features/claude-code-session-state"
import { createKeywordDetectorHook } from "../hooks/keyword-detector"
import { unsafeTestValue } from "../../test-support/unsafe-test-value"
import { createChatMessageHandler, type ChatMessageHandlerOutput } from "./chat-message"
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

type RalphLoopCall = {
  readonly sessionID: string
  readonly prompt: string
  readonly options: Record<string, unknown>
}

type MatrixCase = {
  readonly name: string
  readonly ultrawork: boolean
  readonly ralphLoop: boolean
  readonly expectUltraworkSystem: boolean
  readonly expectToast: boolean
  readonly expectRalphLoop: boolean
}

const DEFAULT_MODE_CASES = [
  {
    name: "neither default mode enabled",
    ultrawork: false,
    ralphLoop: false,
    expectUltraworkSystem: false,
    expectToast: false,
    expectRalphLoop: false,
  },
  {
    name: "ultrawork default mode only",
    ultrawork: true,
    ralphLoop: false,
    expectUltraworkSystem: true,
    expectToast: true,
    expectRalphLoop: false,
  },
  {
    name: "ralph loop default mode only",
    ultrawork: false,
    ralphLoop: true,
    expectUltraworkSystem: false,
    expectToast: false,
    expectRalphLoop: true,
  },
  {
    name: "ultrawork and ralph loop default modes together",
    ultrawork: true,
    ralphLoop: true,
    expectUltraworkSystem: true,
    expectToast: true,
    expectRalphLoop: true,
  },
] satisfies readonly MatrixCase[]

function createDefaultMode(testCase: MatrixCase): DefaultModeConfig {
  return {
    ultrawork: testCase.ultrawork,
    ralph_loop: testCase.ralphLoop,
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
    shouldOverride: (): boolean => isFirstMessage,
    markApplied: (): void => {
      isFirstMessage = false
    },
  }
}

function createHooks(startLoopCalls: RalphLoopCall[]): CreatedHooks {
  return unsafeTestValue<CreatedHooks>({
    ralphLoop: {
      startLoop: (sessionID: string, prompt: string, options?: Record<string, unknown>): boolean => {
        startLoopCalls.push({ sessionID, prompt, options: options ?? {} })
        return true
      },
      cancelLoop: (): boolean => true,
      getState: () => null,
      event: async (): Promise<void> => {},
    },
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

async function collectRalphLoopCalls(
  defaultMode: DefaultModeConfig,
  sessionID: string,
): Promise<readonly RalphLoopCall[]> {
  const startLoopCalls: RalphLoopCall[] = []
  const handler = createChatMessageHandler({
    ctx: createPluginContext([]),
    pluginConfig: createPluginConfig(defaultMode),
    firstMessageVariantGate: createFirstMessageVariantGate(),
    hooks: createHooks(startLoopCalls),
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

  return startLoopCalls
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
      const sessionID = `default-mode-${testCase.ultrawork}-${testCase.ralphLoop}`
      setMainSession(sessionID)

      // when
      const systemPrompt = await renderSystemPrompt(defaultMode)
      const toasts = await collectDefaultModeToasts(defaultMode, sessionID)
      const startLoopCalls = await collectRalphLoopCalls(defaultMode, sessionID)

      // then
      expect(systemPrompt.includes(ULTRAWORK_INSTRUCTION_MARKER)).toBe(
        testCase.expectUltraworkSystem,
      )
      expect(toasts.map((toast) => toast.body.message)).toEqual(
        testCase.expectToast ? [DEFAULT_ULTRAWORK_TOAST] : [],
      )
      expect(startLoopCalls.length > 0).toBe(testCase.expectRalphLoop)
      if (testCase.expectRalphLoop) {
        expect(startLoopCalls).toHaveLength(1)
        expect(startLoopCalls[0]?.sessionID).toBe(sessionID)
        expect(startLoopCalls[0]?.prompt).toBe(FIRST_TURN_PROMPT)
        expect(startLoopCalls[0]?.options["ultrawork"]).toBe(testCase.ultrawork)
      }
    })
  }
})
