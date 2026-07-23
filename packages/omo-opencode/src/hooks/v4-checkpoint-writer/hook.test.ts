/// <reference types="bun-types" />

import { describe, expect, test, mock, afterAll, beforeEach, afterEach } from "bun:test"
import { existsSync, readFileSync, rmSync, mkdtempSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const logMock = mock(() => {})

mock.module("../../shared/logger", () => ({
  log: logMock,
}))

afterAll(() => {
  mock.restore()
})

const { createV4CheckpointWriterHook } = await import("./hook")

describe("v4-checkpoint-writer", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "v4-checkpoint-test-"))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  test("#given V4 session reaching 20 tool calls #when tool.execute.after runs #then writes checkpoint file", () => {
    // given
    const hook = createV4CheckpointWriterHook({ directory: tempDir })
    const sessionID = "ses_v4_checkpoint"

    // simulate model detection
    hook.event({
      event: {
        type: "message.updated",
        properties: {
          info: { sessionID, modelID: "deepseek/deepseek-v4-pro", role: "assistant" },
        },
      },
    })

    // when — simulate 20 tool calls
    for (let i = 0; i < 20; i++) {
      hook["tool.execute.after"](
        { tool: "bash", sessionID, callID: `call_${i}` },
        { title: "", output: "result", metadata: null },
      )
    }

    // then
    const checkpointPath = join(tempDir, ".omo/checkpoints", `${sessionID}.json`)
    expect(existsSync(checkpointPath)).toBe(true)
    const checkpoint = JSON.parse(readFileSync(checkpointPath, "utf8"))
    expect(checkpoint.sessionID).toBe(sessionID)
    expect(checkpoint.modelID).toBe("deepseek/deepseek-v4-pro")
    expect(checkpoint.toolCallCount).toBe(20)
    expect(checkpoint.lastToolName).toBe("bash")
  })

  test("#given V4 session at 19 tool calls #when tool.execute.after runs #then does NOT write checkpoint", () => {
    // given
    const hook = createV4CheckpointWriterHook({ directory: tempDir })
    const sessionID = "ses_v4_no_checkpoint"

    hook.event({
      event: {
        type: "message.updated",
        properties: {
          info: { sessionID, modelID: "deepseek/deepseek-v4-flash", role: "assistant" },
        },
      },
    })

    // when — 19 tool calls (one short of the 20-call interval)
    for (let i = 0; i < 19; i++) {
      hook["tool.execute.after"](
        { tool: "read", sessionID, callID: `call_${i}` },
        { title: "", output: "result", metadata: null },
      )
    }

    // then
    const checkpointPath = join(tempDir, ".omo/checkpoints", `${sessionID}.json`)
    expect(existsSync(checkpointPath)).toBe(false)
  })

  test("#given non-V4 session at 20 tool calls #when tool.execute.after runs #then does NOT write checkpoint", () => {
    // given
    const hook = createV4CheckpointWriterHook({ directory: tempDir })
    const sessionID = "ses_non_v4"

    hook.event({
      event: {
        type: "message.updated",
        properties: {
          info: { sessionID, modelID: "anthropic/claude-sonnet-4-6", role: "assistant" },
        },
      },
    })

    // when
    for (let i = 0; i < 20; i++) {
      hook["tool.execute.after"](
        { tool: "bash", sessionID, callID: `call_${i}` },
        { title: "", output: "result", metadata: null },
      )
    }

    // then
    const checkpointPath = join(tempDir, ".omo/checkpoints", `${sessionID}.json`)
    expect(existsSync(checkpointPath)).toBe(false)
  })

  test("#given V4 session reaching 40 tool calls #when tool.execute.after runs #then writes 2nd checkpoint", () => {
    // given
    const hook = createV4CheckpointWriterHook({ directory: tempDir })
    const sessionID = "ses_v4_40"

    hook.event({
      event: {
        type: "message.updated",
        properties: {
          info: { sessionID, modelID: "deepseek/deepseek-v4-pro", role: "assistant" },
        },
      },
    })

    // when — 40 tool calls (two intervals)
    for (let i = 0; i < 40; i++) {
      hook["tool.execute.after"](
        { tool: "edit", sessionID, callID: `call_${i}` },
        { title: "", output: "result", metadata: null },
      )
    }

    // then — checkpoint should show 40 calls
    const checkpointPath = join(tempDir, ".omo/checkpoints", `${sessionID}.json`)
    expect(existsSync(checkpointPath)).toBe(true)
    const checkpoint = JSON.parse(readFileSync(checkpointPath, "utf8"))
    expect(checkpoint.toolCallCount).toBe(40)
  })
})
