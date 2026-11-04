import type { ArtifactRef } from "../../protocol/src/capability.ts";
import type { InvokeCall, ReadCall } from "./machine-proxy.ts";
import type { ReadHandle } from "./types.ts";
/** What the read family needs from the connected hub. The hub owns the transport and the capability table;
 *  this module owns the decision between inline bytes and a content-addressed artifact. */
export type ReadOpsDeps = {
    invoke(call: InvokeCall): Promise<unknown>;
    requireCapability(machineId: string, capability: string): void;
    resolveArtifact(ref: ArtifactRef): Promise<{
        readonly ref: ArtifactRef;
        readonly signal: AbortSignal | undefined;
    }>;
    fetchFn(): typeof fetch;
};
/** Typed local rejection of a `read`/`readText`/`readBytes`/`readHandle` `limitBytes` above
 *  `MAX_READ_LIMIT_BYTES`. Thrown before any wire frame is sent (C-READ-2). */
export declare class ReadLimitError extends Error {
    readonly limitBytes: number;
    readonly maxLimitBytes: number;
    constructor(limitBytes: number, maxLimitBytes: number);
}
type ReadResults = {
    readonly bytes: Uint8Array;
    readonly handle: ReadHandle;
    readonly text: string;
};
/** One `fs.read` round trip, finished as bytes, a handle, or text. The limit is checked before any frame is sent. */
export declare const readMachine: <Kind extends keyof ReadResults>(deps: ReadOpsDeps, kind: Kind, call: ReadCall) => Promise<ReadResults[Kind]>;
export {};
