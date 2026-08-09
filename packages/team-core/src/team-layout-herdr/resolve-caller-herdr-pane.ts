import { getCallerHerdrPaneId, getWorkspaceIdFromPaneId } from "@oh-my-opencode/herdr-core"

export type ResolvedCallerHerdrSession = {
  workspaceId: string
  paneId: string
}

export async function resolveCallerHerdrPane(
  callerPaneId: string | undefined = getCallerHerdrPaneId(),
): Promise<ResolvedCallerHerdrSession | null> {
  if (!callerPaneId) {
    return null
  }

  const workspaceId = getWorkspaceIdFromPaneId(callerPaneId)
  if (!workspaceId) {
    return null
  }

  return { workspaceId, paneId: callerPaneId }
}
