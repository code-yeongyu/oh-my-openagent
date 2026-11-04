import type { ArtifactRef } from "../../protocol/src/capability.ts";
import type { ReadHandle } from "./types.ts";
export declare class ArtifactFetchError extends Error {
    constructor(url: string, status: number);
}
export declare class ArtifactDigestMismatchError extends Error {
    constructor(expected: string, actual: string);
}
export declare class ArtifactSizeMismatchError extends Error {
    constructor(expected: number, actual: number, options?: ErrorOptions);
}
export declare const parseArtifactRef: (value: unknown) => ArtifactRef | undefined;
/** Structural guard for the content-addressed handle an over-threshold `read()` hands back. */
export declare const isReadHandle: (value: unknown) => value is ReadHandle;
export declare const createReadHandle: (ref: ArtifactRef, fetchFn?: typeof fetch, signal?: AbortSignal) => ReadHandle;
export declare const drainReadHandle: (handle: ReadHandle) => Promise<Uint8Array>;
/** Stream `url` and error the stream unless its SHA-256 equals `sha256`. No size bound and no caller signal:
 *  those belong to a handle, which knows the size it promised (see `createReadHandle`). */
export declare const createDigestVerifyingStream: (url: string, sha256: string, fetchFn?: typeof fetch) => ReadableStream<Uint8Array>;
export declare const streamHandleToText: (handle: ReadHandle) => Promise<string>;
/** Artifact download URLs are attacker-influenced strings: allow only plain http/https origins, never embedded
 *  credentials (which a naive fetch would send upstream) and never a fragment. */
export declare const parseArtifactDownloadUrl: (value: string) => URL | undefined;
