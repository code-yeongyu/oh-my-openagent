import { describe, expect, it } from "bun:test"
import { notifyTargetBackgroundCompletion, registerTargetContinuation } from "./continuation"
import { TargetPromptGate } from "./target-prompt-gate"

describe("target continuation gate", () => {
  it("#given concurrent completion wakes #when dispatched #then duplicate internal prompts collapse", async () => {
    const messages: string[] = []
    const gate = new TargetPromptGate(async (message) => { messages.push(message) })

    const results = await Promise.all([
      notifyTargetBackgroundCompletion(gate, "session", "task-1"),
      notifyTargetBackgroundCompletion(gate, "session", "task-1"),
    ])

    expect(messages).toHaveLength(1)
    expect(results.sort()).toEqual(["coalesced", "dispatched"])
  })

  it("#given an idle target continuation #when a completion wake is dispatched #then it triggers a new turn", async () => {
    const deliveries: Array<{ content: string; deliverAs?: string }> = []
    const gate = registerTargetContinuation("pi", {
      on: () => {},
      sendUserMessage: async (content, options) => {
        deliveries.push({ content, deliverAs: options?.deliverAs })
      },
    })

    await notifyTargetBackgroundCompletion(gate, "session", "task-1")

    expect(deliveries).toEqual([
      {
        content: "Background task task-1 completed. Review its result and continue.",
        deliverAs: "followUp",
      },
    ])
  })

  it("#given an actively processing target #when a background completion wake is dispatched #then it uses a follow-up directly", async () => {
    const deliveries: Array<{ content: string; deliverAs?: string }> = []
    const gate = registerTargetContinuation("pi", {
      on: () => {},
      sendUserMessage: async (content, options) => {
        deliveries.push({ content, deliverAs: options?.deliverAs })
        if (!options?.deliverAs) throw new Error("Agent is already processing")
      },
    })

    await notifyTargetBackgroundCompletion(gate, "session", "task-1")

    expect(deliveries.map((delivery) => delivery.deliverAs)).toEqual(["followUp"])
  })

  it("#given a compaction event #when continuation dispatches #then the event handler awaits the new turn", async () => {
    let compactHandler: ((payload: unknown, context: unknown) => unknown) | undefined
    const deliveries: string[] = []
    registerTargetContinuation("pi", {
      on: (_event, handler) => { compactHandler = handler },
      sendUserMessage: async (content) => { deliveries.push(content) },
    })

    await compactHandler?.({}, {})
    expect(deliveries).toEqual([
      "Context compaction completed. Continue the active work from the preserved summary and pending tasks.",
    ])
  })

  it("#given Oh My Pi native auto-compaction #when its compact event fires #then OMO does not duplicate native continuation", async () => {
    const handlers = new Map<string, (payload: unknown, context: unknown) => unknown>()
    const deliveries: string[] = []
    registerTargetContinuation("oh-my-pi", {
      on: (event, handler) => { handlers.set(event, handler) },
      sendUserMessage: async (content) => { deliveries.push(content) },
    })

    await handlers.get("auto_compaction_start")?.({}, {})
    await handlers.get("session_compact")?.({}, {})
    await handlers.get("auto_compaction_end")?.({}, {})
    expect(deliveries).toEqual([])

    await handlers.get("session_compact")?.({}, {})
    expect(deliveries).toEqual([
      "Context compaction completed. Continue the active work from the preserved summary and pending tasks.",
    ])
  })
})
