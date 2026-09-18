export type TeamSessionRole = "lead" | "member";
export type TeamSessionEntry = {
    teamRunId: string;
    memberName: string;
    role: TeamSessionRole;
};
export declare function registerTeamSession(sessionId: string, entry: TeamSessionEntry): void;
export declare function lookupTeamSession(sessionId: string): TeamSessionEntry | undefined;
export declare function unregisterTeamSession(sessionId: string): void;
export declare function unregisterTeamSessionsByTeam(teamRunId: string): void;
export declare function clearTeamSessionRegistry(): void;
