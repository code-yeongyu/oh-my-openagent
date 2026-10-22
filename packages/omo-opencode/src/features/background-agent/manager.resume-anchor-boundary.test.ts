import { afterEach, describe, expect, test } from "bun:test"
import type { BackgroundManager } from "./manager"
import { createCompletedTask, createManagerWithMessages, previousRunMessages, resumeInput } from "./resume-anchor-test-fixture"

let manager: BackgroundManager | undefined
afterEach(async () => { await manager?.shutdown(); manager = undefined })

describe("resume anchor read boundary", () => {
  test("restores admission when capture never settles", async () => {
    //#given
    const fixture = createManagerWithMessages(previousRunMessages())
    manager = fixture.manager
    const task = createCompletedTask()
    manager["tasks"].set(task.id, task)
    fixture.client.session.messages = () => new Promise(() => {})
    //#when
    await manager.resume(resumeInput)
    //#then
    expect(task.status).toBe("completed")
    expect(task.concurrencyKey).toBeUndefined()
    expect(fixture.prompts).toHaveLength(0)
  }, 7_000)

  test("releases the poll loop when verification never settles", async () => {
    //#given
    const fixture = createManagerWithMessages(previousRunMessages())
    manager = fixture.manager
    const task = createCompletedTask()
    task.status = "running"
    task.resumeAnchor = { anchorMessageCount: 2, anchorMessageID: "msg_prev_answer" }
    manager["tasks"].set(task.id, task)
    fixture.client.session.messages = () => new Promise(() => {})
    //#when
    await manager["pollRunningTasks"]()
    //#then
    expect(task.status).toBe("running")
    expect(manager["pollingInFlight"]).toBe(false)
    expect(fixture.aborts).toHaveLength(0)
  }, 7_000)

  test("captures and verifies output in the child's working directory", async () => {
    //#given
    const messages = previousRunMessages()
    const fixture = createManagerWithMessages(messages)
    manager = fixture.manager
    const task = createCompletedTask()
    task.cwd = "/synthetic/worktree"
    const reads: Array<string | undefined> = []
    fixture.client.session.messages = async (request) => {
      reads.push(request?.query?.directory)
      return request?.query?.directory === task.cwd ? { data: messages } : { error: { name: "NotFound" } }
    }
    manager["tasks"].set(task.id, task)
    await manager.resume(resumeInput)
    messages.push({ info: { id: "msg_answer", role: "assistant", time: { completed: 2 } }, parts: [{ type: "text", text: "done" }] })
    //#when
    const advanced = await manager["sessionHasMessagesAfterAnchor"](resumeInput.sessionId, task)
    //#then
    expect(advanced).toBe(true)
    expect(reads.length).toBeGreaterThanOrEqual(2)
    expect(reads.every((directory) => directory === task.cwd)).toBe(true)
  })

  test("does not mistake compacted old output for resumed output", async () => {
    //#given
    const messages = previousRunMessages()
    const fixture = createManagerWithMessages(messages)
    manager = fixture.manager
    const task = createCompletedTask()
    manager["tasks"].set(task.id, task)
    await manager.resume(resumeInput)
    messages.pop()
    //#when
    const advanced = await manager["sessionHasMessagesAfterAnchor"](resumeInput.sessionId, task)
    //#then
    expect(advanced).toBe(false)
  })

  test("accepts new output even when compaction removed the anchor", async () => {
    //#given
    const messages = previousRunMessages()
    const fixture = createManagerWithMessages(messages)
    manager = fixture.manager
    const task = createCompletedTask()
    manager["tasks"].set(task.id, task)
    await manager.resume(resumeInput)
    messages.splice(0, messages.length, { info: { id: "msg_compacted_new", role: "assistant" }, parts: [{ type: "text", text: "new" }] })
    //#when
    const advanced = await manager["sessionHasMessagesAfterAnchor"](resumeInput.sessionId, task)
    //#then
    expect(advanced).toBe(true)
  })
})
