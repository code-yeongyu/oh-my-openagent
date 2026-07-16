import { describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"

import type {
  InternalPromptDispatchArgs,
  InternalPromptDispatchResult,
  PromptAsyncInput,
} from "../../shared/prompt-async-gate/types"
import { createQuestionCommandHandoffHook } from "./hook"

function createHookHarness(options?: {
  agent?: string
  dispatchStatus?: InternalPromptDispatchResult["status"]
}) {
  const dispatched: InternalPromptDispatchArgs<PromptAsyncInput>[] = []
  const ctx = {
    client: {},
    directory: "/tmp/project",
  } as unknown as PluginInput

  const hook = createQuestionCommandHandoffHook(ctx, {
    dispatch: async (args) => {
      dispatched.push(args)
      const status = options?.dispatchStatus ?? "queued"
      if (status === "queued") {
        return { status: "queued", queuedBy: args.source, position: 1 }
      }
      return { status: "unavailable" }
    },
    discoverCommandNames: () => new Set(["start-work"]),
    getAgent: () => options?.agent ?? "prometheus",
  })

  return { hook, dispatched }
}

const questionArgs = {
  questions: [
    {
      question: "Plan ready. What next?",
      options: [
        {
          label: "Start Work",
          description: "Execute now with `/start-work {name}`.",
        },
        {
          label: "High Accuracy Review",
          description: "Run an extra review pass before executing.",
        },
      ],
    },
  ],
}

function createAnsweredOutput(selectedLabel: string) {
  return {
    title: "Asked 1 question",
    output: `User has answered your questions: "Plan ready. What next?"="${selectedLabel}".`,
    metadata: { answers: [[selectedLabel]] },
  }
}

describe("createQuestionCommandHandoffHook", () => {
  test("dispatches the referenced command once for a command-bearing answer", async () => {
    //#given
    const { hook, dispatched } = createHookHarness()
    const input = {
      tool: "question",
      sessionID: "ses_1",
      callID: "call_1",
      args: questionArgs,
    }

    //#when
    await hook["tool.execute.after"](input, createAnsweredOutput("Start Work"))

    //#then
    expect(dispatched).toHaveLength(1)
    const body = dispatched[0]?.input.body as { parts: Array<{ text: string }> }
    expect(body.parts[0]?.text).toBe("/start-work")
    expect(dispatched[0]?.sessionID).toBe("ses_1")
    expect(dispatched[0]?.mode).toBe("async")
  })

  test("collapses duplicate after-hook invocations for the same call", async () => {
    //#given the same tool call observed twice (retry/duplicate event edge)
    const { hook, dispatched } = createHookHarness()
    const input = {
      tool: "question",
      sessionID: "ses_1",
      callID: "call_dup",
      args: questionArgs,
    }
    const output = createAnsweredOutput("Start Work")

    //#when
    await hook["tool.execute.after"](input, output)
    await hook["tool.execute.after"](input, output)

    //#then
    expect(dispatched).toHaveLength(1)
  })

  test("dispatches separate same-label answers when call IDs are missing", async () => {
    //#given two distinct question tool calls that both lack a callID and
    // happen to select the same visible label
    const { hook, dispatched } = createHookHarness()
    const input = {
      tool: "question",
      sessionID: "ses_no_call_id",
      args: questionArgs,
    }
    const output = createAnsweredOutput("Start Work")

    //#when
    await hook["tool.execute.after"](input, output)
    await hook["tool.execute.after"](input, createAnsweredOutput("Start Work"))

    //#then both legitimate selections dispatch; duplicate-event collapse is
    // the prompt-async-gate's semantic dedupe responsibility here
    expect(dispatched).toHaveLength(2)
  })

  test("does not dispatch for answers given to non-handoff agents", async () => {
    //#given a sisyphus session asking its own plan-selection question
    const { hook, dispatched } = createHookHarness({ agent: "sisyphus" })
    const input = {
      tool: "question",
      sessionID: "ses_2",
      callID: "call_2",
      args: questionArgs,
    }

    //#when
    await hook["tool.execute.after"](input, createAnsweredOutput("Start Work"))

    //#then
    expect(dispatched).toHaveLength(0)
  })

  test("does not dispatch for non-question tools", async () => {
    //#given
    const { hook, dispatched } = createHookHarness()
    const input = {
      tool: "bash",
      sessionID: "ses_3",
      callID: "call_3",
      args: questionArgs,
    }

    //#when
    await hook["tool.execute.after"](input, createAnsweredOutput("Start Work"))

    //#then
    expect(dispatched).toHaveLength(0)
  })

  test("does not dispatch when the answered option has no command reference", async () => {
    //#given
    const { hook, dispatched } = createHookHarness()
    const input = {
      tool: "question",
      sessionID: "ses_4",
      callID: "call_4",
      args: questionArgs,
    }

    //#when
    await hook["tool.execute.after"](input, createAnsweredOutput("High Accuracy Review"))

    //#then
    expect(dispatched).toHaveLength(0)
  })

  test("does not dispatch when structured answers metadata is missing", async () => {
    //#given an output without the question tool's answers metadata
    const { hook, dispatched } = createHookHarness()
    const input = {
      tool: "question",
      sessionID: "ses_5",
      callID: "call_5",
      args: questionArgs,
    }
    const output = {
      title: "Asked 1 question",
      output: "User has answered your questions.",
      metadata: {},
    }

    //#when
    await hook["tool.execute.after"](input, output)

    //#then
    expect(dispatched).toHaveLength(0)
  })

  test("tolerates a rejected dispatch without throwing", async () => {
    //#given a gate that reports the prompt route unavailable
    const { hook, dispatched } = createHookHarness({ dispatchStatus: "unavailable" })
    const input = {
      tool: "question",
      sessionID: "ses_6",
      callID: "call_6",
      args: questionArgs,
    }

    //#when / #then
    await hook["tool.execute.after"](input, createAnsweredOutput("Start Work"))
    expect(dispatched).toHaveLength(1)
  })
})
