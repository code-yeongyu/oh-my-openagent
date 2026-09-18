import type { BackgroundManager } from "../../features/background-agent";
type BabysittingConfig = {
    timeout_ms?: number;
};
type BabysitterContext = {
    directory: string;
    client: {
        session: {
            messages: (args: {
                path: {
                    id: string;
                };
            }) => Promise<{
                data?: unknown;
            } | unknown[]>;
            promptAsync: (args: {
                path: {
                    id: string;
                };
                body: {
                    parts: Array<{
                        type: "text";
                        text: string;
                    }>;
                    agent?: string;
                    variant?: string;
                    model?: {
                        providerID: string;
                        modelID: string;
                    };
                    tools?: Record<string, boolean>;
                };
                query?: {
                    directory?: string;
                };
            }) => Promise<unknown>;
            status?: () => Promise<unknown>;
        };
    };
};
type BabysitterOptions = {
    backgroundManager: Pick<BackgroundManager, "getTasksByParentSession">;
    config?: BabysittingConfig;
    idleSettleMs?: number;
};
export declare function createUnstableAgentBabysitterHook(ctx: BabysitterContext, options: BabysitterOptions): {
    event: ({ event }: {
        event: {
            type: string;
            properties?: unknown;
        };
    }) => Promise<void>;
};
export {};
