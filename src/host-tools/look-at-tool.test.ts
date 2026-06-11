import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createTargetLookAtTool } from "./look-at-tool"

let tempFile = ""

afterEach(() => {
  if (tempFile) rmSync(tempFile, { force: true })
  tempFile = ""
})

describe("target look_at tool", () => {
  test("#given a file path #when target look at runs #then it invokes target print mode with an attachment", async () => {
    tempFile = join(tmpdir(), `omo-look-at-${process.pid}.png`)
    writeFileSync(tempFile, Buffer.from("iVBORw0KGgo=", "base64"))
    const calls: Array<{ args: string[]; cwd: string }> = []
    const tool = createTargetLookAtTool("pi", "/project", {
      runCli: async (_host, args, cwd) => {
        calls.push({ args, cwd })
        return { stdout: "detected text", stderr: "", exitCode: 0 }
      },
    })

    const result = await tool.execute({
      toolCallId: "call-1",
      name: "look_at",
      input: { file_path: tempFile, goal: "read the label" },
      session: {
        id: "target-session",
        cwd: "/project",
        actions: {
          sendUserMessage: async () => {},
          sendInternalMessage: async () => {},
          appendEntry: async () => {},
          getSessionName: () => undefined,
          setSessionName: async () => {},
          getContextUsage: () => undefined,
          compact: async () => {},
          abort: () => {},
          isIdle: () => true,
          hasPendingMessages: () => false,
        },
      },
    })

    expect(result.content[0]).toMatchObject({ type: "text", text: "detected text" })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.cwd).toBe("/project")
    expect(calls[0]?.args).toContain("--print")
    expect(calls[0]?.args).toContain("--mode")
    expect(calls[0]?.args).toContain(`@${tempFile}`)
  })

  test("#given base64 image data #when target look at runs #then it materializes a temporary attachment", async () => {
    let observedAttachment = ""
    const tool = createTargetLookAtTool("oh-my-pi", "/project", {
      runCli: async (_host, args) => {
        observedAttachment = args.find((arg) => arg.startsWith("@"))?.slice(1) ?? ""
        expect(existsSync(observedAttachment)).toBe(true)
        return { stdout: "clipboard text", stderr: "", exitCode: 0 }
      },
    })

    const result = await tool.execute({
      toolCallId: "call-1",
      name: "look_at",
      input: { image_data: "data:image/png;base64,iVBORw0KGgo=", goal: "read the image" },
      session: {
        id: "target-session",
        cwd: "/project",
        actions: {
          sendUserMessage: async () => {},
          sendInternalMessage: async () => {},
          appendEntry: async () => {},
          getSessionName: () => undefined,
          setSessionName: async () => {},
          getContextUsage: () => undefined,
          compact: async () => {},
          abort: () => {},
          isIdle: () => true,
          hasPendingMessages: () => false,
        },
      },
    })

    expect(result.content[0]).toMatchObject({ type: "text", text: "clipboard text" })
    expect(observedAttachment).toContain("omo-target-look-at-")
    expect(existsSync(observedAttachment)).toBe(false)
  })
})
