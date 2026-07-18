import { describe, expect, it } from "bun:test"

import { TaskSchema, RuntimeStateSchema } from "@oh-my-opencode/team-core/types"

import { buildTeamsProjection, selectCurrentWork } from "./team-projection"
import type { RuntimeState, Task } from "@oh-my-opencode/team-core/types"

const CURRENT_PROJECT = "/tmp/omo-team-current"
const OTHER_PROJECT = "/tmp/omo-team-other"
const CURRENT_RUN_ID = "11111111-1111-4111-8111-111111111111"
const OTHER_RUN_ID = "22222222-2222-4222-8222-222222222222"

function runtime(input: {
  readonly teamRunId: string
  readonly teamName: string
  readonly leadSessionId: string
  readonly members: RuntimeState["members"]
}): RuntimeState {
  return RuntimeStateSchema.parse({
    version: 1,
    teamRunId: input.teamRunId,
    teamName: input.teamName,
    specSource: "project",
    createdAt: 1,
    status: "active",
    leadSessionId: input.leadSessionId,
    members: input.members,
    shutdownRequests: [],
    bounds: {
      maxMembers: 8,
      maxParallelMembers: 4,
      maxMessagesPerRun: 10_000,
      maxWallClockMinutes: 120,
      maxMemberTurns: 500,
    },
  })
}

function task(input: {
  readonly id: string
  readonly subject: string
  readonly activeForm?: string
  readonly status: Task["status"]
  readonly owner?: string
  readonly updatedAt: number
}): Task {
  return TaskSchema.parse({
    version: 1,
    id: input.id,
    subject: input.subject,
    description: "private task description",
    activeForm: input.activeForm,
    status: input.status,
    owner: input.owner,
    blocks: [],
    blockedBy: [],
    createdAt: 1,
    updatedAt: input.updatedAt,
  })
}

describe("team sidebar projection", () => {
  it("#given global runtime teams #when projecting for a project #then it keeps only teams with a project session and preserves idle members", async () => {
    // given
    const currentRuntime = runtime({
      teamRunId: CURRENT_RUN_ID,
      teamName: "current-team",
      leadSessionId: "ses-current-lead",
      members: [
        {
          name: "lead",
          sessionId: "ses-current-lead",
          agentType: "leader",
          status: "running",
          pendingInjectedMessageIds: [],
        },
        {
          name: "idle-member",
          sessionId: "ses-other-member",
          agentType: "general-purpose",
          status: "idle",
          pendingInjectedMessageIds: [],
        },
      ],
    })
    const otherRuntime = runtime({
      teamRunId: OTHER_RUN_ID,
      teamName: "other-team",
      leadSessionId: "ses-other-lead",
      members: [
        {
          name: "other-lead",
          sessionId: "ses-other-lead",
          agentType: "leader",
          status: "running",
          pendingInjectedMessageIds: [],
        },
      ],
    })
    const tasksByRunId = new Map<string, readonly Task[]>([
      [CURRENT_RUN_ID, [task({ id: "task-current", subject: "Current subject", activeForm: "Reviewing current work", status: "in_progress", owner: "lead", updatedAt: 2 })]],
      [OTHER_RUN_ID, [task({ id: "task-other", subject: "Other subject", status: "in_progress", owner: "other-lead", updatedAt: 2 })]],
    ])

    // when
    const teams = await buildTeamsProjection({
      projectDir: CURRENT_PROJECT,
      sessions: [
        { id: "ses-current-lead", directory: CURRENT_PROJECT },
        { id: "ses-other-member", directory: OTHER_PROJECT },
        { id: "ses-other-lead", directory: OTHER_PROJECT },
      ],
      runtimeProvider: {
        listActiveTeams: async () => [
          { teamRunId: CURRENT_RUN_ID, teamName: "current-team", status: "active", memberCount: 2, scope: "project" },
          { teamRunId: OTHER_RUN_ID, teamName: "other-team", status: "active", memberCount: 1, scope: "project" },
        ],
        loadRuntimeState: async (teamRunId) => teamRunId === CURRENT_RUN_ID ? currentRuntime : otherRuntime,
        listTasks: async (teamRunId) => tasksByRunId.get(teamRunId) ?? [],
      },
    })

    // then
    expect(teams).toEqual([
      {
        name: "current-team",
        members: [
          { name: "lead", status: "running", work: "Reviewing current work", sessionId: "ses-current-lead" },
          { name: "idle-member", status: "idle", work: null, sessionId: "ses-other-member" },
        ],
      },
    ])
    expect(JSON.stringify(teams)).not.toContain("private task description")
  })

  it("#given assigned tasks with competing statuses and timestamps #when selecting member work #then it uses status priority then newest update then task id", () => {
    // given
    const tasks = [
      task({ id: "task-pending", subject: "Pending work", status: "pending", owner: "member", updatedAt: 99 }),
      task({ id: "task-claimed", subject: "Claimed work", status: "claimed", owner: "member", updatedAt: 99 }),
      task({ id: "task-b", subject: "In progress B", activeForm: "Working B", status: "in_progress", owner: "member", updatedAt: 100 }),
      task({ id: "task-a", subject: "In progress A", activeForm: "Working A", status: "in_progress", owner: "member", updatedAt: 100 }),
      task({ id: "task-other", subject: "Other owner", status: "in_progress", owner: "other", updatedAt: 101 }),
    ]

    // when
    const work = selectCurrentWork("member", tasks)

    // then
    expect(work).toBe("Working A")
  })
})
