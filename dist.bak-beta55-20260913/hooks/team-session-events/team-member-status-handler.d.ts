import type { TeamModeConfig } from "../../config/schema/team-mode";
type HookInput = {
    event: {
        type: string;
        properties?: unknown;
    };
};
export type HookImpl = (input: HookInput) => Promise<void>;
export declare function createTeamMemberStatusHandler(config: TeamModeConfig): HookImpl;
export {};
