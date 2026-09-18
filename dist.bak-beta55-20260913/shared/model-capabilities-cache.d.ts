import { MODELS_DEV_SOURCE_URL, buildModelCapabilitiesSnapshotFromModelsDev, fetchModelCapabilitiesSnapshot } from "@oh-my-opencode/model-core";
import type { ModelCapabilitiesSnapshot } from "./model-capabilities";
export { MODELS_DEV_SOURCE_URL, buildModelCapabilitiesSnapshotFromModelsDev, fetchModelCapabilitiesSnapshot, };
export declare function createModelCapabilitiesCacheStore(getCacheDir?: () => string): {
    readModelCapabilitiesCache: () => ModelCapabilitiesSnapshot | null;
    hasModelCapabilitiesCache: () => boolean;
    writeModelCapabilitiesCache: (snapshot: ModelCapabilitiesSnapshot) => void;
    refreshModelCapabilitiesCache: (args?: {
        sourceUrl?: string;
        fetchImpl?: (input: string) => Promise<Response>;
    }) => Promise<ModelCapabilitiesSnapshot>;
};
export declare const readModelCapabilitiesCache: () => ModelCapabilitiesSnapshot | null, hasModelCapabilitiesCache: () => boolean, writeModelCapabilitiesCache: (snapshot: ModelCapabilitiesSnapshot) => void, refreshModelCapabilitiesCache: (args?: {
    sourceUrl?: string;
    fetchImpl?: (input: string) => Promise<Response>;
}) => Promise<ModelCapabilitiesSnapshot>;
