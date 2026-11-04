/**
 * Herdr backend for the tmux-subagent pane manager.
 *
 * The tmux backend maps subagents onto panes of the caller's window (inline)
 * or a dedicated `omo-agents-<pid>` window/session (isolated). On herdr every
 * isolation mode maps to the same shape: one workspace per manager process
 * (`omo-agents-<pid>[-<managerId>]`, mirroring `getIsolatedSessionName`) with
 * one tab per subagent. Tabs are cheap, so there is no grid-capacity
 * arithmetic - the spawn decision is only session readiness.
 *
 * The tab's root pane starts as a plain shell; the `opencode attach` line
 * (the exact string `activateTmuxPane` respawns a tmux pane with) is
 * delivered immediately via `pane run`, because the manager only spawns once
 * the session is ready and attachable. The tmux placeholder command exists
 * for focus-deferred activation, which herdr does not need.
 */

import { buildTmuxAttachCommand } from "../tmux-utils/pane-command"
import { isProcessAlive } from "../tmux-utils/stale-session-sweep"
import {
  HERDR_AGENTS_WORKSPACE_LABEL_PREFIX,
  buildHerdrPaneAuthEnv,
  defaultHerdrOpsDeps,
  herdrCloseWorkspace,
  herdrCreateTab,
  herdrCreateWorkspace,
  herdrListAgents,
  herdrListWorkspacesByLabelPrefix,
  herdrRunPaneCommand,
  type HerdrOpsDeps,
} from "./herdr-core"

/** `omo-agents-<pid>` / `omo-agents-<pid>-<managerId>` - same grammar as tmux isolated sessions. */
export const HERDR_AGENTS_WORKSPACE_LABEL_PATTERN = /^omo-agents-(\d+)(?:-([A-Za-z0-9]+))?$/

export function getHerdrAgentsWorkspaceLabel(pid: number = process.pid, managerId?: string): string {
  return managerId
    ? `${HERDR_AGENTS_WORKSPACE_LABEL_PREFIX}${pid}-${managerId}`
    : `${HERDR_AGENTS_WORKSPACE_LABEL_PREFIX}${pid}`
}

export async function findHerdrWorkspaceByLabel(
  label: string,
  deps: HerdrOpsDeps = defaultHerdrOpsDeps,
): Promise<string | null> {
  const workspaces = await herdrListWorkspacesByLabelPrefix(HERDR_AGENTS_WORKSPACE_LABEL_PREFIX, deps)
  return workspaces.find((workspace) => workspace.label === label)?.workspaceId ?? null
}

export type HerdrSubagentSpawnArgs = {
  readonly sessionId: string
  readonly description: string
  readonly cwd: string
  readonly serverUrl: string
  /** Known workspace id (manager cache) - skips label discovery and creation. */
  readonly workspaceId?: string
  /** Label used to find or create the workspace when its id is unknown. */
  readonly workspaceLabel: string
}

export type HerdrSubagentSpawnResult = {
  readonly success: boolean
  readonly paneId?: string
  readonly workspaceId?: string
  readonly error?: string
}

/**
 * Spawn one subagent tab in the manager's workspace and deliver the attach
 * command. Mirrors `spawnTmuxWindow`/`spawnTmuxSession` result semantics
 * (never throws; reports failures through the result object).
 */
export async function spawnHerdrSubagentTab(
  args: HerdrSubagentSpawnArgs,
  deps: HerdrOpsDeps = defaultHerdrOpsDeps,
): Promise<HerdrSubagentSpawnResult> {
  try {
    await deps.ensureServer()

    let workspaceId = args.workspaceId ?? await findHerdrWorkspaceByLabel(args.workspaceLabel, deps)
    if (!workspaceId) {
      const workspace = await herdrCreateWorkspace(args.cwd, args.workspaceLabel, deps)
      workspaceId = workspace.workspaceId
    }

    const tab = await herdrCreateTab(
      workspaceId,
      args.cwd,
      args.description,
      buildHerdrPaneAuthEnv(),
      deps,
    )
    await herdrRunPaneCommand(
      tab.paneId,
      buildTmuxAttachCommand(args.serverUrl, args.sessionId, args.cwd),
      deps,
    )
    return { success: true, paneId: tab.paneId, workspaceId }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export type SweepStaleHerdrAgentsWorkspacesDeps = {
  readonly listWorkspaces: () => Promise<Array<{ workspaceId: string; label: string }>>
  readonly listAgents: () => Promise<Array<{ paneId: string }>>
  readonly closeWorkspace: (workspaceId: string) => Promise<void>
  readonly processAlive: (pid: number) => boolean
  readonly currentPid: number
  readonly log: (message: string, payload?: unknown) => void
}

/**
 * Herdr-side stale sweep for subagent workspaces: close `omo-agents-<pid>`
 * workspaces whose owning manager process is gone, but only when no live
 * agent remains in them (the workspace may still host a running attach).
 * Mirrors `sweepStaleHerdrTeamWorkspacesWith` in team-core and the tmux
 * `sweepStaleOmoAgentSessions` pid grammar. Best-effort and silent on herdr
 * errors: no herdr dependency is required when herdr is absent.
 */
export async function sweepStaleHerdrAgentsWorkspacesWith(
  deps: SweepStaleHerdrAgentsWorkspacesDeps,
): Promise<string[]> {
  const candidates = await deps.listWorkspaces()
  const removed: string[] = []
  for (const workspace of candidates) {
    const pidText = workspace.label.match(HERDR_AGENTS_WORKSPACE_LABEL_PATTERN)?.[1]
    if (pidText === undefined) continue
    const pid = Number.parseInt(pidText, 10)
    if (!Number.isFinite(pid)) continue
    if (pid === deps.currentPid) continue
    if (deps.processAlive(pid)) continue
    try {
      const agents = await deps.listAgents()
      const workspacePrefix = `${workspace.workspaceId}:`
      if (agents.some((agent) => agent.paneId.startsWith(workspacePrefix))) continue
      await deps.closeWorkspace(workspace.workspaceId)
      removed.push(workspace.label)
    } catch (error) {
      deps.log("herdr stale agents workspace sweep failed", {
        workspaceId: workspace.workspaceId,
        label: workspace.label,
        error: error instanceof Error ? String(error) : String(error),
      })
    }
  }
  return removed
}

export async function sweepStaleHerdrAgentsWorkspaces(
  currentPid: number = process.pid,
  deps: HerdrOpsDeps = defaultHerdrOpsDeps,
): Promise<string[]> {
  try {
    return await sweepStaleHerdrAgentsWorkspacesWith({
      listWorkspaces: () => herdrListWorkspacesByLabelPrefix(HERDR_AGENTS_WORKSPACE_LABEL_PREFIX, deps),
      listAgents: () => herdrListAgents(deps),
      closeWorkspace: (workspaceId) => herdrCloseWorkspace(workspaceId, deps),
      processAlive: isProcessAlive,
      currentPid,
      log: () => undefined,
    })
  } catch {
    // herdr or its server absent - nothing to sweep (same policy as the
    // tmux sweeps when not inside tmux).
    return []
  }
}
