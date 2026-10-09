/// <reference types="bun-types" />

import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext } from "../../extension/types"
import { PINNED_GATE_HEADERS } from "./gate-rule"
import { createQuestionGatesComponent } from "./index"

interface DebugLine {
  readonly message: string
  readonly details: unknown
}

function register(): { pi: FakeExtensionAPI; debug: DebugLine[] } {
  const pi = new FakeExtensionAPI()
  const debug: DebugLine[] = []
  const ctx: ComponentContext = {
    logger: {
      debug(message, details) {
        debug.push({ message, details })
      },
      info() {},
      warn() {},
      error() {},
    },
    config: { getFlag: (name) => pi.getFlag(name) },
  }
  createQuestionGatesComponent().register(pi, ctx)
  return { pi, debug }
}

async function dispatchToolCall(pi: FakeExtensionAPI, toolName: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  await pi.dispatch("tool_call", { type: "tool_call", toolName, toolCallId: "call-1", input })
  return input
}

// The ulw-plan approval gate exactly as zai/glm-5.3 sent it in live QA run t3 (#9775): no `required`.
function recordedGlmGateInput(): Record<string, unknown> {
  return {
    questions: [
      {
        header: "Approval",
        multiSelect: false,
        question: "Approve this plan approach (todo.json in cwd, load-on-start / write-on-add)?",
        options: [
          { label: "Approve", description: "Create the plan file, then run the high-accuracy plan-reviewer review." },
          { label: "Approve, skip review", description: "Create the plan file and skip the plan-reviewer review." },
          { label: "Change approach", description: "Tell me what to change; the gate stays open." },
        ],
      },
    ],
    waitForAnswer: true,
  }
}

function fork(header: string, question: string, labels: readonly string[]): Record<string, unknown> {
  return { header, multiSelect: false, question, options: labels.map((label) => ({ label, description: label })) }
}

describe("question-gates", () => {
  it("#given the recorded glm gate call without required #when tool_call fires #then required is forced to true", async () => {
    // given
    const { pi } = register()

    // when
    const input = await dispatchToolCall(pi, "ask_user_question", recordedGlmGateInput())

    // then
    expect(input["required"]).toBe(true)
  })

  it.each([
    ["Authorize"],
    ["authorise"],
    ["approval"],
    ["승인"],
    ["권한"],
  ])("#given a pinned gate header %p #when tool_call fires #then required is forced by the header rule", async (header) => {
    // given
    const { pi, debug } = register()

    // when
    const input = await dispatchToolCall(pi, "ask_user_question", {
      questions: [fork(header, "Proceed with the irreversible step?", ["Proceed", "Hold"])],
      waitForAnswer: true,
    })

    // then
    expect(input["required"]).toBe(true)
    expect(debug).toEqual([
      { message: "omo-senpi question-gates forced required", details: { tool: "ask_user_question", header, rule: "header" } },
    ])
  })

  it("#given a gate asked without a pinned header #when an option label starts with Approve #then the label rule forces required", async () => {
    // given
    const { pi, debug } = register()

    // when
    const input = await dispatchToolCall(pi, "request_user_input", {
      questions: [fork("Next step", "Ready to write the plan?", ["Approve plan", "Change approach"])],
      wait_for_answer: true,
    })

    // then
    expect(input["required"]).toBe(true)
    expect(debug).toEqual([
      { message: "omo-senpi question-gates forced required", details: { tool: "request_user_input", header: "Next step", rule: "label" } },
    ])
  })

  it("#given a fork whose question text mentions approval #when headers and labels carry no gate word #then required is not forced", async () => {
    // given
    const { pi, debug } = register()

    // when
    const input = await dispatchToolCall(pi, "ask_user_question", {
      questions: [
        fork(
          "Review flow",
          "Should the approve step require two reviewers before merge, and who may approve hotfixes?",
          ["Two reviewers", "One reviewer", "Pre-approved list"],
        ),
      ],
      waitForAnswer: true,
    })

    // then
    expect(input["required"]).toBeUndefined()
    expect(debug).toEqual([])
  })

  it.each([
    ["Approvals log"],
    ["Pre-approval"],
    ["Approval UX"],
    ["권한 모델"],
    ["승인자"],
  ])("#given header %p that only contains a gate word #when tool_call fires #then the anchored rule does not force required", async (header) => {
    // given
    const { pi } = register()

    // when
    const input = await dispatchToolCall(pi, "ask_user_question", {
      questions: [fork(header, "Which entries should be listed?", ["All", "Recent"])],
      waitForAnswer: true,
    })

    // then
    expect(input["required"]).toBeUndefined()
  })

  it("#given an ordinary fork call #when tool_call fires #then the input is left unchanged", async () => {
    // given
    const { pi } = register()
    const before = {
      questions: [fork("Storage", "Where should the todos be persisted?", ["File in cwd", "XDG data dir"])],
      waitForAnswer: true,
    }

    // when
    const input = await dispatchToolCall(pi, "ask_user_question", structuredClone(before))

    // then
    expect(input).toEqual(before)
  })

  it("#given a gate call the model already marked required #when tool_call fires #then nothing is logged and the flag stays true", async () => {
    // given
    const { pi, debug } = register()

    // when
    const input = await dispatchToolCall(pi, "ask_user_question", { ...recordedGlmGateInput(), required: true })

    // then
    expect(input["required"]).toBe(true)
    expect(debug).toEqual([])
  })

  it("#given a gate call the model marked required false #when tool_call fires #then the gate still forces true", async () => {
    // given
    const { pi } = register()

    // when
    const input = await dispatchToolCall(pi, "ask_user_question", { ...recordedGlmGateInput(), required: false })

    // then
    expect(input["required"]).toBe(true)
  })

  it("#given another tool carrying gate-shaped input #when tool_call fires #then it is untouched", async () => {
    // given
    const { pi } = register()

    // when
    const input = await dispatchToolCall(pi, "todo", recordedGlmGateInput())

    // then
    expect(input["required"]).toBeUndefined()
  })

  it("#given a forced gate #when the debug line is written #then it carries no question or option text", async () => {
    // given
    const { pi, debug } = register()

    // when
    await dispatchToolCall(pi, "ask_user_question", recordedGlmGateInput())

    // then
    const serialized = JSON.stringify(debug)
    expect(serialized).not.toContain("todo.json")
    expect(serialized).not.toContain("plan-reviewer")
    expect(debug).toEqual([
      { message: "omo-senpi question-gates forced required", details: { tool: "ask_user_question", header: "Approval", rule: "header" } },
    ])
  })
})

const senpiDistDir = dirname(fileURLToPath(import.meta.resolve("@code-yeongyu/senpi")))
const askUserToolModule = await import(
  pathToFileURL(join(senpiDistDir, "core", "extensions", "builtin", "ask-user", "tool.js")).href
) as {
  createAskUserTool(variant: "claude" | "codex", pi: unknown, state: { timedOut: boolean; unavailable: boolean }): {
    prepareArguments(args: Record<string, unknown>): Record<string, unknown>
    execute(
      toolCallId: string,
      params: Record<string, unknown>,
      signal: AbortSignal | undefined,
      onUpdate: undefined,
      ctx: unknown,
    ): Promise<{ content: ReadonlyArray<{ type: string; text?: string }> }>
  }
}

// senpi's own ask_user_question tool, in the state it is in after an earlier question in the turn
// timed out: `execute` answers at once with the no-answer result, worded by `request.required`.
async function noAnswerResultText(params: Record<string, unknown>): Promise<string> {
  const hostPi = { events: { emit() {} } }
  const tool = askUserToolModule.createAskUserTool("claude", hostPi, { timedOut: true, unavailable: false })
  const result = await tool.execute("call-1", params, undefined, undefined, {
    getAskUserSettings: () => ({ timeoutMinutes: 1, enabled: true }),
  })
  return result.content.map((part) => part.text ?? "").join("\n")
}

describe("question-gates through senpi's ask_user_question tool", () => {
  it("#given the recorded glm gate call #when no answer comes back without the component #then senpi tells the model to continue", async () => {
    // given
    const params = recordedGlmGateInput()

    // when
    const text = await noAnswerResultText(params)

    // then
    expect(text).not.toContain("do not take the action it gates")
  })

  it("#given the recorded glm gate call #when the component ran before the tool and no answer comes back #then senpi refuses the gated action", async () => {
    // given
    const { pi } = register()
    const params = await dispatchToolCall(pi, "ask_user_question", recordedGlmGateInput())

    // when
    const text = await noAnswerResultText(params)

    // then
    expect(text).toContain("do not take the action it gates")
  })
})

describe("pinned gate headers against senpi's question schema", () => {
  const tool = askUserToolModule.createAskUserTool("claude", { events: { emit() {} } }, { timedOut: false, unavailable: false })
  const call = (header: string) => ({
    questions: [fork(header, "Proceed?", ["Approve", "Change approach"])],
    waitForAnswer: true,
  })

  it.each(PINNED_GATE_HEADERS.map((header) => [header]))("#given pinned header %p #when senpi prepares the call #then it is accepted", (header) => {
    // when
    const prepare = () => tool.prepareArguments(call(header))

    // then
    expect(prepare).not.toThrow()
  })

  it("#given a 13-character header #when senpi prepares the call #then senpi rejects it before any extension sees it", () => {
    // when
    const prepare = () => tool.prepareArguments(call("Authorization"))

    // then
    expect(prepare).toThrow()
  })
})
