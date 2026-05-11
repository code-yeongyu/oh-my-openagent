import type { TeamModeConfig } from "../../config/schema/team-mode"
import { findResolvedMemberSession } from "../../features/team-mode/member-session-resolution"
import { loadRuntimeState, transitionRuntimeState } from "../../features/team-mode/team-state-store/store"
import { log } from "../../shared/logger"

type HookInput = { event: { type: string; properties?: unknown } }
export type HookImpl = (input: HookInput) => Promise<void>

function getErroredSessionID(properties: unknown): string | undefined {
  const record = properties as { sessionID?: string } | undefined
  return record?.sessionID
}

export function createTeamMemberErrorHandler(config: TeamModeConfig): HookImpl {
  return async ({ event }: HookInput): Promise<void> => {
    if (event.type !== "session.error") return

    const erroredSessionID = getErroredSessionID(event.properties)
    if (!erroredSessionID) return

    try {
      const runtimeMember = await findResolvedMemberSession(erroredSessionID, config, "team member error handler")
      if (runtimeMember === null) {
        return
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
