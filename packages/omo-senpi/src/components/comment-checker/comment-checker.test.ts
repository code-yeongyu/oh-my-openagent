import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import {
  createBoundSessionContext,
  createContext,
  createRecordingLogger,
  createTempCwd,
  createToolResultEvent,
  registerWithFakeRunner,
} from "./comment-checker.test-support"
import { resolveSenpiCommentCheckerBinary } from "./index"

describe("omo-senpi comment-checker component", () => {
  it("#given built Senpi runs under Node #when inspecting runtime sources #then comment-checker has no Bun global dependency", () => {
    // given
    const runnerSource = readFileSync(new URL("./runner.ts", import.meta.url), "utf8")
    const resolverSource = readFileSync(new URL("./resolver.ts", import.meta.url), "utf8")

    // then
    expect(runnerSource).not.toMatch(/\bBun\b/)
    expect(resolverSource).not.toMatch(/\bBun\b/)
  })

  it("#given every binary resolution path is missing #when eligible results repeat #then inert notice logs once and runner is not called", async () => {
    // given
    const cwd = createTempCwd()
    const logger = createRecordingLogger()
    let pathCalls = 0
    const { pi, calls } = await registerWithFakeRunner({
      resolveBinary: () =>
        resolveSenpiCommentCheckerBinary({
          env: {},
          existsSync: () => false,
          importMetaUrl: import.meta.url,
          requireModule: () => ({}),
          pathLookup: () => {
            pathCalls += 1
            return null
          },
        }),
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
    expect(pathCalls).toBe(1)
    expect(logger.entries).toEqual([
      {
        level: "warn",
        message: "omo-senpi comment-checker binary unavailable; component disabled for this session",
      },
    ])
  })

  it("#given a context with updateToolHookStatus #when the check runs #then the live status label is reported once", async () => {
    // given
    const cwd = createTempCwd()
    const { pi, calls } = await registerWithFakeRunner()
    const statuses: string[] = []
    const context = {
      ...createContext(cwd),
      updateToolHookStatus(message: string) {
        statuses.push(message)
      },
    }

    // when
    await pi.dispatch("tool_result", createToolResultEvent(), context)

    // then
    expect(calls).toHaveLength(1)
    expect(statuses).toEqual(["(OmO) Checking Comments"])
  })

  it("#given a non-mutation tool result #when tool_result dispatches #then no live status is reported", async () => {
    // given
    const cwd = createTempCwd()
    const { pi, calls } = await registerWithFakeRunner()
    const statuses: string[] = []
    const context = {
      ...createContext(cwd),
      updateToolHookStatus(message: string) {
        statuses.push(message)
      },
    }

    // when
    await pi.dispatch("tool_result", createToolResultEvent({ toolName: "bash" }), context)

    // then
    expect(calls).toHaveLength(0)
    expect(statuses).toEqual([])
  })

  it("#given successful edit result #when tool_result dispatches #then runner receives the right absolute path", async () => {
    // given
    const cwd = createTempCwd()
    const { pi, calls } = await registerWithFakeRunner()

    // when
    await pi.dispatch("tool_result", createToolResultEvent(), createContext(cwd))

    // then
    expect(calls).toHaveLength(1)
    const filePath = calls[0]?.hookInput.tool_input.file_path
    expect(filePath).toBe(resolve(cwd, "src/example.ts"))
    expect(calls[0]?.hookInput.cwd).toBe(cwd)
    expect(calls[0]?.hookInput.tool_name).toBe("edit")
  })

  it("#given bound Senpi session manager #when tool_result dispatches #then runner receives session metadata", async () => {
    // given
    const cwd = createTempCwd()
    const { pi, calls } = await registerWithFakeRunner()

    // when
    await pi.dispatch("tool_result", createToolResultEvent(), createBoundSessionContext(cwd))

    // then
    expect(calls).toHaveLength(1)
    expect(calls[0]?.hookInput.session_id).toBe("session-1")
    expect(calls[0]?.hookInput.transcript_path).toBe("/tmp/transcript.jsonl")
  })

  it("#given successful write result #when tool_result dispatches #then runner receives the written file", async () => {
    // given
    const cwd = createTempCwd()
    const { pi, calls } = await registerWithFakeRunner()

    // when
    await pi.dispatch(
      "tool_result",
      createToolResultEvent({
        toolName: "write",
        input: { path: "/tmp/absolute-write.ts", content: "const value = 1\n" },
      }),
      createContext(cwd),
    )

    // then
    expect(calls).toHaveLength(1)
    expect(calls[0]?.hookInput.tool_input.file_path).toBe("/tmp/absolute-write.ts")
    expect(calls[0]?.hookInput.tool_name).toBe("write")
  })

  it("#given read and bash results #when tool_result dispatches #then silent non-edit tools do not trigger", async () => {
    // given
    const cwd = createTempCwd()
    const { pi, calls } = await registerWithFakeRunner()

    // when
    const readResults = await pi.dispatch(
      "tool_result",
      createToolResultEvent({ toolName: "read", input: { path: "src/example.ts" } }),
      createContext(cwd),
    )
    const bashResults = await pi.dispatch(
      "tool_result",
      createToolResultEvent({ toolName: "bash", input: { command: "echo hi" } }),
      createContext(cwd),
    )

    // then
    expect(calls).toHaveLength(0)
    expect(readResults).toEqual([undefined])
    expect(bashResults).toEqual([undefined])
  })

  it("#given failed edit and write results #when tool_result dispatches #then silent failures do not trigger", async () => {
    // given
    const cwd = createTempCwd()
    const { pi, calls } = await registerWithFakeRunner()

    // when
    const editResults = await pi.dispatch("tool_result", createToolResultEvent({ isError: true }), createContext(cwd))
    const writeResults = await pi.dispatch(
      "tool_result",
      createToolResultEvent({ toolName: "write", input: { path: "src/example.ts", content: "" }, isError: true }),
      createContext(cwd),
    )

    // then
    expect(calls).toHaveLength(0)
    expect(editResults).toEqual([undefined])
    expect(writeResults).toEqual([undefined])
  })

  it("#given missing path and bad payload #when tool_result dispatches #then malformed_input no-ops safely", async () => {
    // given
    const cwd = createTempCwd()
    const { pi, calls } = await registerWithFakeRunner()

    // when
    const missingPath = await pi.dispatch(
      "tool_result",
      createToolResultEvent({ input: { content: "no path" } }),
      createContext(cwd),
    )
    const badPayload = await pi.dispatch("tool_result", "not an event", createContext(cwd))

    // then
    expect(calls).toHaveLength(0)
    expect(missingPath).toEqual([undefined])
    expect(badPayload).toEqual([undefined])
  })
})
