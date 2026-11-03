import { describe, expect, it } from "bun:test"
import { resolve } from "node:path"

import type { CheckResult, RunCommentCheckerInput } from "@oh-my-opencode/comment-checker-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import {
  createContext,
  createRecordingLogger,
  createTempCwd,
  createToolResultEvent,
  isToolResultPatch,
} from "./comment-checker.test-support"
import { COMMENT_CHECKER_FEEDBACK_HEADER, createCommentCheckerComponent } from "./index"

type Harness = {
  pi: FakeExtensionAPI
  calls: RunCommentCheckerInput[]
  resolveCount: () => number
  ctx: Record<string, unknown>
  cwd: string
}

async function register(results: (input: RunCommentCheckerInput) => CheckResult): Promise<Harness> {
  const cwd = createTempCwd()
  const pi = new FakeExtensionAPI()
  const calls: RunCommentCheckerInput[] = []
  let resolves = 0
  const component = createCommentCheckerComponent({
    resolveBinary: () => {
      resolves += 1
      return "/tmp/fake-comment-checker"
    },
    downloadBinary: async () => null,
    runCommentChecker: async (input) => {
      calls.push(input)
      return results(input)
    },
  })
  await component.register(pi, { logger: createRecordingLogger(), config: { getFlag: (name: string) => pi.getFlag(name) } })
  return { pi, calls, resolveCount: () => resolves, ctx: createContext(cwd), cwd }
}

const violation: CheckResult = { hasComments: true, message: "line 1: redundant comment" }
const clean: CheckResult = { hasComments: false, message: "" }

function edit(path: string, toolCallId: string): Record<string, unknown> {
  return createToolResultEvent({ toolCallId, input: { path, edits: [{ oldText: "old", newText: "new" }] } })
}

function turnStart(turnIndex: number): Record<string, unknown> {
  return { type: "turn_start", turnIndex, timestamp: 1000 + turnIndex }
}

function feedbackTexts(result: unknown[]): string[] {
  const first = result[0]
  if (!isToolResultPatch(first) || first.content === undefined) return []
  return first.content.map((block) => block.text)
}

function checkedPaths(calls: RunCommentCheckerInput[]): unknown[] {
  return calls.map((call) => call.hookInput.tool_input.file_path)
}

describe("X8a comment-checker turn reset (characterization of today)", () => {
  it("#given a file reported this turn #when it is edited again in the same turn #then the checker is not re-run and nothing is injected", async () => {
    // given
    const h = await register(() => violation)
    const first = await h.pi.dispatch("tool_result", edit("src/a.ts", "t1"), h.ctx)

    // when
    const second = await h.pi.dispatch("tool_result", edit("src/a.ts", "t2"), h.ctx)

    // then
    expect(feedbackTexts(first)).toEqual(["edited", `${COMMENT_CHECKER_FEEDBACK_HEADER} ${resolve(h.cwd, "src/a.ts")}:\nline 1: redundant comment`])
    expect(second).toEqual([undefined])
    expect(h.calls).toHaveLength(1)
  })

  it("#given a file reported in turn 1 #when turn_start fires and it is edited again #then it is checked and reported again", async () => {
    // given
    const h = await register(() => violation)
    await h.pi.dispatch("tool_result", edit("src/a.ts", "t1"), h.ctx)

    // when
    const reset = await h.pi.dispatch("turn_start", turnStart(2), h.ctx)
    const again = await h.pi.dispatch("tool_result", edit("src/a.ts", "t2"), h.ctx)

    // then
    expect(reset).toEqual([undefined])
    expect(h.calls).toHaveLength(2)
    expect(feedbackTexts(again)).toEqual(["edited", `${COMMENT_CHECKER_FEEDBACK_HEADER} ${resolve(h.cwd, "src/a.ts")}:\nline 1: redundant comment`])
  })

  it("#given every turn reports the file #when three turns each edit it twice #then each turn checks and reports it exactly once", async () => {
    // given
    const h = await register(() => violation)
    const reported: number[] = []

    // when
    for (const turn of [1, 2, 3]) {
      await h.pi.dispatch("turn_start", turnStart(turn), h.ctx)
      const a = await h.pi.dispatch("tool_result", edit("src/a.ts", `t${turn}a`), h.ctx)
      const b = await h.pi.dispatch("tool_result", edit("src/a.ts", `t${turn}b`), h.ctx)
      reported.push(feedbackTexts(a).length > 0 ? 1 : 0, feedbackTexts(b).length > 0 ? 1 : 0)
    }

    // then
    expect(reported).toEqual([1, 0, 1, 0, 1, 0])
    expect(h.calls).toHaveLength(3)
  })

  it("#given a clean check #when the same file is edited again in the same turn #then it is checked again (only reported files are debounced)", async () => {
    // given
    const h = await register(() => clean)
    await h.pi.dispatch("tool_result", edit("src/a.ts", "t1"), h.ctx)

    // when
    const second = await h.pi.dispatch("tool_result", edit("src/a.ts", "t2"), h.ctx)

    // then
    expect(second).toEqual([undefined])
    expect(h.calls).toHaveLength(2)
  })

  it("#given hasComments with an empty message #when the same file is edited again in the same turn #then it is checked again (not recorded as reported)", async () => {
    // given
    const h = await register(() => ({ hasComments: true, message: "   " }))
    const first = await h.pi.dispatch("tool_result", edit("src/a.ts", "t1"), h.ctx)

    // when
    await h.pi.dispatch("tool_result", edit("src/a.ts", "t2"), h.ctx)

    // then
    expect(first).toEqual([undefined])
    expect(h.calls).toHaveLength(2)
  })

  it("#given a reported file #when a different file is edited in the same turn #then the other file is still checked (debounce is per path)", async () => {
    // given
    const h = await register(() => violation)
    await h.pi.dispatch("tool_result", edit("src/a.ts", "t1"), h.ctx)

    // when
    const other = await h.pi.dispatch("tool_result", edit("src/b.ts", "t2"), h.ctx)

    // then
    expect(checkedPaths(h.calls)).toEqual([resolve(h.cwd, "src/a.ts"), resolve(h.cwd, "src/b.ts")])
    expect(feedbackTexts(other)).toHaveLength(2)
  })

  it("#given a file reported via a relative path #when it is edited via its absolute path in the same turn #then it is debounced (keyed by resolved path)", async () => {
    // given
    const h = await register(() => violation)
    await h.pi.dispatch("tool_result", edit("src/a.ts", "t1"), h.ctx)

    // when
    const absolute = await h.pi.dispatch("tool_result", edit(resolve(h.cwd, "src/a.ts"), "t2"), h.ctx)

    // then
    expect(absolute).toEqual([undefined])
    expect(h.calls).toHaveLength(1)
  })

  it("#given a reported file #when an apply_patch touches it and another file in the same turn #then only the other file is checked, and after turn_start both are", async () => {
    // given
    const h = await register(() => violation)
    await h.pi.dispatch("tool_result", edit("a.ts", "t1"), h.ctx)
    const patch = createToolResultEvent({
      toolCallId: "t2",
      toolName: "apply_patch",
      input: { input: "*** Begin Patch\n*** Update File: a.ts\n@@\n-old\n+new\n*** Add File: b.ts\n+new\n*** End Patch" },
    })

    // when
    const sameTurn = await h.pi.dispatch("tool_result", patch, h.ctx)
    await h.pi.dispatch("turn_start", turnStart(2), h.ctx)
    const nextTurn = await h.pi.dispatch("tool_result", { ...patch, toolCallId: "t3" }, h.ctx)

    // then
    expect(checkedPaths(h.calls)).toEqual([
      resolve(h.cwd, "a.ts"),
      resolve(h.cwd, "b.ts"),
      resolve(h.cwd, "a.ts"),
      resolve(h.cwd, "b.ts"),
    ])
    expect(feedbackTexts(sameTurn)).toHaveLength(2)
    expect(feedbackTexts(nextTurn)).toHaveLength(3)
  })

  it("#given a checker that could not start #when turn_start fires #then the component stays inert (turn_start resets only the reported files)", async () => {
    // given
    const h = await register(() => ({ hasComments: false, message: "", failure: { exitCode: 3, stderr: "" } }))
    await h.pi.dispatch("tool_result", edit("src/a.ts", "t1"), h.ctx)

    // when
    await h.pi.dispatch("turn_start", turnStart(2), h.ctx)
    const after = await h.pi.dispatch("tool_result", edit("src/b.ts", "t2"), h.ctx)

    // then
    expect(after).toEqual([undefined])
    expect(h.calls).toHaveLength(1)
  })

  it("#given a resolved binary #when turn_start fires #then the binary is not resolved again", async () => {
    // given
    const h = await register(() => clean)
    await h.pi.dispatch("tool_result", edit("src/a.ts", "t1"), h.ctx)

    // when
    await h.pi.dispatch("turn_start", turnStart(2), h.ctx)
    await h.pi.dispatch("tool_result", edit("src/a.ts", "t2"), h.ctx)

    // then
    expect(h.resolveCount()).toBe(1)
    expect(h.calls).toHaveLength(2)
  })
})
