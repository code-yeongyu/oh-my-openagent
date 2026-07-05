import { describe, expect, it } from "bun:test"
import { resolve } from "node:path"

import {
  createContext,
  createRecordingLogger,
  createTempCwd,
  createToolResultEvent,
  isToolResultPatch,
  registerWithFakeRunner,
} from "./comment-checker.test-support"
import { COMMENT_CHECKER_FEEDBACK_HEADER } from "./index"

describe("omo-senpi comment-checker feedback", () => {
  it("#given checker violation #when edit completes #then feedback includes the header and offending file", async () => {
    // given
    const cwd = createTempCwd()
    const expectedPath = resolve(cwd, "src/example.ts")
    const { pi } = await registerWithFakeRunner({
      result: { hasComments: true, message: "line 1: redundant comment" },
    })

    // when
    const [result] = await pi.dispatch("tool_result", createToolResultEvent(), createContext(cwd))

    // then
    expect(isToolResultPatch(result)).toBe(true)
    const content = isToolResultPatch(result) ? result.content : undefined
    expect(content?.map((block) => block.text)).toEqual([
      "edited",
      `${COMMENT_CHECKER_FEEDBACK_HEADER} ${expectedPath}:\nline 1: redundant comment`,
    ])
  })

  it("#given checker finds a clean file #when edit completes #then injects nothing", async () => {
    // given
    const cwd = createTempCwd()
    const { pi } = await registerWithFakeRunner({
      result: { hasComments: false, message: "" },
    })

    // when
    const result = await pi.dispatch("tool_result", createToolResultEvent(), createContext(cwd))

    // then
    expect(result).toEqual([undefined])
  })

  it("#given unresolvable binary #when eligible results repeat #then component is inert with one notice", async () => {
    // given
    const cwd = createTempCwd()
    const logger = createRecordingLogger()
    const { pi, calls } = await registerWithFakeRunner({
      resolveBinary: () => null,
      logger,
    })

    // when
    await pi.dispatch("tool_result", createToolResultEvent(), createContext(cwd))
    await pi.dispatch(
      "tool_result",
      createToolResultEvent({ toolCallId: "tool-2", input: { path: "src/other.ts", edits: [] } }),
      createContext(cwd),
    )

    // then
    expect(calls).toHaveLength(0)
    expect(logger.entries).toEqual([
      {
        level: "warn",
        message: "omo-senpi comment-checker binary unavailable; component disabled for this session",
      },
    ])
  })

  it("#given same file reported twice #when still in one turn #then stale_state debounce emits one report until turn_start", async () => {
    // given
    const cwd = createTempCwd()
    const { pi, calls } = await registerWithFakeRunner({
      result: { hasComments: true, message: "line 1: redundant comment" },
    })

    // when
    const first = await pi.dispatch("tool_result", createToolResultEvent(), createContext(cwd))
    const second = await pi.dispatch("tool_result", createToolResultEvent({ toolCallId: "tool-2" }), createContext(cwd))
    await pi.dispatch("turn_start", { type: "turn_start", turnIndex: 2, timestamp: 123 }, createContext(cwd))
    const third = await pi.dispatch("tool_result", createToolResultEvent({ toolCallId: "tool-3" }), createContext(cwd))

    // then
    expect(calls).toHaveLength(2)
    expect(isToolResultPatch(first[0])).toBe(true)
    expect(second).toEqual([undefined])
    expect(isToolResultPatch(third[0])).toBe(true)
  })
})
