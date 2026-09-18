import type { TeamModeConfig } from "../../../config/schema/team-mode";
import { listActiveTeams, loadRuntimeState } from "@oh-my-opencode/team-core/team-state-store/store";
import type { RuntimeState } from "@oh-my-opencode/team-core/types";
export type TeamLifecycleToolContext = {
    sessionID: string;
    directory?: string;
    agent?: string;
    messageID?: string;
};
export type TeamParticipant = {
    role: "lead" | "member";
    memberName: string;
};
export type TeamRuntimeStoreDeps = {
    listActiveTeams: typeof listActiveTeams;
    loadRuntimeState: typeof loadRuntimeState;
};
export declare function sanitizeRuntimeState(runtimeState: RuntimeState): Omit<RuntimeState, "members"> & {
    members: Array<Omit<RuntimeState["members"][number], "lastInjectedTurnMarker" | "pendingInjectedMessageIds">>;
};
export declare function findParticipantRuntime(sessionID: string, config: TeamModeConfig, deps: TeamRuntimeStoreDeps): Promise<RuntimeState | undefined>;
export declare function resolveParticipant(teamRunId: string, sessionID: string, config: TeamModeConfig, deps: TeamRuntimeStoreDeps): Promise<{
    runtimeState: RuntimeState;
    participant?: TeamParticipant;
}>;
