import { describe, expect, test } from "bun:test"
import { buildSyncPromptTools } from "../../tools/delegate-task/sync-prompt-sender"
import { buildFallbackBody } from "./spawner/fallback-agent"
import { buildTaskPromptBody } from "./spawner/task-prompt-body"

const anthropic = { providerID: " Anthropic ", modelID: "claude-sonnet-4-6" }
const openai = { providerID: "openai", modelID: "gpt-5.4" }

describe("delegated agent tool policy routes", () => {
  test("applies inherited Anthropic policy to background launch and resume", () => {
    for (const kind of ["launch", "resume"] as const) {
      const body = buildTaskPromptBody(kind === "launch"
        ? {
            kind,
            agent: "general",
            model: undefined,
            inheritedModel: anthropic,
            system: undefined,
            prompt: "work",
            includeTeamToolDenylist: false,
          }
        : {
            kind,
            agent: "general",
            model: undefined,
            inheritedModel: anthropic,
            prompt: "continue",
            includeTeamToolDenylist: false,
          })

      expect(body.tools.call_omo_agent).toBe(false)
    }
  })

  test("keeps explicit non-Anthropic background model enabled", () => {
    const body = buildTaskPromptBody({
      kind: "launch",
      agent: "general",
      model: openai,
      inheritedModel: anthropic,
      system: undefined,
      prompt: "work",
      includeTeamToolDenylist: false,
    })

    expect(body.tools.call_omo_agent).toBe(true)
  })

  test("applies the same policy to sync prompts and fallback bodies", () => {
    const syncTools = buildSyncPromptTools("general", undefined, undefined, anthropic)
    const fallbackBody = buildFallbackBody({
      agent: "general",
      tools: syncTools,
      parts: [{ type: "text", text: "work" }],
    }, "general")

    expect(syncTools.call_omo_agent).toBe(false)
    expect(fallbackBody.tools.call_omo_agent).toBe(false)
  })
})
