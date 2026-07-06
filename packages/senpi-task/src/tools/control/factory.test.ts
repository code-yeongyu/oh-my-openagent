import { describe, expect, test } from "bun:test"

import { defaultResolveCallerSessionId } from "./caller-session"
import { TaskCancelParams, createTaskCancelTool } from "./cancel"
import { TaskInterruptParams, createTaskInterruptTool } from "./interrupt"
import { TaskSendParams, createTaskSendTool } from "./send"
import type { CancelManager, InterruptManager, SendManager, WaitManager } from "./types"
import { TaskWaitParams, createTaskWaitTool } from "./wait"

const sendManager: SendManager = { sendToTask: () => Promise.reject(new Error("unused")), list: () => [] }
const waitManager: WaitManager = { list: () => [], get: () => undefined, waitFor: () => Promise.reject(new Error("unused")) }
const interruptManager: InterruptManager = { interruptTask: () => Promise.reject(new Error("unused")) }
const cancelManager: CancelManager = { cancelTask: () => Promise.reject(new Error("unused")), get: () => undefined }

describe("control tool factories", () => {
  test("#given the four factories #when built #then names, labels, and TypeBox params are wired", () => {
    // given / when
    const send = createTaskSendTool({ manager: sendManager })
    const wait = createTaskWaitTool({ manager: waitManager, waitConfig: { min_ms: 5000, default_ms: 60000, max_ms: 600000 } })
    const interrupt = createTaskInterruptTool({ manager: interruptManager })
    const cancel = createTaskCancelTool({ manager: cancelManager })

    // then
    expect(send.name).toBe("task_send")
    expect(send.parameters).toBe(TaskSendParams)
    expect(wait.name).toBe("task_wait")
    expect(wait.parameters).toBe(TaskWaitParams)
    expect(interrupt.name).toBe("task_interrupt")
    expect(interrupt.parameters).toBe(TaskInterruptParams)
    expect(cancel.name).toBe("task_cancel")
    expect(cancel.parameters).toBe(TaskCancelParams)
    for (const tool of [send, wait, interrupt, cancel]) {
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
