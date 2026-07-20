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
    expect(service.calls[0]).toMatchObject({
      method: "createTask",
      args: ["run-1", { subject: "s", description: "d", status: "pending" }],
    })
  })

  test("#given the factory #when built #then it names the tool task_create", () => {
    expect(createTeamTaskCreateTool({ service: createFakeTeamService() }).name).toBe("task_create")
  })
})

describe("task_list tool", () => {
  test("#given tasks #when list runs #then it reports them, forwarding the filter", async () => {
    const service = createFakeTeamService({ listTasks: async () => [fakeTask(), fakeTask({ id: "task-2" })] })
    const result = await runTeamTaskList(service, { team_run_id: "run-1", status: "pending" })
    expect(result.details.kind).toBe("list")
    if (result.details.kind !== "list") throw new Error("expected list")
    expect(result.details.tasks).toHaveLength(2)
    expect(service.calls[0]).toMatchObject({ method: "listTasks", args: ["run-1", { status: "pending" }] })
  })

  test("#given the factory #when built #then it names the tool task_list", () => {
    expect(createTeamTaskListTool({ service: createFakeTeamService() }).name).toBe("task_list")
  })
})

describe("task_get tool", () => {
  test("#given an existing task #when get runs #then it reports the task", async () => {
    const service = createFakeTeamService({ getTask: async () => fakeTask() })
    const result = await runTeamTaskGet(service, { team_run_id: "run-1", task_id: "task-1" })
    expect(result.details).toMatchObject({ kind: "task" })
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
