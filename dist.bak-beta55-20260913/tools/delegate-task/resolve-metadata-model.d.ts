import type { DelegatedModelConfig } from "./types";
interface MetadataModel {
    providerID: string;
    modelID: string;
    variant?: string;
}
type ModelLike = Pick<DelegatedModelConfig, "providerID" | "modelID" | "variant"> | MetadataModel;
export declare function resolveMetadataModel(primary: ModelLike | undefined, fallback: ModelLike | undefined): MetadataModel | undefined;
export {};
