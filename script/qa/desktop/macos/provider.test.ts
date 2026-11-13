import { describe, expect, test } from "bun:test"

import type { MockStep } from "../../../../packages/omo-senpi/scripts/qa/mock-provider/index"
import { chooseStep, QA_PROMPT_PREFIX } from "./provider"

const script: MockStep[] = [
  { type: "text", text: "unused" },
  { type: "tool_call", name: "computer", arguments: { action: "capabilities" } },
  { type: "text", text: "done" },
]
const qaPrompt = { role: "user", content: [{ type: "text", text: `${QA_PROMPT_PREFIX} 2` }] }

describe("macOS QA mock provider step choice", () => {
  test("#given a QA prompt last #when a reply is chosen #then it is the scripted tool call", () => {
    expect(chooseStep([qaPrompt], script)).toEqual(script[1])
  })

  test("#given a tool result last #when a reply is chosen #then it is the closing text", () => {
    expect(chooseStep([qaPrompt, { role: "assistant" }, { role: "toolResult" }], script)).toEqual(script[2])
  })

  test("#given a host reminder injected after the QA prompt #when a reply is chosen #then it is still the tool call", () => {
    const reminder = { role: "user", content: "<system-reminder>first request of the session</system-reminder>" }
    expect(chooseStep([qaPrompt, reminder], script)).toEqual(script[1])
  })

  test("#given an answered QA prompt followed by the host's own request #when a reply is chosen #then nothing is consumed", () => {
    const answered = [qaPrompt, { role: "assistant" }, { role: "user", content: "Generate a short title" }]
    expect(chooseStep(answered, script)).not.toEqual(script[1])
  })

  test("#given the host's own request between prompts #when replies are chosen #then the QA prompt still gets its tool call", () => {
    // given senpi asking for a session title after the first turn
    const titleRequest = [{ role: "user", content: "Generate a short title for this conversation" }]

    // when the title request and then the next QA prompt are answered
    const background = chooseStep(titleRequest, script)
    const next = chooseStep([qaPrompt], script)

    // then the title request consumed nothing and the QA prompt still reaches its tool call
    expect(background).not.toEqual(script[1])
    expect(background).not.toEqual(script[2])
    expect(next).toEqual(script[1])
  })
})
