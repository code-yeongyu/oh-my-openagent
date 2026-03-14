import type { OhMyOpenCodeConfig } from "../../config";
import type { PluginContext } from "../types";
import { createClaudeCodeHooksHook, createKeywordDetectorHook, createThinkingBlockValidatorHook } from "../../hooks";
import { createContextInjectorMessagesTransformHook } from "../../features/context-injector";
export type TransformHooks = {
    claudeCodeHooks: ReturnType<typeof createClaudeCodeHooksHook> | null;
    keywordDetector: ReturnType<typeof createKeywordDetectorHook> | null;
    contextInjectorMessagesTransform: ReturnType<typeof createContextInjectorMessagesTransformHook>;
    thinkingBlockValidator: ReturnType<typeof createThinkingBlockValidatorHook> | null;
};
export declare function createTransformHooks(args: {
    ctx: PluginContext;
    pluginConfig: OhMyOpenCodeConfig;
    isHookEnabled: (hookName: string) => boolean;
    safeHookEnabled?: boolean;
}): TransformHooks;
