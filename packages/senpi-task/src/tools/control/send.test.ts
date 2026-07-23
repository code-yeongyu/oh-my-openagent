import { afterEach, describe, expect, test } from "bun:test"

import type { InterruptOutcome, SendInput, SendOutcome } from "../../steering"
import { baseSpec, cleanupProjects, makeManager } from "../../manager/__fixtures__/manager-fakes"
import { createMemberScopedTaskSendTool, createTaskSendTool, runTaskSend } from "./send"
import type { TeamToolsService } from "../team/types"
import type { SendManager } from "./types"

afterEach(cleanupProjects)

function spyManager(
  outcome: SendOutcome,
  interruptOutcome: InterruptOutcome = { kind: "not_found", reason: "unused" },
): { manager: SendManager; sendCalls: SendInput[]; interruptCalls: string[] } {
  const sendCalls: SendInput[] = []
  const interruptCalls: string[] = []
  const manager: SendManager = {
    sendToTask: (input) => {
      sendCalls.push(input)
      return Promise.resolve(outcome)
    },
    interruptTask: (input) => {
      interruptCalls.push(input.idOrName)
      return Promise.resolve(interruptOutcome)
    },
    list: () => [],
  }
  return { manager, sendCalls, interruptCalls }
}

function fail(name: string): never {
  throw new Error(`fake TeamToolsService.${name} not configured`)
}

const fakeTeamToolsService: TeamToolsService = {
  createTeam: () => Promise.resolve(fail("createTeam")),
  deleteTeam: () => Promise.resolve(fail("deleteTeam")),
  sendMessage: () => Promise.resolve(fail("sendMessage")),
  status: () => Promise.resolve(fail("status")),
  listTeams: () => Promise.resolve(fail("listTeams")),
  createTask: () => Promise.resolve(fail("createTask")),
  listTasks: () => Promise.resolve(fail("listTasks")),
  updateTask: () => Promise.resolve(fail("updateTask")),
  getTask: () => Promise.resolve(fail("getTask")),
  requestShutdown: () => Promise.resolve(fail("requestShutdown")),
  approveShutdown: () => Promise.resolve(fail("approveShutdown")),
  rejectShutdown: () => Promise.resolve(fail("rejectShutdown")),
}

describe("runTaskSend", () => {
  test("#given task_send tool factories #when tools are created #then both expose custom call and result renderers", () => {
    const { manager } = spyManager({ kind: "not_found", reason: "unused", suggestion: "unused" })

    const leadTool = createTaskSendTool({ manager })
    const memberTool = createMemberScopedTaskSendTool({
      manager,
      service: fakeTeamToolsService,
      teamRunId: "team-run-1",
      from: "atlas",
    })

    expect(typeof leadTool.renderCall).toBe("function")
    expect(typeof leadTool.renderResult).toBe("function")
    expect(typeof memberTool.renderCall).toBe("function")
    expect(typeof memberTool.renderResult).toBe("function")
  })

  test("#given a running child #when a message is sent #then it is delivered as followUp by default", async () => {
    const { manager } = makeManager({})
    const started = await manager.start(baseSpec({ parent_session_id: "p1" }))
    if (started.kind !== "started") throw new Error("expected started")

    const result = await runTaskSend(manager, { to: started.task_id, message: "keep going" }, "p1")

    expect(result.details.kind).toBe("steered")
    if (result.details.kind !== "steered") throw new Error("expected steered")
    expect(result.details.delivered).toBe("followUp")
    expect(result.details.task_id).toBe(started.task_id)
  })

  test("#given a caller session id #when sending #then callerSessionId is injected into the steering call", async () => {
    const { manager, sendCalls } = spyManager({ kind: "steered", task_id: "st_00000001", status: "running", delivered: "followUp" })

    await runTaskSend(manager, { to: "st_00000001", message: "hi" }, "session-42")

    expect(sendCalls[0]?.callerSessionId).toBe("session-42")
  })

  test("#given interrupt park mode #when sent without a message #then it calls interrupt before child send", async () => {
    const { manager, sendCalls, interruptCalls } = spyManager(
      { kind: "not_found", reason: "unused", suggestion: "unused" },
      { kind: "interrupted", task_id: "st_00000001", previous_status: "running" },
    )

    const result = await runTaskSend(manager, { to: "st_00000001", deliver_as: "interrupt" }, "session-42")

    expect(result.details).toEqual({ kind: "interrupted", task_id: "st_00000001", previous_status: "running" })
    expect(interruptCalls).toEqual(["st_00000001"])
    expect(sendCalls).toEqual([])
  })

  test("#given a child owned by another session #when interrupt parks without all_scope #then scope is denied before interrupt", async () => {
    const { manager } = makeManager({})
    const started = await manager.start(baseSpec({ parent_session_id: "owner-session" }))
    if (started.kind !== "started") throw new Error("expected started")

    const result = await runTaskSend(manager, { to: started.task_id, deliver_as: "interrupt" }, "intruder-session")

    expect(result.details.kind).toBe("scope_denied")
    if (result.details.kind !== "scope_denied") throw new Error("expected scope_denied")
    expect(result.details.owning_session_id).toBe("owner-session")
    expect(manager.get(started.task_id)?.status).toBe("running")
  })

  test("#given interrupt park mode with a string message #when sent #then it is rejected before routing", async () => {
    const { manager, sendCalls, interruptCalls } = spyManager({ kind: "not_found", reason: "unused", suggestion: "unused" })

    const result = await runTaskSend(manager, { to: "st_00000001", deliver_as: "interrupt", message: "park and say this" }, "session-42")

    expect(result.details.kind).toBe("invalid_arguments")
    if (result.details.kind !== "invalid_arguments") throw new Error("expected invalid_arguments")
    expect(result.details.reason).toContain("interrupt is a pure park")
    expect(sendCalls).toEqual([])
    expect(interruptCalls).toEqual([])
  })

  test("#given structured messages with deliver_as #when sent #then deliver_as is rejected as plain-text-only", async () => {
    const { manager } = spyManager({ kind: "not_found", reason: "unused", suggestion: "unused" })

    const interruptResult = await runTaskSend(
      manager,
      { to: "alpha", deliver_as: "interrupt", message: { type: "shutdown_request" } },
      "lead-session",
    )
    const steerResult = await runTaskSend(
      manager,
      { to: "alpha", deliver_as: "steer", message: { type: "shutdown_request" } },
      "lead-session",
    )

    expect(interruptResult.details).toEqual({
      kind: "invalid_arguments",
      reason: "deliver_as applies only to plain-text messages",
    })
    expect(steerResult.details).toEqual({
      kind: "invalid_arguments",
      reason: "deliver_as applies only to plain-text messages",
    })
  })

  test("#given plain-text send without a message #when sent #then it is rejected before routing", async () => {
    const { manager, sendCalls } = spyManager({ kind: "not_found", reason: "unused", suggestion: "unused" })

    const defaultResult = await runTaskSend(manager, { to: "alpha" }, "lead-session")
    const steerResult = await runTaskSend(manager, { to: "alpha", deliver_as: "steer" }, "lead-session")
    const followUpResult = await runTaskSend(manager, { to: "alpha", deliver_as: "followUp" }, "lead-session")

    for (const result of [defaultResult, steerResult, followUpResult]) {
      expect(result.details).toEqual({ kind: "invalid_arguments", reason: "message is required" })
    }
    expect(sendCalls).toEqual([])
  })

  test("#given a child owned by another session #when sent without all_scope #then scope is denied naming the owner", async () => {
    const { manager } = makeManager({})
    const started = await manager.start(baseSpec({ parent_session_id: "owner-session" }))
    if (started.kind !== "started") throw new Error("expected started")

    const result = await runTaskSend(manager, { to: started.task_id, message: "hi" }, "intruder-session")

    expect(result.details.kind).toBe("scope_denied")
    if (result.details.kind !== "scope_denied") throw new Error("expected scope_denied")
    expect(result.details.owning_session_id).toBe("owner-session")
    expect(result.content[0]?.type === "text" && result.content[0].text).toContain("owner-session")
  })

  test("#given an unknown name #when sending #then not_found lists this session's task names", async () => {
    const { manager } = makeManager({})
    const started = await manager.start(baseSpec({ parent_session_id: "p1", name: "alpha" }))
    if (started.kind !== "started") throw new Error("expected started")

    const result = await runTaskSend(manager, { to: "ghost", message: "hi" }, "p1")

    expect(result.details.kind).toBe("not_found")
    if (result.details.kind !== "not_found") throw new Error("expected not_found")
    expect(result.details.known_tasks).toContain("alpha")
    expect(result.content[0]?.type === "text" && result.content[0].text).toContain("alpha")
  })

  test("#given a string recipient that is not a child and no team routing #when sent #then the child not_found result is preserved", async () => {
    const { manager } = spyManager({ kind: "not_found", reason: "No task found for \"ghost\".", suggestion: "unused" })

    const result = await runTaskSend(manager, { to: "ghost", message: "hi" }, "p1")

    expect(result.details.kind).toBe("not_found")
  })

  test("#given a cancelled child #when task_send targets it #then it is not continuable", async () => {
    const { manager } = makeManager({})
    const started = await manager.start(baseSpec({ parent_session_id: "p1" }))
    if (started.kind !== "started") throw new Error("expected started")
    await manager.cancelTask(started.task_id, "done", "p1")

    const result = await runTaskSend(manager, { to: started.task_id, message: "revive?" }, "p1")

    expect(result.details.kind).toBe("not_continuable")
  })
})
