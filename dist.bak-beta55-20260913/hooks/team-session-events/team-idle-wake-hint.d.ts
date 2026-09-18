import type { TeamModeConfig } from "../../config/schema/team-mode";
type PromptAsyncInput = {
    path: {
        id: string;
    };
    body: {
        parts: Array<{
            type: "text";
            text: string;
        }>;
        agent?: string;
        model?: {
            providerID: string;
            modelID: string;
        };
        variant?: string;
    };
    query: {
        directory: string;
    };
};
type TeamIdleWakeHintContext = {
    directory: string;
    client: {
        session: {
            promptAsync?: (input: PromptAsyncInput) => Promise<unknown>;
            status?: () => Promise<unknown>;
            messages?: (input: {
                path: {
                    id: string;
                };
            }) => Promise<unknown>;
        };
    };
};
type HookInput = {
    event: {
        type: string;
        properties?: unknown;
    };
};
export type HookImpl = (input: HookInput) => Promise<void>;
type TeamIdleWakeHintOptions = {
    idleSettleMs?: number;
    postDispatchHoldMs?: number;
};
export declare function createTeamIdleWakeHint(ctx: TeamIdleWakeHintContext, config: TeamModeConfig, options?: TeamIdleWakeHintOptions): HookImpl;
export {};
