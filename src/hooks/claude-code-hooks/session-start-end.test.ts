import { describe, expect, mock, test } from "bun:test"

const mockDispatchHook = mock(async () => ({ exitCode: 0, stdout: "", stderr: "" }))

mock.module("./dispatch-hook", () => ({
  dispatchHook: mockDispatchHook,
  getHookIdentifier: (h: { type: string; command?: string; url?: string }) =>
    h.type === "http" ? (h.url ?? "") : (h.command ?? "").split("/").pop() ?? "",
}))

const { executeSessionStartHooks } = await import("./session-start")
const { executeSessionEndHooks } = await import("./session-end")

describe("executeSessionStartHooks", () => {
  test("#given null config #when invoked #then returns empty context with no dispatch", async () => {
    mockDispatchHook.mockClear()
    const result = await executeSessionStartHooks(
      { sessionId: "s1", cwd: "/tmp", source: "startup" },
      null,
    )
    expect(result.additionalContext).toEqual([])
    expect(mockDispatchHook).toHaveBeenCalledTimes(0)
  })

  test("#given SessionStart matchers #when invoked #then each command is dispatched with correct stdin", async () => {
    mockDispatchHook.mockClear()
    mockDispatchHook.mockImplementation(async (_hook, stdin) => {
      const parsed = JSON.parse(stdin) as Record<string, unknown>
      expect(parsed.hook_event_name).toBe("SessionStart")
      expect(parsed.session_id).toBe("s_start")
      expect(parsed.source).toBe("startup")
      expect(parsed.cwd).toBe("/work")
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "SessionStart",
            additionalContext: "memory snapshot loaded",
          },
        }),
      }
    })

    const result = await executeSessionStartHooks(
      { sessionId: "s_start", cwd: "/work", source: "startup" },
      {
        SessionStart: [
          {
            matcher: "*",
            hooks: [{ type: "command", command: "/usr/bin/load-memory" }],
          },
        ],
      },
    )

    expect(mockDispatchHook).toHaveBeenCalledTimes(1)
    expect(result.additionalContext).toEqual(["memory snapshot loaded"])
  })
})

describe("executeSessionEndHooks", () => {
  test("#given null config #when invoked #then no dispatch happens", async () => {
    mockDispatchHook.mockClear()
    const result = await executeSessionEndHooks(
      { sessionId: "s1", cwd: "/tmp", reason: "logout" },
      null,
    )
    expect(result).toEqual({})
    expect(mockDispatchHook).toHaveBeenCalledTimes(0)
  })

  test("#given SessionEnd matchers #when invoked #then commands are dispatched with reason", async () => {
    mockDispatchHook.mockClear()
    mockDispatchHook.mockImplementation(async (_hook, stdin) => {
      const parsed = JSON.parse(stdin) as Record<string, unknown>
      expect(parsed.hook_event_name).toBe("SessionEnd")
      expect(parsed.session_id).toBe("s_end")
      expect(parsed.reason).toBe("logout")
      return { exitCode: 0, stdout: "" }
    })

    await executeSessionEndHooks(
      { sessionId: "s_end", cwd: "/work", reason: "logout" },
      {
        SessionEnd: [
          {
            matcher: "*",
            hooks: [
              { type: "command", command: "/usr/bin/cleanup" },
              { type: "command", command: "/usr/bin/flush-logs" },
            ],
          },
        ],
      },
    )

    expect(mockDispatchHook).toHaveBeenCalledTimes(2)
  })

  test("#given SessionEnd with no reason #when invoked #then reason defaults to 'other'", async () => {
    mockDispatchHook.mockClear()
    mockDispatchHook.mockImplementation(async (_hook, stdin) => {
      const parsed = JSON.parse(stdin) as Record<string, unknown>
      expect(parsed.reason).toBe("other")
      return { exitCode: 0, stdout: "" }
    })

    await executeSessionEndHooks(
      { sessionId: "s_end", cwd: "/work" },
      {
        SessionEnd: [
          { matcher: "*", hooks: [{ type: "command", command: "/usr/bin/cleanup" }] },
        ],
      },
    )

    expect(mockDispatchHook).toHaveBeenCalledTimes(1)
  })
})
