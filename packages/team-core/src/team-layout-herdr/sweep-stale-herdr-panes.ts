import { runHerdrCommand, type HerdrCommandResult } from "@oh-my-opencode/herdr-core"
import { buildCloseArgs, buildListPanesArgs, listPanesResult } from "@oh-my-opencode/herdr-core"

const UUID_V4ISH_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"

export const TEAM_PANE_TITLE_PATTERN = new RegExp(`^omo-team-(${UUID_V4ISH_PATTERN})-`)

export type TeamHerdrSweepDeps = {
  getHerdrPath: () => Promise<string | null | undefined>
  listPaneIds: (herdrPath: string, workspaceId: string) => Promise<Array<string>>
  readPaneTitle: (herdrPath: string, paneId: string) => Promise<string | null>
  closePane: (herdrPath: string, paneId: string) => Promise<boolean>
  log: (message: string, payload?: unknown) => void
}

function parsePaneLabelFromGetOutput(output: string): string | null {
  // herdr pane get returns JSON: { result: { pane: { label, pane_id, ... } } }
  try {
    const data = JSON.parse(output)
    const label = data?.result?.pane?.label
    return typeof label === "string" && label.length > 0 ? label : null
  } catch {
    return null
  }
}

const defaultDeps: TeamHerdrSweepDeps = {
  getHerdrPath: async () => "herdr",
  listPaneIds: async (herdrPath, workspaceId) => {
    const result = await runHerdrCommand(herdrPath, buildListPanesArgs(workspaceId))
    return listPanesResult(result).paneIds
  },
  readPaneTitle: async (herdrPath, paneId) => {
    const result = await runHerdrCommand(herdrPath, ["pane", "get", paneId])
    if (!result.success) return null
    return parsePaneLabelFromGetOutput(result.output)
  },
  closePane: async (herdrPath, paneId) => {
    const result = await runHerdrCommand(herdrPath, buildCloseArgs(paneId))
    return result.success
  },
  log: () => undefined,
}

export async function sweepStaleHerdrPanesWith(
  workspaceId: string,
  activeTeamRunIds: ReadonlySet<string>,
  deps: TeamHerdrSweepDeps,
): Promise<Array<string>> {
  const herdrPath = await deps.getHerdrPath()
  if (!herdrPath) return []

  const paneIds = await deps.listPaneIds(herdrPath, workspaceId)
  const swept: Array<string> = []

  for (const paneId of paneIds) {
    const title = await deps.readPaneTitle(herdrPath, paneId)
    const teamRunId = title?.match(TEAM_PANE_TITLE_PATTERN)?.[1]
    if (!teamRunId) continue
    if (activeTeamRunIds.has(teamRunId)) continue

    const closed = await deps.closePane(herdrPath, paneId)
    if (closed) swept.push(paneId)
  }

  return swept
}

export async function sweepStaleHerdrPanes(
  workspaceId: string,
  activeTeamRunIds: ReadonlySet<string>,
): Promise<Array<string>> {
  const { log } = await import("../logger")
  return sweepStaleHerdrPanesWith(workspaceId, activeTeamRunIds, { ...defaultDeps, log })
}

export type { HerdrCommandResult }
