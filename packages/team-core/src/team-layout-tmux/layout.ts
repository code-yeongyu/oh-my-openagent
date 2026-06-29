import {
  type TeamLayoutBackend,
  type TeamLayoutCleanupTarget,
  type TeamLayoutMember,
  type TeamLayoutResult,
  type TmuxSessionManager,
  isTeamLayoutBackend,
} from "./backend"
import {
  canUseTmuxTeamLayout,
  createTmuxTeamLayoutBackend,
  isTeamLayoutDeps,
  type TeamLayoutDeps,
} from "./tmux-backend"

type TeamLayoutRuntime = TeamLayoutBackend | TeamLayoutDeps

export type {
  TeamLayoutBackend,
  TeamLayoutCleanupTarget,
  TeamLayoutDeps,
  TeamLayoutMember,
  TeamLayoutResult,
  TmuxSessionManager,
}
export { createTmuxTeamLayoutBackend }

const defaultBackend = createTmuxTeamLayoutBackend()

export function canVisualize(backend: Pick<TeamLayoutBackend, "canVisualize"> = defaultBackend): boolean {
  return backend.canVisualize()
}

function resolveBackend(runtime: TeamLayoutRuntime = defaultBackend): TeamLayoutBackend {
  if (isTeamLayoutBackend(runtime)) {
    return runtime
  }

  return createTmuxTeamLayoutBackend(runtime)
}

export async function createTeamLayout(
  teamRunId: string,
  members: Array<TeamLayoutMember>,
  tmuxMgr: TmuxSessionManager,
  runtime: TeamLayoutRuntime = defaultBackend,
): Promise<TeamLayoutResult | null> {
  return resolveBackend(runtime).createLayout({ teamRunId, members, tmuxMgr })
}

export async function removeTeamLayout(
  teamRunId: string,
  tmuxMgrOrCleanupTarget: TmuxSessionManager | TeamLayoutCleanupTarget | undefined,
  tmuxMgrOrRuntime?: TmuxSessionManager | TeamLayoutRuntime,
  runtime: TeamLayoutRuntime = defaultBackend,
): Promise<void> {
  const selectedRuntime = isTeamLayoutBackend(tmuxMgrOrRuntime) || isTeamLayoutDeps(tmuxMgrOrRuntime)
    ? tmuxMgrOrRuntime
    : runtime
  const cleanupTarget = isTeamLayoutCleanupTarget(tmuxMgrOrCleanupTarget)
    ? tmuxMgrOrCleanupTarget
    : undefined

  await resolveBackend(selectedRuntime).removeLayout({ teamRunId, cleanupTarget })
}

function isTeamLayoutCleanupTarget(value: TmuxSessionManager | TeamLayoutCleanupTarget | undefined): value is TeamLayoutCleanupTarget {
  return value !== undefined && "ownedSession" in value && "targetSessionId" in value
}

export { canUseTmuxTeamLayout }
