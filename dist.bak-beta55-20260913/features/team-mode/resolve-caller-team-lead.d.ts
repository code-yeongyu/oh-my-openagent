import { type TeamSpec } from "./types";
export type CallerTeamLead = {
    agentTypeId?: string;
    displayName?: string;
    isEligibleForTeamLead: boolean;
};
export declare function resolveCallerTeamLead(rawAgentName: string | undefined): CallerTeamLead;
export declare function shouldReuseCallerLeadSession(spec: TeamSpec, callerAgentTypeId: string | undefined): boolean;
