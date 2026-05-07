import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"

import type { TeamModeConfig } from "../../../config/schema/team-mode"
import type { OpencodeClient } from "../../../tools/delegate-task/types"
import { loadTeamSpec } from "../team-registry/loader"
import { aggregateStatus } from "../team-runtime/status"
import { discoverTeamSpecs } from "../team-registry/paths"
import { listActiveTeams } from "../team-state-store/store"

type QueryToolDeps = {
  aggregateStatus: typeof aggregateStatus
  discoverTeamSpecs: typeof discoverTeamSpecs
  loadTeamSpec: typeof loadTeamSpec
  listActiveTeams: typeof listActiveTeams
}

const defaultDeps: QueryToolDeps = {
  aggregateStatus,
  discoverTeamSpecs,
  loadTeamSpec,
  listActiveTeams,
}

type TeamListScope = "user" | "project" | "all"

type TeamListEntry = {
  name: string
  scope: "user" | "project"
  status: string
  teamRunId?: string
  memberCount: number
}

export function createTeamStatusTool(
  config: TeamModeConfig,
  client: OpencodeClient,
  backgroundManager?: Parameters<typeof aggregateStatus>[2],
  deps: QueryToolDeps = defaultDeps,
): ToolDefinition {
  void client

  return tool({
    description: "Return full status for a team run.",
    args: {
      teamRunId: tool.schema.string().describe("Team run ID"),
    },
    execute: async (args: { teamRunId: string }) => JSON.stringify(await deps.aggregateStatus(args.teamRunId, config, backgroundManager)),
  })
}

export function createTeamListTool(config: TeamModeConfig, client: OpencodeClient, deps: QueryToolDeps = defaultDeps): ToolDefinition {
  void client

  return tool({
    description: "List declared and active teams.",
    args: {
      scope: tool.schema.union([
        tool.schema.literal("user"),
        tool.schema.literal("project"),
        tool.schema.literal("all"),
      ]).optional().describe("Team scope filter"),
    },
    execute: async (args: { scope?: TeamListScope }) => {
      const scope = args.scope ?? "all"
      const projectRoot = process.cwd()
      const declaredTeamSpecs = await deps.discoverTeamSpecs(config, projectRoot)
      const activeTeams = await deps.listActiveTeams(config)

      const filteredDeclaredTeamSpecs = scope === "all"
        ? declaredTeamSpecs
        : declaredTeamSpecs.filter((teamSpec) => teamSpec.scope === scope)

      const declaredTeamSpecsByName = new Map(
        await Promise.all(filteredDeclaredTeamSpecs.map(async (teamSpec) => {
          const loadedTeamSpec = await deps.loadTeamSpec(teamSpec.name, config, projectRoot)
          return [teamSpec.name, loadedTeamSpec.members.length] as const
        })),
      )

      const activeTeamsByName = new Map(activeTeams.map((team) => [team.teamName, team]))

      const teamEntries: TeamListEntry[] = []

      for (const declaredTeamSpec of filteredDeclaredTeamSpecs) {
        const activeTeam = activeTeamsByName.get(declaredTeamSpec.name)
        const declaredTeamSpecMemberCount = declaredTeamSpecsByName.get(declaredTeamSpec.name)
        teamEntries.push({
          name: declaredTeamSpec.name,
          scope: declaredTeamSpec.scope,
          status: activeTeam?.status ?? "not-started",
          teamRunId: activeTeam?.teamRunId,
          memberCount: activeTeam?.memberCount ?? declaredTeamSpecMemberCount ?? 0,
        })
      }

      for (const activeTeam of activeTeams) {
        if (declaredTeamSpecsByName.has(activeTeam.teamName)) continue

        teamEntries.push({
          name: activeTeam.teamName,
          scope: activeTeam.scope,
          status: activeTeam.status,
          teamRunId: activeTeam.teamRunId,
          memberCount: activeTeam.memberCount,
        })
      }

      return JSON.stringify(teamEntries)
    },
  })
}
