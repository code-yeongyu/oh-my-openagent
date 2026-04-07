import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { createKeywordDetectorHook } from "./index"
import { _resetForTesting, setMainSession } from "../../features/claude-code-session-state"

type StartLoopCall = {
  sessionID: string
  prompt: string
  options: Record<string, unknown>
}

type CancelLoopCall = { sessionID: string }

function createMockPluginInput() {
  return {
    client: {
      tui: {
        showToast: async () => {},
      },
    },
  } as any
}

function createMockRalphLoop(startLoopCalls: StartLoopCall[], cancelLoopCalls: CancelLoopCall[] = []) {
  return {
    startLoop: (sessionID: string, prompt: string, options?: Record<string, unknown>): boolean => {
      startLoopCalls.push({ sessionID, prompt, options: options ?? {} })
      return true
    },
    cancelLoop: (sessionID: string): boolean => {
      cancelLoopCalls.push({ sessionID })
      return true
    },
    getState: () => null,
    event: async () => {},
  }
}

describe("keyword-detector ralph-loop activation", () => {
  beforeEach(() => {
    _resetForTesting()
  })

  afterEach(() => {
    _resetForTesting()
  })

  test("#given ulw keyword in main session #when chat.message fires #then ralph-loop startLoop is invoked with the user task", async () => {
    // given
    setMainSession("main-session")
    const startLoopCalls: StartLoopCall[] = []
    const ralphLoop = createMockRalphLoop(startLoopCalls)
    const hook = createKeywordDetectorHook(createMockPluginInput(), undefined, ralphLoop)
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "ulw build a multi-agent backend architecture" }],
    }

    // when
    await hook["chat.message"]({ sessionID: "main-session", agent: "sisyphus" }, output)

    // then
    expect(startLoopCalls).toHaveLength(1)
    expect(startLoopCalls[0].sessionID).toBe("main-session")
    expect(startLoopCalls[0].prompt).toContain("build a multi-agent backend architecture")
    expect(startLoopCalls[0].options.ultrawork).toBe(true)
  })

  test("#given ultrawork keyword in main session #when chat.message fires #then ralph-loop startLoop is invoked with ultrawork enabled", async () => {
    // given
    setMainSession("main-session")
    const startLoopCalls: StartLoopCall[] = []
    const ralphLoop = createMockRalphLoop(startLoopCalls)
    const hook = createKeywordDetectorHook(createMockPluginInput(), undefined, ralphLoop)
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "ultrawork ship the dashboard" }],
    }

    // when
    await hook["chat.message"]({ sessionID: "main-session", agent: "sisyphus" }, output)

    // then
    expect(startLoopCalls).toHaveLength(1)
    expect(startLoopCalls[0].sessionID).toBe("main-session")
    expect(startLoopCalls[0].prompt).toContain("ship the dashboard")
    expect(startLoopCalls[0].options.ultrawork).toBe(true)
  })

  test("#given non-ulw message #when chat.message fires #then ralph-loop startLoop is not invoked", async () => {
    // given
    setMainSession("main-session")
    const startLoopCalls: StartLoopCall[] = []
    const ralphLoop = createMockRalphLoop(startLoopCalls)
    const hook = createKeywordDetectorHook(createMockPluginInput(), undefined, ralphLoop)
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "just a normal message" }],
    }

    // when
    await hook["chat.message"]({ sessionID: "main-session", agent: "sisyphus" }, output)

    // then
    expect(startLoopCalls).toHaveLength(0)
  })

  test("#given ulw keyword with planner agent #when chat.message fires #then ralph-loop startLoop is not invoked", async () => {
    // given
    setMainSession("main-session")
    const startLoopCalls: StartLoopCall[] = []
    const ralphLoop = createMockRalphLoop(startLoopCalls)
    const hook = createKeywordDetectorHook(createMockPluginInput(), undefined, ralphLoop)
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "ulw plan this feature" }],
    }

    // when
    await hook["chat.message"]({ sessionID: "main-session", agent: "prometheus" }, output)

    // then
    expect(startLoopCalls).toHaveLength(0)
  })

  test("#given ulw keyword with non-OMO agent #when chat.message fires #then ralph-loop startLoop is not invoked", async () => {
    // given
    setMainSession("main-session")
    const startLoopCalls: StartLoopCall[] = []
    const ralphLoop = createMockRalphLoop(startLoopCalls)
    const hook = createKeywordDetectorHook(createMockPluginInput(), undefined, ralphLoop)
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "ulw build feature" }],
    }

    // when
    await hook["chat.message"]({ sessionID: "main-session", agent: "OpenCode-Builder" }, output)

    // then
    expect(startLoopCalls).toHaveLength(0)
  })

  test("#given ulw keyword without ralphLoop dependency #when chat.message fires #then no error is thrown and prompt is still injected", async () => {
    // given
    setMainSession("main-session")
    const hook = createKeywordDetectorHook(createMockPluginInput())
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "ulw do this" }],
    }

    // when
    await hook["chat.message"]({ sessionID: "main-session", agent: "sisyphus" }, output)

    // then
    const textPart = output.parts.find((p) => p.type === "text")
    expect(textPart!.text).toContain("YOU MUST LEVERAGE ALL AVAILABLE AGENTS")
    expect(textPart!.text).toContain("do this")
  })

  test("#given partial 'ulw' substring in StatefulWidget #when chat.message fires #then ralph-loop startLoop is not invoked", async () => {
    // given
    _resetForTesting()
    const startLoopCalls: StartLoopCall[] = []
    const ralphLoop = createMockRalphLoop(startLoopCalls)
    const hook = createKeywordDetectorHook(createMockPluginInput(), undefined, ralphLoop)
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "refactor the StatefulWidget component" }],
    }

    // when
    await hook["chat.message"]({ sessionID: "any-session", agent: "sisyphus" }, output)

    // then
    expect(startLoopCalls).toHaveLength(0)
  })

  test("#given ulw keyword inside system-reminder block #when chat.message fires #then ralph-loop startLoop is not invoked", async () => {
    // given
    setMainSession("main-session")
    const startLoopCalls: StartLoopCall[] = []
    const ralphLoop = createMockRalphLoop(startLoopCalls)
    const hook = createKeywordDetectorHook(createMockPluginInput(), undefined, ralphLoop)
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{
        type: "text",
        text: `<system-reminder>
The system mentions ulw mode in passing.
</system-reminder>`,
      }],
    }

    // when
    await hook["chat.message"]({ sessionID: "main-session", agent: "sisyphus" }, output)

    // then
    expect(startLoopCalls).toHaveLength(0)
  })

  test("#given ulw keyword #when chat.message fires #then prompt is also injected as before", async () => {
    // given
    setMainSession("main-session")
    const startLoopCalls: StartLoopCall[] = []
    const ralphLoop = createMockRalphLoop(startLoopCalls)
    const hook = createKeywordDetectorHook(createMockPluginInput(), undefined, ralphLoop)
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "ulw refactor the codebase" }],
    }

    // when
    await hook["chat.message"]({ sessionID: "main-session", agent: "sisyphus" }, output)

    // then
    const textPart = output.parts.find((p) => p.type === "text")
    expect(textPart!.text).toContain("YOU MUST LEVERAGE ALL AVAILABLE AGENTS")
    expect(textPart!.text).toContain("refactor the codebase")
    expect(startLoopCalls).toHaveLength(1)
  })
})
