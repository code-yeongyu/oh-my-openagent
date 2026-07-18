import { getLastAgentFromSession } from "../../hooks/atlas/session-last-agent"
import { normalizeSDKResponse } from "../../shared/normalize-sdk-response"
import { z } from "zod"
import { MIRROR_SCHEMA_VERSION } from "./constants"
import { readActiveLoop } from "./loop-reader"
import { canonicalProjectDir } from "./mirror-path"
import { buildTeamsProjection, createTeamRuntimeProvider } from "./team-projection"
import type { TuiRuntimeSnapshot } from "./snapshot-schema"
import type { TeamRuntimeProvider } from "./team-projection"
import type { AgentStatus, JobRow } from "./state-types"
import type { BackgroundTaskSnapshot } from "../background-agent/types"
import type { TeamModeConfig } from "@oh-my-opencode/team-core/config"

const MAX_PROJECT_SESSIONS = 500

export type TuiMirrorClient = {
  readonly session: {
    readonly status: () => Promise<unknown>
    readonly messages: (input: { readonly path: { readonly id: string } }) => Promise<unknown>
    readonly list?: (input?: {
      readonly query?: {
        readonly directory?: string
        readonly limit?: number
      }
    }) => Promise<unknown>
  }
}

export type SessionStatusRow = {
  readonly type: string
}

export type SessionStatusMap = Record<string, SessionStatusRow>

export type TuiBackgroundSnapshotProvider = {
  readonly getTasksSnapshot: () => readonly BackgroundTaskSnapshot[]
}

export type SessionAgentResolver = (sessionID: string, client: TuiMirrorClient) => Promise<string | null>

export type BuildTuiRuntimeSnapshotInput = {
  readonly client: TuiMirrorClient
  readonly projectDir: string
  readonly backgroundManager: TuiBackgroundSnapshotProvider
  readonly getStatuses?: () => Promise<SessionStatusMap>
  readonly sessionAgentResolver?: SessionAgentResolver
  readonly teamModeConfig?: TeamModeConfig
  readonly teamRuntimeProvider?: TeamRuntimeProvider
}

type ActiveAgentStatus = Extract<AgentStatus, "busy" | "retry" | "running">

const TeamProjectSessionSchema = z.object({
  id: z.string().min(1),
  directory: z.string().min(1),
})

const TeamProjectSessionsSchema = z.array(TeamProjectSessionSchema)

export async function buildTuiRuntimeSnapshot(
  input: BuildTuiRuntimeSnapshotInput,
): Promise<TuiRuntimeSnapshot> {
  const statuses = await readStatuses(input)
  const loop = readActiveLoop(input.projectDir)

  return {
    version: MIRROR_SCHEMA_VERSION,
    projectDir: canonicalProjectDir(input.projectDir),
    updatedAt: Date.now(),
    activeAgents: await activeAgentsFromStatuses(statuses, input.client, input.sessionAgentResolver ?? getLastAgentFromSession),
    jobBoard: input.backgroundManager.getTasksSnapshot().map(toJobRow),
    loop: loop.kind === "live" ? redactLoopText(loop) : null,
    teams: await teamsFromRuntime(input),
  }
}

async function teamsFromRuntime(input: BuildTuiRuntimeSnapshotInput): Promise<TuiRuntimeSnapshot["teams"]> {
  if (input.teamModeConfig?.enabled !== true || input.client.session.list === undefined) {
    return []
  }

  const runtimeProvider = input.teamRuntimeProvider ?? createTeamRuntimeProvider(input.teamModeConfig)

  const sessions = TeamProjectSessionsSchema.safeParse(
    normalizeSDKResponse<unknown>(await input.client.session.list({
      query: {
        limit: MAX_PROJECT_SESSIONS,
      },
    }), []),
  )
  if (!sessions.success) {
    return []
  }

  return buildTeamsProjection({
    projectDir: input.projectDir,
    sessions: sessions.data,
    runtimeProvider,
  })
}

async function readStatuses(input: BuildTuiRuntimeSnapshotInput): Promise<SessionStatusMap> {
  if (input.getStatuses) {
    return input.getStatuses()
  }

  const response = await input.client.session.status()
  return normalizeSDKResponse<SessionStatusMap>(response, {})
}

async function activeAgentsFromStatuses(
  statuses: SessionStatusMap,
  client: TuiMirrorClient,
  sessionAgentResolver: SessionAgentResolver,
): Promise<TuiRuntimeSnapshot["activeAgents"]> {
  const rows = Object.entries(statuses)
    .map(([sessionID, row]) => ({ sessionID, status: activeStatus(row.type) }))
    .filter((row): row is { readonly sessionID: string; readonly status: ActiveAgentStatus } => row.status !== null)

  return Promise.all(
    rows.map(async (row) => ({
      name: (await sessionAgentResolver(row.sessionID, client)) ?? row.sessionID,
      status: row.status,
    })),
  )
}

function activeStatus(status: string): ActiveAgentStatus | null {
  switch (status) {
    case "busy":
    case "retry":
    case "running":
      return status
    default:
      return null
  }
}

function toJobRow(task: BackgroundTaskSnapshot): JobRow {
  return {
    title: task.title || `${task.agent} background task`,
    status: task.status,
    toolCalls: task.toolCalls,
    lastTool: task.lastTool,
  }
}

function redactLoopText(loop: TuiRuntimeSnapshot["loop"]): TuiRuntimeSnapshot["loop"] {
  if (loop === null) {
    return null
  }
  return { ...loop, activeGoal: null }
}
