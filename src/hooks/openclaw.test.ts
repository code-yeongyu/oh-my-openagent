import { beforeEach, describe, expect, mock, test } from "bun:test"

const wakeOpenClawMock = mock(async () => null)

mock.module("../openclaw", () => ({
  wakeOpenClaw: wakeOpenClawMock,
}))

describe("createOpenClawHook", () => {
  beforeEach(() => {
    wakeOpenClawMock.mockClear()
  })

  test("maps session.stop events to stop", async () => {
    const { createOpenClawHook } = await import("./openclaw")
    const hook = createOpenClawHook(
      { directory: "/tmp/project" } as any,
      { openclaw: { enabled: true } } as any,
    )

    await hook?.event?.({
      event: {
        type: "session.stop",
        properties: { sessionID: "session-1" },
      },
    })

    expect(wakeOpenClawMock).toHaveBeenCalledWith(
      expect.anything(),
      "stop",
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
      { args: { question: "Need approval?" } },
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
})
