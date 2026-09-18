import type { OhMyOpenCodeConfig } from "../../config";
import type { MonitorManager } from "../../features/monitor";
import type { PluginContext } from "../types";
import { createClaudeCodeHooksHook, createKeywordDetectorHook, createMonitorStatusInjectorHook, createTeamMailboxInjector, createTeamModeStatusInjector, createToolPairValidatorHook } from "../../hooks";
import { createContextInjectorMessagesTransformHook } from "../../features/context-injector";
import { createBtwSideContextInjectorHook } from "../../features/btw-side";
export type TransformHooks = {
    claudeCodeHooks: ReturnType<typeof createClaudeCodeHooksHook> | null;
    keywordDetector: ReturnType<typeof createKeywordDetectorHook> | null;
    btwSideContextInjector: ReturnType<typeof createBtwSideContextInjectorHook>;
    contextInjectorMessagesTransform: ReturnType<typeof createContextInjectorMessagesTransformHook>;
    teamModeStatusInjector: ReturnType<typeof createTeamModeStatusInjector> | null;
    teamMailboxInjector: ReturnType<typeof createTeamMailboxInjector> | null;
    toolPairValidator: ReturnType<typeof createToolPairValidatorHook> | null;
    monitorStatusInjector: ReturnType<typeof createMonitorStatusInjectorHook> | null;
};
export declare function createTransformHooks(args: {
    ctx: PluginContext;
    pluginConfig: OhMyOpenCodeConfig;
    isHookEnabled: (hookName: string) => boolean;
    safeHookEnabled?: boolean;
    monitorManager?: MonitorManager;
}): TransformHooks;
