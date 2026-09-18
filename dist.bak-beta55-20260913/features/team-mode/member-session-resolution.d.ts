import type { TeamModeConfig } from "../../config/schema/team-mode";
export type ResolvedMemberSession = {
    teamRunId: string;
    memberName: string;
};
export declare function findResolvedMemberSession(sessionID: string, config: TeamModeConfig, logContext: string): Promise<ResolvedMemberSession | null>;
