import type { HookDeps } from "./types";
export declare function createChatMessageHandler(deps: HookDeps): (input: {
    sessionID: string;
    agent?: string;
    model?: {
        providerID: string;
        modelID: string;
    };
    variant?: string;
}, output: {
    message: {
        model?: {
            providerID: string;
            modelID: string;
        };
        variant?: string;
    };
    parts?: Array<{
        type: string;
        text?: string;
    }>;
}) => Promise<void>;
