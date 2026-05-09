import type { TeamModeConfig } from "../../config/schema/team-mode"
import { findResolvedMemberSession } from "../../features/team-mode/member-session-resolution"
import { loadRuntimeState, transitionRuntimeState } from "../../features/team-mode/team-state-store/store"
import type { OpencodeClient } from "../../features/background-agent/opencode-client"
import { verifySessionExists } from "../../features/background-agent/session-existence"
import { log } from "../../shared/logger"

type HookInput = { event: { type: string; properties?: unknown } }
export type HookImpl = (input: HookInput) => Promise<void>

export type TeamMemberErrorHandlerDeps = {
  client?: OpencodeClient
  directory?: string
  verifySessionExists?: typeof verifySessionExists
}

function getErroredSessionID(properties: unknown): string | undefined {
  const record = properties as { sessionID?: string } | undefined
  return record?.sessionID
}

export function createTeamMemberErrorHandler(
  config: TeamModeConfig,
  deps: TeamMemberErrorHandlerDeps = {},
): HookImpl {
  const verify = deps.verifySessionExists ?? verifySessionExists
  return async ({ event }: HookInput): Promise<void> => {
    if (event.type !== "session.error") return

    const erroredSessionID = getErroredSessionID(event.properties)
    if (!erroredSessionID) return

    try {
      const runtimeMember = await findResolvedMemberSession(erroredSessionID, config, "team member error handler")
      if (runtimeMember === null) {
        return
      }

      // Mirror the BackgroundManager's transient-error path
      // (manager.ts:1525-1534): when session.error fires but the OpenCode
      // session is still alive, the underlying provider/model is doing
      // an internal retry — the work is NOT actually errored. Flipping
      // member.status here would falsely tell the lead the team-mode
      // member died, even as the member keeps running and sending peer
      // messages (the exact false-positive observed in the audit-
      // remediation team-mode launch logs).
      if (deps.client !== undefined) {
        const sessionStillAlive = await verify(deps.client, erroredSessionID, deps.directory)
        if (sessionStillAlive) {
          log("team member session.error received but session still alive, treating as transient", {
            event: "team-mode-member-errored-transient",
            teamRunId: runtimeMember.teamRunId,
            memberName: runtimeMember.memberName,
            sessionID: erroredSessionID,
          })
          return
        }
      }

      const runtimeState = await loadRuntimeState(runtimeMember.teamRunId, config)
      await transitionRuntimeState(runtimeState.teamRunId, (currentRuntimeState) => ({
        ...currentRuntimeState,
        members: currentRuntimeState.members.map((member) => (
          member.name === runtimeMember.memberName
            ? { ...member, status: "errored" }
            : member
        )),
      }), config)

      log("team member session errored", {
        event: "team-mode-member-errored",
        teamRunId: runtimeState.teamRunId,
        teamName: runtimeState.teamName,
        memberName: runtimeMember.memberName,
        sessionID: erroredSessionID,
        runtimeStatus: runtimeState.status,
      })
    } catch (error) {
      log("team member error handler failed", {
        event: "team-mode-member-error-handler-error",
        sessionID: erroredSessionID,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
