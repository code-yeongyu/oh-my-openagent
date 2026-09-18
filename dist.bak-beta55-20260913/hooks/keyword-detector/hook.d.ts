import type { PluginInput } from "@opencode-ai/plugin";
import type { DefaultModeConfig } from "../../config/schema/default-mode";
import type { KeywordDetectorConfig } from "../../config/schema/keyword-detector";
import type { ContextCollector } from "../../features/context-injector";
export declare function createKeywordDetectorHook(ctx: PluginInput, _collector?: ContextCollector, _ralphLoop?: unknown, config?: KeywordDetectorConfig, defaultMode?: DefaultModeConfig): {
    "chat.message": (input: {
        sessionID: string;
        agent?: string;
        model?: {
            providerID: string;
            modelID: string;
        };
        messageID?: string;
        variant?: string;
    }, output: {
        message: Record<string, unknown>;
        parts: Array<{
            type: string;
            text?: string;
            [key: string]: unknown;
        }>;
    }) => Promise<void>;
    clearSession: (sessionID: string) => void;
    getSystemTransformGuidance: (sessionID: string, modelID?: string) => string | undefined;
    event: ({ event }: {
        event: {
            type: string;
            properties?: unknown;
        };
    }) => void;
    dispose: () => void;
};
