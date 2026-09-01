import { describe, expect, test } from "bun:test"

import {
  TeamTaskAlreadyClaimedError,
  TeamTaskBlockedByError,
  TeamTaskCrossOwnerUpdateError,
  TeamTaskInvalidTransitionError,
} from "../../team"
import { createFakeTeamService, fakeTask } from "./__fixtures__/team-tool-fakes"
import {
  createTeamTaskCreateTool,
  createTeamTaskGetTool,
  createTeamTaskListTool,
  createTeamTaskUpdateTool,
  runTeamTaskCreate,
  runTeamTaskGet,
  runTeamTaskList,
  runTeamTaskUpdate,
} from "./tasks"

describe("task_create tool", () => {
  test("#given a new task #when create runs #then it reports the created task", async () => {
    const service = createFakeTeamService({ createTask: async () => fakeTask() })
    const result = await runTeamTaskCreate(service, { team_run_id: "run-1", subject: "s", description: "d" })
    expect(result.details).toMatchObject({ kind: "created" })
    const text = result.content[0]?.type === "text" ? result.content[0].text : ""
    expect(text).toContain("Created task task-1")
    expect(text).toContain("'do the thing'")
    expect(text).toContain("pending")
    expect(service.calls[0]).toMatchObject({
      method: "createTask",
      args: ["run-1", { subject: "s", description: "d", status: "pending" }],
    })
  })

  test("#given a blocked task #when create runs #then the text names the blockers", async () => {
    const service = createFakeTeamService({ createTask: async () => fakeTask({ blockedBy: ["task-0"] }) })
    const result = await runTeamTaskCreate(service, { team_run_id: "run-1", subject: "s", description: "d", blocked_by: ["task-0"] })
    const text = result.content[0]?.type === "text" ? result.content[0].text : ""
    expect(text).toContain("blocked by: task-0")
  })

  test("#given a subject with embedded newlines #when create runs #then the text collapses them onto one line", async () => {
    // given
    const service = createFakeTeamService({ createTask: async () => fakeTask({ subject: "line one\nline two" }) })

    // when
    const result = await runTeamTaskCreate(service, { team_run_id: "run-1", subject: "line one\nline two", description: "d" })

    // then
    const text = result.content[0]?.type === "text" ? result.content[0].text : ""
    expect(text).toContain("'line one line two'")
    expect(text.split("\n")).toHaveLength(1)
  })

  test("#given a subject with embedded newlines #when create runs #then the text collapses them onto one line", async () => {
    // given
    const service = createFakeTeamService({ createTask: async () => fakeTask({ subject: "line one\nline two" }) })

    // when
    const result = await runTeamTaskCreate(service, { team_run_id: "run-1", subject: "line one\nline two", description: "d" })

    // then
    const text = result.content[0]?.type === "text" ? result.content[0].text : ""
    expect(text).toContain("'line one line two'")
    expect(text.split("\n")).toHaveLength(1)
  })

  test("#given adversarial owner and blocked_by values #when list and get run #then the echoed fields are collapsed and bounded", async () => {
    // given
    const hostile = `x\ninjected ${"y".repeat(500)}`
    const task = fakeTask({ owner: hostile, blockedBy: [hostile], blocks: [hostile] })
    const service = createFakeTeamService({ listTasks: async () => [task], getTask: async () => task })

    // when
    const listed = await runTeamTaskList(service, { team_run_id: "run-1" })
    const fetched = await runTeamTaskGet(service, { team_run_id: "run-1", task_id: "task-1" })

    // then
    for (const result of [listed, fetched]) {
      const text = result.content[0]?.type === "text" ? result.content[0].text : ""
      expect(text).not.toContain("injected\n")
      expect(text).not.toContain(hostile)
    }
    const listText = listed.content[0]?.type === "text" ? listed.content[0].text : ""
    expect(listText).toContain("owner:x injected")
  })

  test("#given the factory #when built #then it names the tool task_create", () => {
    expect(createTeamTaskCreateTool({ service: createFakeTeamService() }).name).toBe("task_create")
  })
})

describe("task_list tool", () => {
  test("#given tasks #when list runs #then it reports them, forwarding the filter", async () => {
    const service = createFakeTeamService({ listTasks: async () => [fakeTask(), fakeTask({ id: "task-2", status: "claimed", owner: "alpha" })] })
    const result = await runTeamTaskList(service, { team_run_id: "run-1", status: "pending" })
    expect(result.details.kind).toBe("list")
    if (result.details.kind !== "list") throw new Error("expected list")
    expect(result.details.tasks).toHaveLength(2)
    const text = result.content[0]?.type === "text" ? result.content[0].text : ""
    const [firstLine = ""] = text.split("\n")
    expect(firstLine).toBe("2 task(s).")
    expect(text).toContain("- task-1 [pending] 'do the thing'")
    expect(text).toContain("- task-2 [claimed] owner:alpha 'do the thing'")
    expect(service.calls[0]).toMatchObject({ method: "listTasks", args: ["run-1", { status: "pending" }] })
  })

  test("#given the factory #when built #then it names the tool task_list", () => {
    expect(createTeamTaskListTool({ service: createFakeTeamService() }).name).toBe("task_list")
  })
})

describe("task_get tool", () => {
  test("#given an existing task #when get runs #then it reports the task", async () => {
    const service = createFakeTeamService({ getTask: async () => fakeTask({ owner: "alpha" }) })
    const result = await runTeamTaskGet(service, { team_run_id: "run-1", task_id: "task-1" })
    expect(result.details).toMatchObject({ kind: "task" })
    const text = result.content[0]?.type === "text" ? result.content[0].text : ""
    expect(text).toContain("Task task-1: pending.")
    expect(text).toContain("subject: do the thing")
    expect(text).toContain("owner: alpha")
    expect(text).toContain("description: details")
  })

  test("#given a missing task #when get runs #then it reports not_found", async () => {
    const service = createFakeTeamService({
      getTask: async () => {
        const error: NodeJS.ErrnoException = new Error("missing")
        error.code = "ENOENT"
        throw error
      },
    })
    const result = await runTeamTaskGet(service, { team_run_id: "run-1", task_id: "ghost" })
    expect(result.details).toMatchObject({ kind: "not_found", task_id: "ghost" })
  })

  test("#given the factory #when built #then it names the tool task_get", () => {
    expect(createTeamTaskGetTool({ service: createFakeTeamService() }).name).toBe("task_get")
  })
})

describe("task_update tool", () => {
  test("#given a status update #when update runs #then it reports the updated task", async () => {
    const service = createFakeTeamService({ updateTask: async () => fakeTask({ status: "in_progress" }) })
    const result = await runTeamTaskUpdate(service, { team_run_id: "run-1", task_id: "task-1", status: "in_progress" })
    expect(result.details).toMatchObject({ kind: "updated" })
    const text = result.content[0]?.type === "text" ? result.content[0].text : ""
    expect(text).toContain("Updated task task-1 to in_progress")
    expect(text).toContain("'do the thing'")
    expect(service.calls[0]).toMatchObject({
      method: "updateTask",
      args: [{ teamRunId: "run-1", taskId: "task-1", status: "in_progress" }],
    })
  })

  test("#given an already-claimed task #when claim runs #then it reports already_claimed", async () => {
    const service = createFakeTeamService({
      updateTask: async () => {
        throw new TeamTaskAlreadyClaimedError()
      },
    })
    const result = await runTeamTaskUpdate(service, { team_run_id: "run-1", task_id: "task-1", status: "claimed", owner: "alpha" })
    expect(result.details).toMatchObject({ kind: "already_claimed", task_id: "task-1" })
  })

  test("#given a blocked task #when claim runs #then it reports blocked_by", async () => {
    const service = createFakeTeamService({
      updateTask: async () => {
        throw new TeamTaskBlockedByError(["task-0"])
      },
    })
    const result = await runTeamTaskUpdate(service, { team_run_id: "run-1", task_id: "task-1", status: "claimed" })
    expect(result.details.kind).toBe("blocked_by")
  })

  test("#given an illegal transition #when update runs #then it reports invalid_transition", async () => {
    const service = createFakeTeamService({
      updateTask: async () => {
        throw new TeamTaskInvalidTransitionError("completed", "pending")
      },
    })
    const result = await runTeamTaskUpdate(service, { team_run_id: "run-1", task_id: "task-1", status: "pending" })
    expect(result.details.kind).toBe("invalid_transition")
  })

  test("#given a cross-owner update #when update runs #then it reports cross_owner", async () => {
    const service = createFakeTeamService({
      updateTask: async () => {
        throw new TeamTaskCrossOwnerUpdateError()
      },
    })
    const result = await runTeamTaskUpdate(service, { team_run_id: "run-1", task_id: "task-1", status: "completed", owner: "alpha" })
    expect(result.details.kind).toBe("cross_owner")
  })

  test("#given the factory #when built #then it names the tool task_update", () => {
    expect(createTeamTaskUpdateTool({ service: createFakeTeamService() }).name).toBe("task_update")
  })
})
