import { type ToolDefinition } from "@opencode-ai/plugin/tool";
/**
 * Quote-aware command tokenizer with escape handling
 * Handles single/double quotes and backslash escapes without external dependencies
 */
export declare function tokenizeCommand(cmd: string): string[];
type InteractiveBashArgs = {
    tmux_command: string;
};
export declare function executeInteractiveBash(args: InteractiveBashArgs): Promise<string>;
export declare const interactive_bash: ToolDefinition;
export {};
