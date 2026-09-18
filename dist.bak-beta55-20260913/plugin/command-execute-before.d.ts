import type { CreatedHooks } from "../create-hooks";
type CommandExecuteBeforeInput = {
    command: string;
    sessionID: string;
    arguments: string;
};
type CommandExecuteBeforeOutput = {
    parts: Array<{
        type: string;
        text?: string;
        [key: string]: unknown;
    }>;
};
export declare function markNativeGoalCommand(parts: CommandExecuteBeforeOutput["parts"]): void;
export declare function consumeNativeGoalCommandMarker(parts: CommandExecuteBeforeOutput["parts"]): boolean;
export declare function createCommandExecuteBeforeHandler(args: {
    directory: string;
    hooks: CreatedHooks;
}): (input: CommandExecuteBeforeInput, output: CommandExecuteBeforeOutput) => Promise<void>;
export {};
