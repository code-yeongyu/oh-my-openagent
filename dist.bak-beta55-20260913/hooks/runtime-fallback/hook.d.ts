import { createAutoRetryHelpers } from "./auto-retry";
import { createChatMessageHandler } from "./chat-message-handler";
import { createEventHandler } from "./event-handler";
import { createFirstPromptWatchdog } from "./first-prompt-watchdog";
import { createMessageUpdateHandler } from "./message-update-handler";
import type { RuntimeFallbackHook, RuntimeFallbackOptions, RuntimeFallbackPluginInput } from "./types";
type RuntimeFallbackHookFactories = {
    createAutoRetryHelpers: typeof createAutoRetryHelpers;
    createEventHandler: typeof createEventHandler;
    createMessageUpdateHandler: typeof createMessageUpdateHandler;
    createChatMessageHandler: typeof createChatMessageHandler;
    createFirstPromptWatchdog: typeof createFirstPromptWatchdog;
};
export declare function createRuntimeFallbackHook(ctx: RuntimeFallbackPluginInput, options?: RuntimeFallbackOptions, factoryOverrides?: Partial<RuntimeFallbackHookFactories>): RuntimeFallbackHook;
export {};
