import { beforeEach, describe, expect, mock, test } from "bun:test"

const wakeOpenClawMock = mock(async () => null)

mock.module("../openclaw", () => ({
  wakeOpenClaw: wakeOpenClawMock,
}))

describe("createOpenClawHook", () => {
  beforeEach(() => {
    wakeOpenClawMock.mockClear()
  })

  test("maps session.created to session-start", async () => {
    const { createOpenClawHook } = await import("./openclaw")
    const hook = createOpenClawHook(
      { directory: "/tmp/project" } as any,
      { openclaw: { enabled: true } } as any,
    )

    await hook?.event?.({
      event: {
        type: "session.created",
        properties: { sessionID: "session-1" },
      },
    })

    expect(wakeOpenClawMock).toHaveBeenCalledWith(
      expect.anything(),
      "session-start",
      expect.objectContaining({
        projectPath: "/tmp/project",
        sessionId: "session-1",
      }),
    )
  })

  test("uses tool.execute.before for question tools", async () => {
    const { createOpenClawHook } = await import("./openclaw")
    const hook = createOpenClawHook(
      { directory: "/tmp/project" } as any,
      { openclaw: { enabled: true } } as any,
    )

    await hook?.["tool.execute.before"]?.(
      { tool: "ask_user_question", sessionID: "session-2" },
      { args: { questions: [{ question: "Need approval?", options: [{ label: "Yes" }] }] } },
    )

    expect(wakeOpenClawMock).toHaveBeenCalledWith(
      expect.anything(),
      "ask-user-question",
      expect.objectContaining({
        projectPath: "/tmp/project",
        question: "Need approval?",
        sessionId: "session-2",
      }),
    )
  })

  test("falls back to args.question string when questions array absent", async () => {
    const { createOpenClawHook } = await import("./openclaw")
    const hook = createOpenClawHook(
      { directory: "/tmp/project" } as any,
      { openclaw: { enabled: true } } as any,
    )

    await hook?.["tool.execute.before"]?.(
      { tool: "question", sessionID: "session-3" },
      { args: { question: "Fallback?" } },
    )

    expect(wakeOpenClawMock).toHaveBeenCalledWith(
      expect.anything(),
      "ask-user-question",
      expect.objectContaining({
        question: "Fallback?",
        sessionId: "session-3",
      }),
    )
  })
})
