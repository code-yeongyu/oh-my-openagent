import type { BtwSideMetadata } from "./metadata";
type CachedAdoption = {
    hydrated: false;
} | {
    hydrated: true;
    metadata?: BtwSideMetadata;
};
export declare function createBtwAdoptionCache(): {
    read: (sessionID: string) => CachedAdoption;
    write: (sessionID: string, metadata: BtwSideMetadata | undefined) => void;
    removeForDeletion: (sessionID: string) => void;
};
export {};
