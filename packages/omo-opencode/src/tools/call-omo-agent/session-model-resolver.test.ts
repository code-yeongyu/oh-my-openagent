import { afterEach, describe, expect, mock, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { clearSessionModel, setSessionModel } from "../../shared/session-model-state"
import { resolveContinuationModel } from "./session-model-resolver"

const creationModel = { providerID: "budget", modelID: "cheap", variant: "low" }
const sessionID = "resume-model-resolution"

function clientWithMessages(messages: unknown[]) {
  return { session: { messages: mock(async () => ({ data: messages })) } } as unknown as PluginInput["client"]
}

describe("call_omo_agent continuation model resolution", () => {
  afterEach(() => clearSessionModel(sessionID))

  test("uses latest assistant effective model after fallback, skipping later compaction messages", async () => {
    const client = clientWithMessages([
      { info: { role: "user", time: { created: 1 }, model: { providerID: "budget", modelID: "cheap" }, variant: "low" } },
      { info: { role: "assistant", time: { created: 2 }, providerID: "recovery", modelID: "fallback" } },
      { info: { role: "assistant", agent: "compaction", time: { created: 3 }, providerID: "premium", modelID: "expensive" } },
    ])
    expect(await resolveContinuationModel(client, sessionID, creationModel)).toEqual({ providerID: "recovery", modelID: "fallback" })
  })

  test("restores a matching user variant when assistant message only has provider/model IDs", async () => {
    const client = clientWithMessages([
      { info: { role: "user", time: { created: 1 }, model: { providerID: "budget", modelID: "cheap" }, variant: "medium" } },
      { info: { role: "assistant", time: { created: 2 }, providerID: "budget", modelID: "cheap" } },
    ])
    expect(await resolveContinuationModel(client, sessionID, creationModel)).toEqual({ providerID: "budget", modelID: "cheap", variant: "medium" })
  })

  test("restores creation variant when the latest effective model matches and history has no variant", async () => {
    const client = clientWithMessages([{ info: { role: "assistant", providerID: "budget", modelID: "cheap" } }])
    expect(await resolveContinuationModel(client, sessionID, creationModel)).toEqual(creationModel)
  })

  test("uses newest valid model by creation time even when messages arrive out of order", async () => {
    const client = clientWithMessages([
      { info: { role: "assistant", time: { created: 4 }, providerID: "budget", modelID: "cheap" } },
      { info: { role: "user", time: { created: 1 }, model: { providerID: "premium", modelID: "expensive" } } },
    ])
    expect(await resolveContinuationModel(client, sessionID, creationModel)).toEqual(creationModel)
  })

  test("uses creation snapshot when message history is empty or unsupported", async () => {
    expect(await resolveContinuationModel(clientWithMessages([]), sessionID, creationModel)).toEqual(creationModel)
    expect(await resolveContinuationModel({ session: {} } as PluginInput["client"], sessionID, creationModel)).toEqual(creationModel)
  })

  test("uses current cached effective model when message API fails", async () => {
    setSessionModel(sessionID, { providerID: "recovery", modelID: "fallback" })
    const client = { session: { messages: mock(async () => { throw new Error("Unavailable") }) } } as unknown as PluginInput["client"]
    expect(await resolveContinuationModel(client, sessionID, creationModel)).toEqual({ providerID: "recovery", modelID: "fallback" })
  })
})
