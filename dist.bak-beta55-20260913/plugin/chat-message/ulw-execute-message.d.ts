import type { ChatMessageHooks, ChatMessageInput, ChatMessageHandlerOutput, UlwExecuteHookOutput, WorkStartingCommand } from "./types";
export declare function isUlwExecuteHookOutput(value: unknown): value is UlwExecuteHookOutput;
export declare function isUlwExecuteFallbackTemplate(promptText: string): boolean;
export declare function clearStoppedContinuationBeforeUlwExecute(hooks: ChatMessageHooks, sessionID: string, command: WorkStartingCommand): void;
export declare function runUlwExecuteHookIfApplicable(hooks: ChatMessageHooks, input: ChatMessageInput, output: ChatMessageHandlerOutput): Promise<void>;
