import type { MouseEvent } from "@opentui/core"

import { LABEL_MAX } from "./constants"
import { box, text } from "./element-helpers"
import type { ViewNode } from "./element-helpers"
import { assertNever } from "./state-types"
import type { TeamMemberRow, TeamsState } from "./state-types"

type ThemeLike = {
  readonly error?: unknown
  readonly text?: unknown
  readonly textMuted?: unknown
  readonly warning?: unknown
  readonly success?: unknown
  readonly info?: unknown
  readonly accent?: unknown
  readonly borderSubtle?: unknown
}

export type TeamSectionInteraction = {
  readonly collapsed: boolean
  readonly onToggle: () => void
  readonly onNavigateSession: (sessionId: string) => void
}

export function teamNodes(
  teams: TeamsState,
  theme: ThemeLike,
  interaction?: TeamSectionInteraction,
): ViewNode[] {
  switch (teams.kind) {
    case "none":
      return []
    case "list":
      return [
        box({ borderStyle: "single", borderColor: theme.borderSubtle, flexDirection: "column", padding: 1 }, [
          teamHeader(teams, theme, interaction),
          ...(interaction?.collapsed ? [] : teams.teams.flatMap((team) => team.members.map((member) => teamMemberNode(team.name, member, theme, interaction)))),
        ]),
      ]
    default:
      return assertNever(teams)
  }
}

export function teamLines(teams: TeamsState): string[] {
  switch (teams.kind) {
    case "none":
      return []
    case "list":
      return [
        `Team (${memberCount(teams)})`,
        ...teams.teams.flatMap((team) => team.members.map((member) => teamMemberLine(team.name, member))),
      ]
    default:
      return assertNever(teams)
  }
}

function teamHeader(teams: Extract<TeamsState, { readonly kind: "list" }>, theme: ThemeLike, interaction?: TeamSectionInteraction): ViewNode {
  return box(
    interaction === undefined ? {} : { onMouseDown: interaction.onToggle },
    [text({ fg: theme.info }, `Team (${memberCount(teams)}) ${interaction?.collapsed ? ">" : "v"}`)],
  )
}

function teamMemberNode(
  teamName: string,
  member: TeamMemberRow,
  theme: ThemeLike,
  interaction?: TeamSectionInteraction,
): ViewNode {
  const content = teamMemberLine(teamName, member)
  const sessionId = member.sessionId
  if (sessionId === null || interaction === undefined) {
    return text({ fg: memberStatusColor(member, theme) }, content)
  }

  return box(
    {
      onMouseDown: (event: MouseEvent): void => {
        event.stopPropagation()
        interaction.onNavigateSession(sessionId)
      },
    },
    [text({ fg: memberStatusColor(member, theme) }, content)],
  )
}

function memberCount(teams: Extract<TeamsState, { readonly kind: "list" }>): number {
  return teams.teams.reduce((count, team) => count + team.members.length, 0)
}

function teamMemberLine(teamName: string, member: TeamMemberRow): string {
  const currentWork = member.work === null ? "" : ` ${member.work}`
  return truncate(`${teamName}/${member.name} ${member.status}${currentWork}`)
}

function memberStatusColor(member: TeamMemberRow, theme: ThemeLike): unknown {
  switch (member.status) {
    case "running":
      return theme.success
    case "errored":
      return theme.error
    case "pending":
      return theme.warning
    case "idle":
    case "completed":
    case "shutdown_approved":
      return theme.textMuted
    default:
      return assertNever(member.status)
  }
}

function truncate(value: string): string {
  return value.length <= LABEL_MAX ? value : `${value.slice(0, LABEL_MAX - 3)}...`
}
