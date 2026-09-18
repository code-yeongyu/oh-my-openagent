import type { Message, Part } from "@opencode-ai/sdk";
import type { CreatedHooks } from "../create-hooks";
type MessageWithParts = {
    info: Message;
    parts: Part[];
};
type MessagesTransformOutput = {
    messages: MessageWithParts[];
};
type MessagesTransformHooks = {
    btwSideContextInjector?: CreatedHooks["btwSideContextInjector"];
    contextInjectorMessagesTransform?: CreatedHooks["contextInjectorMessagesTransform"];
    teamModeStatusInjector?: CreatedHooks["teamModeStatusInjector"];
    teamMailboxInjector?: CreatedHooks["teamMailboxInjector"];
    toolPairValidator?: CreatedHooks["toolPairValidator"];
    monitorStatusInjector?: CreatedHooks["monitorStatusInjector"];
    categorySkillReminder?: CreatedHooks["categorySkillReminder"];
};
export declare function createMessagesTransformHandler(args: {
    hooks: MessagesTransformHooks;
}): (input: Record<string, never>, output: MessagesTransformOutput) => Promise<void>;
export {};
