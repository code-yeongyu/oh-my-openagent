import type { PluginInput } from "@opencode-ai/plugin";
import type { Message, Part } from "@opencode-ai/sdk";
import type { AvailableSkill } from "../../agents/dynamic-agent-prompt-builder";
interface ToolExecuteInput {
    tool: string;
    sessionID: string;
    callID: string;
    agent?: string;
}
interface ToolExecuteOutput {
    title: string;
    output: string;
    metadata: unknown;
}
type MessageWithParts = {
    info: Message;
    parts: Part[];
};
export declare function createCategorySkillReminderHook(_ctx: PluginInput, availableSkills?: AvailableSkill[]): {
    "tool.execute.after": (input: ToolExecuteInput, _output: ToolExecuteOutput) => Promise<void>;
    "experimental.chat.messages.transform": (_input: Record<string, never>, output: {
        messages: MessageWithParts[];
    }) => Promise<void>;
    event: ({ event }: {
        event: {
            type: string;
            properties?: unknown;
        };
    }) => Promise<void>;
};
export {};
