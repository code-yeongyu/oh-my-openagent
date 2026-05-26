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

  test("#given session.next stream event #when event handler runs #then it forwards to manager", async () => {
    //#given
    const handleEvent = mock(() => {})
    const hook = createBackgroundNotificationHook({
      handleEvent,
      injectPendingNotificationsIntoChatMessage: () => {},
    } as never)

    const event = { type: "session.next.text.delta", properties: { sessionID: "ses-1", delta: "x" } }

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

  test("#given chat.message handler #when called #then injects pending notifications", async () => {
    //#given
    const injectPendingNotificationsIntoChatMessage = mock((_output: unknown, _sessionID: string) => {})
    const hook = createBackgroundNotificationHook({
      handleEvent: () => {},
      injectPendingNotificationsIntoChatMessage,
    } as never)

    const input = { sessionID: "ses-1" }
    const output = { parts: [{ type: "text", text: "hello" }] }

    //#when
    await hook["chat.message"](input, output)

    //#then
    expect(injectPendingNotificationsIntoChatMessage).toHaveBeenCalledWith(output, "ses-1")
  })

  test("#given session.idle event #when event handler runs #then it forwards to manager", async () => {
    //#given
    const handleEvent = mock(() => {})
    const hook = createBackgroundNotificationHook({
      handleEvent,
      injectPendingNotificationsIntoChatMessage: () => {},
    } as never)

    const event = { type: "session.idle", properties: { sessionID: "ses-1" } }

    //#when
    await hook.event({ event })

    //#then
    expect(handleEvent).toHaveBeenCalledWith(event)
  })

  test("#given session.error event #when event handler runs #then it forwards to manager", async () => {
    //#given
    const handleEvent = mock(() => {})
    const hook = createBackgroundNotificationHook({
      handleEvent,
      injectPendingNotificationsIntoChatMessage: () => {},
    } as never)

    const event = { type: "session.error", properties: { sessionID: "ses-1", error: "timeout" } }

    //#when
    await hook.event({ event })

    //#then
    expect(handleEvent).toHaveBeenCalledWith(event)
  })

  test("#given session.deleted event #when event handler runs #then it forwards to manager", async () => {
    //#given
    const handleEvent = mock(() => {})
    const hook = createBackgroundNotificationHook({
      handleEvent,
      injectPendingNotificationsIntoChatMessage: () => {},
    } as never)

    const event = { type: "session.deleted", properties: { sessionID: "ses-1" } }

    //#when
    await hook.event({ event })

    //#then
    expect(handleEvent).toHaveBeenCalledWith(event)
  })

  test("#given message.updated event #when event handler runs #then it forwards to manager", async () => {
    //#given
    const handleEvent = mock(() => {})
    const hook = createBackgroundNotificationHook({
      handleEvent,
      injectPendingNotificationsIntoChatMessage: () => {},
    } as never)

    const event = { type: "message.updated", properties: { sessionID: "ses-1" } }

    //#when
    await hook.event({ event })

    //#then
    expect(handleEvent).toHaveBeenCalledWith(event)
  })

  test("#given session.next.tool_call.delta prefix event #when event handler runs #then it forwards", async () => {
    //#given
    const handleEvent = mock(() => {})
    const hook = createBackgroundNotificationHook({
      handleEvent,
      injectPendingNotificationsIntoChatMessage: () => {},
    } as never)

    const event = { type: "session.next.tool_call.delta", properties: { sessionID: "ses-1" } }

    //#when
    await hook.event({ event })

    //#then
    expect(handleEvent).toHaveBeenCalledWith(event)
  })

  test("#given unknown event type #when event handler runs #then it does not forward", async () => {
    //#given
    const handleEvent = mock(() => {})
    const hook = createBackgroundNotificationHook({
      handleEvent,
      injectPendingNotificationsIntoChatMessage: () => {},
    } as never)

    //#when
    await hook.event({ event: { type: "custom.unknown.event", properties: {} } })

    //#then
    expect(handleEvent).not.toHaveBeenCalled()
  })
})
