import type { ArtifactRef } from "../../protocol/src/capability.ts";
type DurableResultEnvelopeOptions = {
    readonly fetchFn: typeof fetch;
    readonly resolveArtifact?: (ref: ArtifactRef) => Promise<{
        readonly ref: ArtifactRef;
        readonly signal: AbortSignal;
    }>;
    readonly acceptLegacyBodyArtifact?: boolean;
};
export declare class DurableResultArtifactResolverMissingError extends Error {
    readonly name = "DurableResultArtifactResolverMissingError";
    constructor();
}
export declare class DurableResultEnvelopeError extends Error {
    readonly reason: string;
    constructor(reason: string, options?: ErrorOptions);
}
export declare const resolveDurableResultEnvelope: (value: unknown, options: DurableResultEnvelopeOptions) => Promise<unknown>;
export {};
