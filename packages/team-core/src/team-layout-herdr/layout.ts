import { isHerdrEnvironment, runHerdrCommand, type HerdrCommandResult } from "@oh-my-opencode/herdr-core"
import { isServerRunning } from "@oh-my-opencode/tmux-core"
import {
  buildCloseArgs,
  buildListPanesArgs,
  buildRenameArgs,
  buildRunArgs,
  buildSplitArgs,
  getWorkspaceIdFromPaneId,
  isHerdrPaneId,
  listPanesResult,
  parsePaneIdFromOutput,
} from "@oh-my-opencode/herdr-core"
import { log } from "../logger"
import { shellSingleQuote } from "../shell-quote"
import { resolveCallerHerdrPane, type ResolvedCallerHerdrSession } from "./resolve-caller-herdr-pane"

type TeamLayoutMember = { name: string; sessionId: string; worktreePath?: string }
type HerdrSessionManager = {
  getServerUrl: () => string
  getCtxServerUrl?: () => string | undefined
}
const TEAM_PANE_TITLE_PREFIX = "omo-team-"

export type TeamLayoutHerdrDeps = {
  runHerdrCommand: (herdrPath: string, args: Array<string>, options?: { retry?: number; timeoutMs?: number }) => Promise<HerdrCommandResult>
  isServerRunning: (serverUrl: string) => Promise<boolean>
  getHerdrPath: () => Promise<string | null | undefined>
  resolveCallerHerdrPane: typeof resolveCallerHerdrPane
  log: typeof log
}

const defaultDeps: TeamLayoutHerdrDeps = {
  runHerdrCommand,
  isServerRunning,
  getHerdrPath: async () => "herdr",
  resolveCallerHerdrPane,
  log,
}

export type TeamLayoutResult = {
  focusWindowId: string
  gridWindowId?: string
  focusPanesByMember: Record<string, string>
  gridPanesByMember: Record<string, string>
  targetSessionId: string
  ownedSession: boolean
}

export type TeamLayoutCleanupTarget = {
  ownedSession: boolean
  targetSessionId: string
  focusWindowId?: string
  gridWindowId?: string
  paneIds?: Array<string>
}

export function canVisualizeHerdr(): boolean {
  return isHerdrEnvironment()
}

function getPaneWorkingDirectory(member: TeamLayoutMember): string {
  return member.worktreePath ?? process.cwd()
}

function buildAttachCommand(member: TeamLayoutMember, serverUrl: string): string {
  return `opencode attach ${shellSingleQuote(serverUrl)} --session ${shellSingleQuote(member.sessionId)} --dir ${shellSingleQuote(getPaneWorkingDirectory(member))}`
}

async function listPanesInWorkspace(herdrPath: string, workspaceId: string, deps: TeamLayoutHerdrDeps): Promise<Array<string>> {
  const result = await deps.runHerdrCommand(herdrPath, buildListPanesArgs(workspaceId))
  return listPanesResult(result).paneIds
}

/** Split a pane and return the new pane id; falls back to a list-diff when the CLI does not print it. */
async function splitPaneWithId(
  herdrPath: string,
  callerPaneId: string,
  direction: "right" | "down",
  ratio: number,
  cwd: string,
  deps: TeamLayoutHerdrDeps,
): Promise<string | null> {
  const before = await listPanesInWorkspace(herdrPath, getWorkspaceIdFromPaneId(callerPaneId) ?? "", deps)
  const split = await deps.runHerdrCommand(herdrPath, buildSplitArgs({ callerPaneId, direction, ratio, cwd }))
  if (!split.success) return null

  const printedPaneId = parsePaneIdFromOutput(split.output)
  if (printedPaneId) return printedPaneId

  const after = await listPanesInWorkspace(herdrPath, getWorkspaceIdFromPaneId(callerPaneId) ?? "", deps)
  const beforeSet = new Set(before)
  return after.find((paneId) => !beforeSet.has(paneId)) ?? null
}

function selectExistingTeammatePane(teammatePanes: Array<string>, callerPaneId: string): string {
  return teammatePanes[Math.floor(teammatePanes.length / 2)] ?? teammatePanes[teammatePanes.length - 1] ?? callerPaneId
}

function buildSplitForMember(teammatePanes: Array<string>, callerPaneId: string, member: TeamLayoutMember): { target: string; direction: "right" | "down" } {
  if (teammatePanes.length === 0) {
    return { target: callerPaneId, direction: "right" }
  }
  return {
    target: selectExistingTeammatePane(teammatePanes, callerPaneId),
    direction: teammatePanes.length % 2 === 1 ? "down" : "right",
  }
}

async function createTeamLayoutInCallerWorkspace(
  herdrPath: string,
  caller: ResolvedCallerHerdrSession,
  teamRunId: string,
  members: Array<TeamLayoutMember>,
  serverUrl: string,
  deps: TeamLayoutHerdrDeps,
): Promise<{ focusWindowId: string; focusPanesByMember: Record<string, string> } | null> {
  const panesByMember: Record<string, string> = {}
  let teammatePanes: Array<string> = []

  for (const member of members) {
    const { target, direction } = buildSplitForMember(teammatePanes, caller.paneId, member)
    const paneId = await splitPaneWithId(herdrPath, target, direction, 0.7, getPaneWorkingDirectory(member), deps)
    if (!paneId) return null

    teammatePanes = [...teammatePanes, paneId]
    panesByMember[member.name] = paneId
    await deps.runHerdrCommand(herdrPath, buildRenameArgs(paneId, `${TEAM_PANE_TITLE_PREFIX}${teamRunId}-${member.name}`))
    await deps.runHerdrCommand(herdrPath, buildRunArgs(paneId, buildAttachCommand(member, serverUrl)))
  }

  // Best-effort: keep the caller pane dominant (mirrors tmux main-vertical + resize-pane -x 30%).
  await deps.runHerdrCommand(herdrPath, ["pane", "resize", "--pane", caller.paneId, "--direction", "right", "--amount", "0.3"])

  return { focusWindowId: caller.workspaceId, focusPanesByMember: panesByMember }
}

export async function createHerdrTeamLayout(
  teamRunId: string,
  members: Array<TeamLayoutMember>,
  herdrMgr: HerdrSessionManager,
  deps: TeamLayoutHerdrDeps = defaultDeps,
): Promise<TeamLayoutResult | null> {
  console.error("[herdr-layout] createHerdrTeamLayout entered", JSON.stringify({ teamRunId, memberCount: members.length, canVisualize: canVisualizeHerdr(), herdrEnv: process.env.HERDR_ENV, paneId: process.env.HERDR_PANE_ID }))
  if (!canVisualizeHerdr()) {
    deps.log("herdr visualization unavailable, skipping")
    return null
  }
  if (members.length === 0) {
    return null
  }

  try {
    const serverUrl = herdrMgr.getServerUrl()
    console.error("[herdr-layout] server URL", serverUrl)
    if (!(await deps.isServerRunning(serverUrl))) {
      const ctxServerUrl = herdrMgr.getCtxServerUrl?.()
      console.error("[herdr-layout] SERVER NOT REACHABLE", JSON.stringify({ serverUrl, ctxServerUrl }))
      deps.log("opencode server not reachable, skipping team layout (see issue #3963)", {
        kind: "warning",
        teamRunId,
        serverUrl,
        ctxServerUrl: ctxServerUrl && ctxServerUrl !== serverUrl ? ctxServerUrl : undefined,
        hint: "no opencode server is listening on the fallback URL",
      })
      return null
    }

    const herdrPath = await deps.getHerdrPath()
    console.error("[herdr-layout] herdr path", herdrPath)
    if (!herdrPath) {
      deps.log("herdr visualization unavailable, skipping")
      return null
    }

    const caller = await deps.resolveCallerHerdrPane()
    console.error("[herdr-layout] caller pane", JSON.stringify(caller))
    if (!caller) {
      deps.log("herdr visualization requires a resolvable caller herdr pane, skipping", { teamRunId })
      return null
    }

    const focus = await createTeamLayoutInCallerWorkspace(herdrPath, caller, teamRunId, members, serverUrl, deps)
    if (!focus) return null

    return {
      focusWindowId: focus.focusWindowId,
      gridWindowId: undefined,
      focusPanesByMember: focus.focusPanesByMember,
      gridPanesByMember: {},
      targetSessionId: caller.workspaceId,
      ownedSession: false,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? String(error) : String(error)
    deps.log("herdr visualization unavailable, skipping", { error: errorMessage })
    return null
  }
}

export async function removeHerdrTeamLayout(
  teamRunId: string,
  herdrMgrOrCleanupTarget: HerdrSessionManager | TeamLayoutCleanupTarget | undefined,
  herdrMgrOrDeps?: HerdrSessionManager | TeamLayoutHerdrDeps,
  deps: TeamLayoutHerdrDeps = defaultDeps,
): Promise<void> {
  if (!canVisualizeHerdr()) return
  const resolvedDeps = isTeamLayoutHerdrDeps(herdrMgrOrDeps) ? herdrMgrOrDeps : deps
  try {
    const herdrPath = await resolvedDeps.getHerdrPath()
    if (!herdrPath) return

    const cleanupTarget = isTeamLayoutCleanupTarget(herdrMgrOrCleanupTarget)
      ? herdrMgrOrCleanupTarget
      : undefined

    if (cleanupTarget?.ownedSession !== false) {
      // herdr workspaces are addressed by id (w1); the caller workspace is never
      // owned by the team, so ownedSession is always false in this module.
      return
    }

    if (cleanupTarget?.paneIds && cleanupTarget.paneIds.length > 0) {
      for (const paneId of cleanupTarget.paneIds) {
        try {
          await resolvedDeps.runHerdrCommand(herdrPath, buildCloseArgs(paneId))
        } catch (error) {
          const errorMessage = error instanceof Error ? String(error) : String(error)
          resolvedDeps.log("herdr team pane cleanup failed", { teamRunId, paneId, error: errorMessage })
        }
      }
      return
    }

    for (const windowId of [cleanupTarget?.focusWindowId, cleanupTarget?.gridWindowId]) {
      if (!windowId) continue
      try {
        await resolvedDeps.runHerdrCommand(herdrPath, buildCloseArgs(windowId))
      } catch (windowError) {
        const errorMessage = windowError instanceof Error ? String(windowError) : String(windowError)
        resolvedDeps.log("herdr team layout workspace cleanup failed", { teamRunId, windowId, error: errorMessage })
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? String(error) : String(error)
    resolvedDeps.log("herdr team layout cleanup failed", { teamRunId, error: errorMessage })
  }
}

function isTeamLayoutHerdrDeps(value: HerdrSessionManager | TeamLayoutHerdrDeps | undefined): value is TeamLayoutHerdrDeps {
  return value !== undefined && "runHerdrCommand" in value && "getHerdrPath" in value
}

function isTeamLayoutCleanupTarget(value: HerdrSessionManager | TeamLayoutCleanupTarget | undefined): value is TeamLayoutCleanupTarget {
  return value !== undefined && "ownedSession" in value && "targetSessionId" in value
}

export { isHerdrPaneId }
