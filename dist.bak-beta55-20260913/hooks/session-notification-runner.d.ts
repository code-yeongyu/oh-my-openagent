import type { PluginInput } from "@opencode-ai/plugin";
type ShellCommand = Promise<unknown> & {
    quiet?: () => Promise<unknown>;
    nothrow?: () => ShellCommand;
};
type ShellRunner = NonNullable<PluginInput["$"]>;
type ShellFailureMode = "throw" | "nothrow";
export declare function runNotificationCommand(ctx: PluginInput, commandPath: string, args: readonly string[], shellCommand: (shell: ShellRunner) => ShellCommand, shellFailureMode?: ShellFailureMode): Promise<void>;
export {};
