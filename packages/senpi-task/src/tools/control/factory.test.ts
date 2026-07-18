import { describe, expect, test } from "bun:test"

import { defaultResolveCallerSessionId } from "./caller-session"
import { TaskCancelParams, createTaskCancelTool } from "./cancel"
import { TaskSendParams, createMemberScopedTaskSendTool, createTaskSendTool } from "./send"
import { createFakeTeamService } from "../team/__fixtures__/team-tool-fakes"
import type { CancelManager, SendManager } from "./types"

const sendManager: SendManager = {
  sendToTask: () => Promise.reject(new Error("unused")),
  interruptTask: () => Promise.reject(new Error("unused")),
  list: () => [],
}
const cancelManager: CancelManager = { cancelTask: () => Promise.reject(new Error("unused")), get: () => undefined }

describe("control tool factories", () => {
  test("#given the control factories #when built #then names, labels, and TypeBox params are wired", () => {
    // given / when
    const send = createTaskSendTool({ manager: sendManager })
    const cancel = createTaskCancelTool({ manager: cancelManager })
    const memberSend = createMemberScopedTaskSendTool({
      manager: sendManager,
      service: createFakeTeamService(),
      teamRunId: "run-1",
      from: "alpha",
    })

    // then
    expect(send.name).toBe("task_send")
    expect(send.parameters).toBe(TaskSendParams)
    expect(memberSend.name).toBe("task_send")
    expect(memberSend.parameters).toBe(TaskSendParams)
    expect(cancel.name).toBe("task_cancel")
    expect(cancel.parameters).toBe(TaskCancelParams)
    for (const tool of [send, memberSend, cancel]) {
      expect(tool.description.length).toBeGreaterThan(0)
      expect(tool.label.length).toBeGreaterThan(0)
    }
  })

  test("#given the default resolver #when a session carrier is passed #then the current session id is read", () => {
    // given
    const carrier = { sessionManager: { getSessionId: () => "session-live" } }

    // when
    const resolved = defaultResolveCallerSessionId(carrier)

    // then
    expect(resolved).toBe("session-live")
  })
})
