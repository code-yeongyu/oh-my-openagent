import { describe, expect, it } from "bun:test"
import { notifyTargetBackgroundCompletion } from "./continuation"
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
})
