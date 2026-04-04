import { describe, expect, test, mock } from "bun:test"

import { createBackgroundNotificationHook } from "./hook"

describe("createBackgroundNotificationHook", () => {
  test("#given unsupported event type #when event handler runs #then it does not forward to manager", async () => {
    //#given
    const handleEvent = mock(() => {})
    const hook = createBackgroundNotificationHook({
      handleEvent,
      injectPendingNotificationsIntoChatMessage: () => {},
    } as never)

    //#when
    await hook.event({ event: { type: "message.removed", properties: { sessionID: "ses-1" } } })

    //#then
    expect(handleEvent).not.toHaveBeenCalled()
  })

  test("#given supported event type #when event handler runs #then it forwards to manager", async () => {
    //#given
    const handleEvent = mock(() => {})
    const hook = createBackgroundNotificationHook({
      handleEvent,
      injectPendingNotificationsIntoChatMessage: () => {},
    } as never)

    const event = { type: "message.part.delta", properties: { sessionID: "ses-1", field: "text", delta: "x" } }

    //#when
    await hook.event({ event })

    //#then
    expect(handleEvent).toHaveBeenCalledWith(event)
  })

  test("#given todo.updated event #when event handler runs #then it forwards to manager", async () => {
    //#given
    const handleEvent = mock(() => {})
    const hook = createBackgroundNotificationHook({
      handleEvent,
      injectPendingNotificationsIntoChatMessage: () => {},
    } as never)

    const event = {
      type: "todo.updated",
      properties: {
        sessionID: "ses-1",
        todos: [{ id: "todo-1", content: "done", status: "completed", priority: "high" }],
      },
    }

    //#when
    await hook.event({ event })

    //#then
    expect(handleEvent).toHaveBeenCalledWith(event)
  })
})
