export type MachineReadOptions = {
    readonly limitBytes?: number;
};
export type MachineWriteOptions = {
    readonly createParentDirs?: boolean;
};
export type MachineEditSpec = {
    readonly exact: string;
    readonly replacement: string;
};
export type MachineEditResult = {
    readonly path: string;
    readonly content: string;
    readonly replacements: number;
    readonly writeResult: MachineWriteResult;
};
/** The `fs.write` wire result (meshOperationContracts.fsWrite): parsed once at the SDK boundary. */
export type MachineWriteResult = {
    readonly path: string;
    readonly bytesWritten: number;
};
export interface MachineComposedTools {
    read(path: string, options?: MachineReadOptions): Promise<string>;
    readBytes(path: string, options?: MachineReadOptions): Promise<Uint8Array>;
    write(path: string, content: string | Uint8Array, options?: MachineWriteOptions): Promise<MachineWriteResult>;
    glob(pattern: string, options?: {
        readonly limit?: number;
    }): Promise<unknown>;
    grep(path: string, pattern: string, options?: {
        readonly limit?: number;
    }): Promise<unknown>;
    edit(path: string, spec: MachineEditSpec): Promise<MachineEditResult>;
}
type ComposedToolDependencies = {
    readonly invoke: (capability: string, args?: unknown) => Promise<unknown>;
    readonly requireCapability: (capability: string) => void;
};
export declare class ComposedToolInputError extends Error {
    readonly reason: string;
    constructor(reason: string);
}
export declare class ComposedToolResultError extends Error {
    readonly capability: string;
    readonly reason: string;
    constructor(capability: string, reason: string);
}
export declare const createMachineComposedTools: (dependencies: ComposedToolDependencies) => MachineComposedTools;
export declare const decodeWriteResult: (result: unknown) => MachineWriteResult;
export {};
