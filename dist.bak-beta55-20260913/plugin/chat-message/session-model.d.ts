import type { OhMyOpenCodeConfig } from "../../config";
import type { ChatMessageHandlerOutput, ChatMessageInput, SessionModelOverride } from "./types";
export declare function getStoredMainSessionModel(input: ChatMessageInput, pluginConfig: OhMyOpenCodeConfig, isFirstMessage: boolean): SessionModelOverride | undefined;
export declare function recordSessionModel(input: ChatMessageInput, output: ChatMessageHandlerOutput): void;
