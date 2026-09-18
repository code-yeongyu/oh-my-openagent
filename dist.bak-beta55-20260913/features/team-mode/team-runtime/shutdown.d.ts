import type { TeamModeConfig } from "../../../config/schema/team-mode";
export { deleteTeam } from "./delete-team";
export declare function requestShutdownOfMember(teamRunId: string, targetMemberName: string, requesterName: string, config: TeamModeConfig): Promise<void>;
export declare function approveShutdown(teamRunId: string, memberName: string, approverName: string, config: TeamModeConfig): Promise<void>;
export declare function rejectShutdown(teamRunId: string, memberName: string, rejectorName: string, reason: string, config: TeamModeConfig): Promise<void>;
