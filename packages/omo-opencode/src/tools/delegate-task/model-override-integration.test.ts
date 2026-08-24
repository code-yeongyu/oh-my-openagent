import { describe, expect, test } from "bun:test"
import { createDelegateTask } from "./tools"

type CapturedBody = { model?: { providerID?: string; modelID?: string }; variant?: string }

const AVAILABLE = new Set(["openai/gpt-5.5", "anthropic/claude-opus-4-7"])

type CapturedLaunch = { agent?: string; model?: { providerID?: string; modelID?: string; variant?: string } }

function makeHarness(availableModelsOverride?: Set<string>) {
  let promptBody: CapturedBody = {}
  let promptCalled = false
  let launchInput: CapturedLaunch | undefined
  const promptMock = async (input: { body: CapturedBody }) => {
    promptCalled = true
    promptBody = input.body
    return { data: {} }
  }
  const client = {
    app: {
      agents: async () => ({
        data: [
          { name: "librarian", mode: "subagent" },
          { name: "explore", mode: "subagent" },
          { name: "sisyphus-junior", mode: "subagent" },
        ],
      }),
    },
    config: { get: async () => ({ data: { model: "anthropic/claude-opus-4-7" } }) },
    model: { list: async () => [] },
    session: {
      get: async () => ({ data: { directory: "/project" } }),
      create: async () => ({ data: { id: "ses_test" } }),
      prompt: promptMock,
      promptAsync: promptMock,
      messages: async () => ({
        data: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "done" }] }],
      }),
      status: async () => ({ data: { ses_test: { type: "idle" } } }),
    },
  }
  const mockManager = {
    launch: async (input: CapturedLaunch) => {
      launchInput = input
      return { id: "bg_test", description: "x", agent: input.agent ?? "", status: "pending" }
    },
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tool = createDelegateTask({ manager: mockManager, client, availableModelsOverride } as any)
  const toolContext = {
    sessionID: "parent",
    messageID: "msg",
    agent: "sisyphus",
    abort: new AbortController().signal,
  }
  // Effective model = sync prompt body (category/sisyphus-junior path) OR background launch (research subagents are forced background).
  const effectiveModel = (): { providerID?: string; modelID?: string } | undefined =>
    promptBody.model ?? (launchInput?.model ? { providerID: launchInput.model.providerID, modelID: launchInput.model.modelID } : undefined)
  const effectiveVariant = (): string | undefined => promptBody.variant ?? launchInput?.model?.variant
  return {
    tool,
    toolContext,
    getBody: () => promptBody,
    wasPromptCalled: () => promptCalled,
    getLaunch: () => launchInput,
    effectiveModel,
    effectiveVariant,
  }
}

describe("delegate-task orchestrator model override (tool boundary)", () => {
  test("S1 #given subagent_type + model #then the spawned session runs on the chosen model", async () => {
    // given
    const h = makeHarness(AVAILABLE)
    // when
    await h.tool.execute(
      { description: "x", prompt: "p", subagent_type: "librarian", run_in_background: false, load_skills: [], model: "openai/gpt-5.5" },
      h.toolContext,
    )
    // then (librarian is forced background -> assert via launch input)
    expect(h.effectiveModel()).toEqual({ providerID: "openai", modelID: "gpt-5.5" })
  }, { timeout: 20000 })

  test("S2 #given reasoning_effort #then it is applied as the session variant", async () => {
    // given
    const h = makeHarness(AVAILABLE)
    // when
    await h.tool.execute(
      { description: "x", prompt: "p", subagent_type: "librarian", run_in_background: false, load_skills: [], model: "openai/gpt-5.5", reasoning_effort: "xhigh" },
      h.toolContext,
    )
    // then
    expect(h.effectiveModel()).toEqual({ providerID: "openai", modelID: "gpt-5.5" })
    expect(h.effectiveVariant()).toBe("xhigh")
  }, { timeout: 20000 })

  test("S3 #given an unavailable model #then the call is rejected and NOTHING is spawned (gate)", async () => {
    // given
    const h = makeHarness(AVAILABLE)
    // when
    const result = await h.tool.execute(
      { description: "x", prompt: "p", subagent_type: "librarian", run_in_background: false, load_skills: [], model: "openai/ghost-999" },
      h.toolContext,
    )
    // then
    expect(String(result)).toContain("not available")
    expect(h.wasPromptCalled()).toBe(false)
    expect(h.getLaunch()).toBeUndefined()
  }, { timeout: 20000 })

  test("S5 #given category + model variant string #then the junior runs the chosen model + variant", async () => {
    // given
    const h = makeHarness(AVAILABLE)
    // when
    await h.tool.execute(
      { description: "x", prompt: "p", category: "quick", run_in_background: false, load_skills: [], model: "openai/gpt-5.5 xhigh" },
      h.toolContext,
    )
    // then
    expect(h.effectiveModel()).toEqual({ providerID: "openai", modelID: "gpt-5.5" })
    expect(h.effectiveVariant()).toBe("xhigh")
  }, { timeout: 20000 })

  test("S4 #given no model arg #then the override is skipped and the chosen model is NOT forced", async () => {
    // given - regression: omitting model must leave the configured/default path untouched
    const h = makeHarness(AVAILABLE)
    // when
    await h.tool.execute(
      { description: "x", prompt: "p", subagent_type: "librarian", run_in_background: false, load_skills: [] },
      h.toolContext,
    )
    // then - librarian default chain is gpt-5.4-mini family, never the override target
    expect(h.effectiveModel()?.modelID).not.toBe("gpt-5.5")
  }, { timeout: 20000 })
})
