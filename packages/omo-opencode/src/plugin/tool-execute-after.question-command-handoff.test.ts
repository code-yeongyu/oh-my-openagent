import { describe, expect, test } from "bun:test"
import { tmpdir } from "os"
import type { PluginInput } from "@opencode-ai/plugin"

import { createQuestionCommandHandoffHook } from "../hooks/question-command-handoff"
import type {
  InternalPromptDispatchArgs,
  InternalPromptDispatchResult,
  PromptAsyncInput,
} from "../shared/prompt-async-gate/types"
import type { CreatedHooks } from "../create-hooks"
import { createToolExecuteAfterHandler } from "./tool-execute-after"
import type { PluginContext } from "./types"

// Drives the real production tool.execute.after entrypoint (the same handler
// opencode invokes) wired to the real question-command-handoff hook, proving the
// full chain from a Prometheus question answer to a queued /start-work command.
function createHarness(agent: string) {
  const dispatched: InternalPromptDispatchArgs<PromptAsyncInput>[] = []
  const ctx = { client: {}, directory: tmpdir() } as unknown as PluginContext

  const hook = createQuestionCommandHandoffHook(ctx as unknown as PluginInput, {
    dispatch: async (args): Promise<InternalPromptDispatchResult> => {
      dispatched.push(args)
      return { status: "queued", queuedBy: args.source, position: 1 }
    },
    discoverCommandNames: () => new Set(["start-work"]),
    getAgent: () => agent,
  })

  const hooks = { questionCommandHandoff: hook } as unknown as CreatedHooks
  const handler = createToolExecuteAfterHandler({ ctx, hooks })
  return { handler, dispatched }
}

const questionInput = {
  tool: "question",
  sessionID: "ses_handoff",
  callID: "call_handoff",
  args: {
    questions: [
      {
        question: "Plan ready. What next?",
        options: [
          { label: "Start Work", description: "Execute now with `/start-work {name}`." },
          { label: "High Accuracy Review", description: "Run an extra review pass." },
        ],
      },
    ],
  },
}

function answeredOutput(label: string) {
  return {
    title: "Asked 1 question",
    output: `User answered: "${label}".`,
    metadata: { answers: [[label]] },
  }
}

describe("tool.execute.after -> question-command-handoff (real chain)", () => {
  test("queues /start-work when Prometheus's handoff option is selected", async () => {
    // given the real after-hook handler wired to the real hook, prometheus session
    const { handler, dispatched } = createHarness("prometheus")

    // when the question tool result for the command-bearing option flows through
    await handler(questionInput, answeredOutput("Start Work"))

    // then the real chain dispatched exactly the bound command
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0]?.mode).toBe("async")
    expect(dispatched[0]?.sessionID).toBe("ses_handoff")
    const body = dispatched[0]?.input.body as { parts: Array<{ text: string }> }
    expect(body.parts[0]?.text).toBe("/start-work")
  })

  test("leaves non-handoff agents untouched through the real chain", async () => {
    // given a sisyphus session answering its own single-select question
    const { handler, dispatched } = createHarness("sisyphus")

    // when the same answer flows through the real handler
    await handler(questionInput, answeredOutput("Start Work"))

    // then nothing is dispatched
    expect(dispatched).toHaveLength(0)
  })
})
