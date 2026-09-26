import { describe, expect, it } from "bun:test"

import {
  createContext,
  createRecordingLogger,
  createTempCwd,
  createToolResultEvent,
  registerWithFakeRunner,
} from "./comment-checker.test-support"

const COULD_NOT_RUN = "omo-senpi comment-checker could not run; component disabled for this session"

describe("omo-senpi comment-checker that cannot start (#8850)", () => {
  it("#given a checker exiting outside its 0/2 protocol #when two edits finish #then it is reported once and not run again", async () => {
    // given
    const cwd = createTempCwd()
    const logger = createRecordingLogger()
    const { pi, calls } = await registerWithFakeRunner({
      logger,
      result: { hasComments: false, message: "", failure: { exitCode: 3221225781, stderr: "" } },
    })

    // when
    const first = await pi.dispatch("tool_result", createToolResultEvent(), createContext(cwd))
    const second = await pi.dispatch("tool_result", createToolResultEvent({ toolCallId: "tool-2", input: { path: "src/other.ts", edits: [] } }), createContext(cwd))

    // then
    expect(calls).toHaveLength(1)
    expect(first).toEqual([undefined])
    expect(second).toEqual([undefined])
    expect(logger.entries).toEqual([
      { level: "warn", message: COULD_NOT_RUN, details: { binaryPath: "/tmp/fake-comment-checker", exitCode: 3221225781, stderr: "" } },
    ])
  })

  it("#given a checker that follows its protocol #when two edits finish #then it keeps running without warnings", async () => {
    // given
    const cwd = createTempCwd()
    const logger = createRecordingLogger()
    const { pi, calls } = await registerWithFakeRunner({ logger, result: { hasComments: false, message: "" } })

    // when
    await pi.dispatch("tool_result", createToolResultEvent(), createContext(cwd))
    await pi.dispatch("tool_result", createToolResultEvent({ toolCallId: "tool-2", input: { path: "src/other.ts", edits: [] } }), createContext(cwd))

    // then
    expect(calls).toHaveLength(2)
    expect(logger.entries).toEqual([])
  })
})
