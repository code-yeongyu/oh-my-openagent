export type RuntimeExecutable = {
    readonly command: string;
    readonly available: boolean;
};
export type RuntimeExecutableResolver = (commandName: string) => RuntimeExecutable;
type RuntimeExecutableOptions = {
    readonly which?: (commandName: string) => string | null;
    readonly execPath?: string;
};
export declare function resolveRuntimeExecutable(commandName: string, options?: RuntimeExecutableOptions): RuntimeExecutable;
export {};
