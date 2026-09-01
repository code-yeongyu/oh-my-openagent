import { describe, expect, test } from "bun:test"

import type { SendInput } from "../../steering"
import { renderTaskSendCall } from "./renderers"
import { createTaskSendTool, runTaskSend } from "./send"
import type { SendManager } from "./types"

const unusedManager: SendManager = {
  sendToTask: () => Promise.resolve({ kind: "not_found", reason: "unused", suggestion: "unused" }),
  list: () => [],
}

describe("task_send always-steer surface", () => {
  test("#given the lead task_send tool #when its public contract is inspected #then delivery mode is absent", () => {
    const tool = createTaskSendTool({ manager: unusedManager })
    const parameterNames = Object.keys(tool.parameters.properties)

    expect(parameterNames).not.toContain("deliver_as")
    expect(tool.description).not.toContain("deliver_as")
    expect(tool.description).not.toContain("followUp")
    expect(tool.description).not.toContain("interrupt")
  })

  test("#given a plain child message #when task_send routes it #then it requests steer unconditionally", async () => {
    const sendCalls: SendInput[] = []
    const manager: SendManager = {
      ...unusedManager,
      sendToTask: (input) => {
        sendCalls.push(input)
        return Promise.resolve({ kind: "steered", task_id: "st_1", status: "running", delivered: "steer" })
      },
    }

    const result = await runTaskSend(manager, { to: "st_1", message: "new direction" }, "parent-1")

    expect(result.details).toMatchObject({ kind: "steered", delivered: "steer" })
    expect(sendCalls).toEqual([
      {
        idOrName: "st_1",
        message: "new direction",
        deliverAs: "steer",
        callerSessionId: "parent-1",
      },
    ])
  })

  test("#given a plain task_send call #when rendered #then no delivery option is shown", () => {
    const component = renderTaskSendCall(
      { to: "st_1", message: "new direction" },
      {
        fg: (_color, text) => text,
        italic: (text) => text,
      },
    )

    const line = component.render(120)[0] ?? ""
    expect(line).toContain("task_send to:st_1")
    expect(line).not.toContain("deliver:")
    expect(line).toContain("new direction")
  })
})
