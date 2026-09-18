import type { Message, Part } from "@opencode-ai/sdk";
import type { PluginContext } from "../../plugin/types";
export declare const BTW_BOUNDARY_SENTINEL = "<omo-btw-boundary>";
export { BTW_PARENT_CONTEXT_MAX_BYTES, BTW_PARENT_CONTEXT_MAX_MESSAGES, } from "./parent-context-budget";
type MessageWithParts = {
    info: Message;
    parts: Part[];
};
export declare function createBtwSideContextInjectorHook(args: {
    client: PluginContext["client"];
}): {
    "experimental.chat.messages.transform": (_input: Record<string, never>, output: {
        messages: MessageWithParts[];
    }) => Promise<void>;
};
