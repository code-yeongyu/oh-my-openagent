import type { BunshinClient } from "./types.ts";
export type BunshinToolDescriptor = {
    readonly name: string;
    readonly description: string;
    readonly parameters: unknown;
    readonly resultSchema?: unknown;
    readonly node: string;
};
export interface BunshinNode {
    readonly id: string;
    invokeTool(name: string, args?: unknown, signal?: AbortSignal): Promise<unknown>;
    listTools(): Promise<readonly BunshinToolDescriptor[]>;
    connect(): Promise<void>;
    close(): Promise<void>;
}
export interface BunshinNodeRegistry {
    attach(id: string, node: BunshinNode): Promise<unknown>;
}
export type AttachBunshinMachinesOptions = {
    readonly client: BunshinClient;
    readonly registry: BunshinNodeRegistry;
    readonly nodeIdPrefix?: string;
};
export type AttachedBunshinNode = {
    readonly id: string;
    readonly machineId: string;
    readonly alias: string;
    readonly node: BunshinNode;
};
export declare const attachBunshinMachinesAsNodes: (options: AttachBunshinMachinesOptions) => Promise<readonly AttachedBunshinNode[]>;
