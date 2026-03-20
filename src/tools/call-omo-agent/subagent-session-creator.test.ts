import { describe, expect, test } from "bun:test"

import { resolveOrCreateSessionId } from "./subagent-session-creator"
import { _resetForTesting, subagentSessions } from "../../features/claude-code-session-state"

describe("call-omo-agent resolveOrCreateSessionId", () => {
  const originalPlatform = process.platform

  function buildInput(options: {
    parentDirectory?: string
    contextDirectory: string
  }): {
    ctx: Parameters<typeof resolveOrCreateSessionId>[0]
    args: Parameters<typeof resolveOrCreateSessionId>[1]
    toolContext: Parameters<typeof resolveOrCreateSessionId>[2]
    createCalls: Array<{ query?: { directory?: string } }>
  } {
    const createCalls: Array<{ query?: { directory?: string } }> = []
    const { parentDirectory, contextDirectory } = options
    const parentSessionData = parentDirectory ? { data: { directory: parentDirectory } } : { data: {} }

    const ctx = {
      directory: contextDirectory,
      client: {
        session: {
          get: async () => parentSessionData,
          create: async (createInput: unknown) => {
            const payload = createInput as { query?: { directory?: string } }
            createCalls.push(payload)
            return { data: { id: "ses_child_sync" } }
          },
        },
      },
    } as unknown as Parameters<typeof resolveOrCreateSessionId>[0]

    const args = {
      description: "sync test",
      prompt: "hello",
      subagent_type: "explore",
      run_in_background: false,
    } satisfies Parameters<typeof resolveOrCreateSessionId>[1]

    const toolContext = {
      sessionID: "ses_parent",
      messageID: "msg_parent",
      agent: "sisyphus",
      abort: new AbortController().signal,
    } satisfies Parameters<typeof resolveOrCreateSessionId>[2]

    return { ctx, args, toolContext, createCalls }
  }

  test("tracks newly created child session as subagent session", async () => {
    //#given
    _resetForTesting()

    const { ctx, args, toolContext, createCalls } = buildInput({
      parentDirectory: "/parent",
      contextDirectory: "/project",
    })

    //#when
    const result = await resolveOrCreateSessionId(ctx, args, toolContext)

    //#then
    expect(result).toEqual({ ok: true, sessionID: "ses_child_sync" })
    expect(createCalls).toHaveLength(1)
    expect(subagentSessions.has("ses_child_sync")).toBe(true)
  })

  test("uses current working directory on Windows when parent directory is under AppData", async () => {
    //#given
    _resetForTesting()
    Object.defineProperty(process, "platform", { value: "win32" })
    try {
      const { ctx, args, toolContext, createCalls } = buildInput({
        parentDirectory: "C:\\Users\\test\\AppData\\Local\\ai.opencode.desktop",
        contextDirectory: "C:\\Users\\test\\AppData\\Roaming\\opencode",
      })

      //#when
      await resolveOrCreateSessionId(ctx, args, toolContext)

      //#then
      expect(createCalls).toHaveLength(1)
      expect(createCalls[0]?.query?.directory).toBe(process.cwd())
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform })
    }
  })
})
