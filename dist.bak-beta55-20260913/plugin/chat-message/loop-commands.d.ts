import type { OhMyOpenCodeConfig } from "../../config";
import type { ChatMessageHooks, ChatMessageHandlerOutput, ChatMessageInput } from "./types";
export declare function handleGoalMessage(args: {
    readonly hooks: ChatMessageHooks;
    readonly input: ChatMessageInput;
    readonly output: ChatMessageHandlerOutput;
    readonly isFirstMessage: boolean;
    readonly pluginConfig: OhMyOpenCodeConfig;
    readonly nativeGoalCommand: boolean;
}): void;
