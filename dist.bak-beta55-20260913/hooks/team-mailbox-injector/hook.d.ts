import type { TeamModeConfig } from "../../config/schema/team-mode";
import type { PluginContext } from "../../plugin/types";
import type { ExecutorContext } from "../../tools/delegate-task/executor-types";
type HookContext = ExecutorContext | PluginContext | Record<string, never>;
type TransformPart = {
    type: string;
    text?: string;
    synthetic?: boolean;
    [key: string]: unknown;
};
type TransformMessageInfo = {
    role: string;
    sessionID?: string;
    [key: string]: unknown;
};
type MessageWithParts = {
    info: TransformMessageInfo;
    parts: TransformPart[];
};
type TeamMailboxInjectorInput = {
    sessionID?: string;
    [key: string]: unknown;
};
type TeamMailboxInjectorOutput = {
    messages: MessageWithParts[];
};
export type TeamMailboxInjectorHook = {
    "experimental.chat.messages.transform"?: (input: TeamMailboxInjectorInput, output: TeamMailboxInjectorOutput) => Promise<void>;
};
export declare function createTeamMailboxInjector(_ctx: HookContext, config: TeamModeConfig): TeamMailboxInjectorHook;
export {};
