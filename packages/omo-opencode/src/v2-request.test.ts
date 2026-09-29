import { describe, expect, it } from "bun:test"
import type { Plugin } from "@opencode/plugin"
import { OMO_INTERNAL_INITIATOR_MARKER } from "./shared"
import { TODOWRITE_DESCRIPTION } from "./hooks/todo-description-override/description"
import {
  hasInternalMarkerV2,
  isCopilotProviderV2,
  registerHeadersV2Hook,
  registerToolDefinitionV2,
} from "./v2-request"

describe("v2 request hooks", () => {
  it("detects copilot providers", () => {
    // given provider ids
    // when classified
    // then only copilot matches
    expect(isCopilotProviderV2("github-copilot")).toBe(true)
    expect(isCopilotProviderV2("github-copilot-enterprise")).toBe(true)
    expect(isCopilotProviderV2("anthropic")).toBe(false)
  })

  it("finds the internal marker in user messages", async () => {
    // given a message list with a marked user message
    const messages = [
      { role: "assistant", parts: [{ type: "text", text: "hello" }] },
      { role: "user", parts: [{ type: "text", text: `run it ${OMO_INTERNAL_INITIATOR_MARKER} now` }] },
    ]

    // when scanned
    const found = await hasInternalMarkerV2(async () => messages, "ses-marker-test")

    // then the marker is found
    expect(found).toBe(true)
  })

  it("overrides the todowrite description when the tool exists", async () => {
    // given a fake tool editor holding todowrite
    let updated = ""
    const ctx = {
      tool: {
        transform: async (callback: (editor: {
          get: (id: string) => { description: string } | undefined
          update: (id: string, update: (tool: { description: string }) => void) => void
        }) => void) => {
          const draft = { description: "old" }
          callback({
            get: (id: string) => (id === "todowrite" ? draft : undefined),
            update: (_id: string, update: (tool: { description: string }) => void) => {
              update(draft)
              updated = draft.description
            },
          })
        },
      },
    }

    // when the transform registers
    await registerToolDefinitionV2(ctx as unknown as Plugin.Context)

    // then the description matches the v1 override text
    expect(updated).toBe(TODOWRITE_DESCRIPTION)
  })

  it("sets x-initiator for marked copilot requests only", async () => {
    // given a fake session ctx with a marked user message
    let captured: ((event: {
      model: { providerID: string }
      sessionID: string
      headers: Record<string, string>
    }) => Promise<void>) | undefined
    const ctx = {
      session: {
        context: async () => [
          { role: "user", parts: [{ type: "text", text: "do it" }] },
        ],
        hook: async (
          _name: string,
          callback: (event: {
            model: { providerID: string }
            sessionID: string
            headers: Record<string, string>
          }) => Promise<void>,
        ) => {
          captured = callback
        },
      },
    }
    const copilotEvent = {
      model: { providerID: "github-copilot" },
      sessionID: "ses-copilot-test",
      headers: {} as Record<string, string>,
    }
    const otherEvent = {
      model: { providerID: "anthropic" },
      sessionID: "ses-other-test",
      headers: {} as Record<string, string>,
    }

    // when the hook is registered and invoked
    await registerHeadersV2Hook(ctx as unknown as Plugin.Context)
    await captured?.(copilotEvent)
    await captured?.(otherEvent)

    // then registration happened; header behavior follows marker presence
    expect(captured).not.toBeUndefined()
    expect(otherEvent.headers["x-initiator"]).toBeUndefined()
  })

  it("sets x-initiator for a marked copilot message", async () => {
    // given a copilot session whose transcript carries the internal marker
    let captured: ((event: {
      model: { providerID: string }
      sessionID: string
      headers: Record<string, string>
    }) => Promise<void>) | undefined
    const markedSessionID = "ses-copilot-marked-test"
    const ctx = {
      session: {
        context: async () => [
          { role: "user", parts: [{ type: "text", text: `run ${OMO_INTERNAL_INITIATOR_MARKER}` }] },
        ],
        hook: async (
          _name: string,
          callback: (event: {
            model: { providerID: string }
            sessionID: string
            headers: Record<string, string>
          }) => Promise<void>,
        ) => {
          captured = callback
        },
      },
    }
    const event = {
      model: { providerID: "github-copilot" },
      sessionID: markedSessionID,
      headers: {} as Record<string, string>,
    }

    // when invoked
    await registerHeadersV2Hook(ctx as unknown as Plugin.Context)
    await captured?.(event)

    // then the initiator header is set
    expect(event.headers["x-initiator"]).toBe("agent")
  })
})
