import type { GetModelCapabilitiesInput, ModelCapabilities } from "@oh-my-opencode/model-core";
export declare function getBundledModelCapabilitiesSnapshotForRuntime(): import("@oh-my-opencode/model-core").ModelCapabilitiesSnapshot;
export declare function getBundledModelCapabilitiesSnapshotForShared(): ReturnType<typeof getBundledModelCapabilitiesSnapshotForRuntime>;
export { getBundledModelCapabilitiesSnapshotForShared as getBundledModelCapabilitiesSnapshot };
export declare function getModelCapabilities(input: GetModelCapabilitiesInput): ModelCapabilities;
export type { GetModelCapabilitiesInput, ModelCapabilities, ModelCapabilitiesDiagnostics, ModelCapabilitiesSnapshot, ModelCapabilitiesSnapshotEntry, } from "@oh-my-opencode/model-core";
