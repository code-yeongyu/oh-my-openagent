import type { TeamModeConfig } from "../../config/schema/team-mode";
type HookInput = {
    event: {
        type: string;
        properties?: unknown;
    };
};
export type HookImpl = (input: HookInput) => Promise<void>;
type TeamMemberErrorHandlerDeps = {
    client?: {
        session?: {
            status?: () => Promise<unknown>;
            messages?: (input: {
                path: {
                    id: string;
                };
            }) => Promise<unknown>;
        };
    };
    settleMs?: number;
};
export declare function createTeamMemberErrorHandler(config: TeamModeConfig, deps?: TeamMemberErrorHandlerDeps): HookImpl;
export {};
