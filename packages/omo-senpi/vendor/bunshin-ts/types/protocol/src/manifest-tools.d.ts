import type { CapabilityManifest } from "./capability.ts";
export type ToolInputSchema = {
    readonly [key: string]: unknown;
};
export type MachineToolDefinition = {
    readonly name: string;
    readonly capability: string;
    readonly inputSchema: ToolInputSchema;
    readonly transport: "built-in" | "sidecar" | "native";
    readonly version: string;
    readonly description?: string;
};
export declare const listManifestTools: (manifest: CapabilityManifest | undefined) => readonly MachineToolDefinition[];
export declare const manifestAdvertises: (manifest: CapabilityManifest | undefined, capability: string) => boolean;
