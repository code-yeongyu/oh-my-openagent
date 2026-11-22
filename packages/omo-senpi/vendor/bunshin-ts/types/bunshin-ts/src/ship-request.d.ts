/** The operations that move bytes from this client onto a machine or into the hub's artifact store. */
export type ShipCapability = "fs.write" | "fs.tree.apply" | "artifact.put";
export type ShipEntryKind = "file" | "dir" | "symlink" | "other";
export type ShipEntry = {
    /** Tree-relative for a tree or archive member (an archive's members are prefixed with the archive's own path);
     *  the remote path for a single-file write. Never has a trailing slash. */
    readonly path: string;
    readonly kind: ShipEntryKind;
    readonly bytes?: Uint8Array;
    /** Symlink or hardlink target, exactly as stored. */
    readonly linkTarget?: string;
};
/**
 * What the operator's validator is asked about before anything is sent. `entries` is what lands at `remotePath`
 * (the tree for `fs.tree.apply`, the one file for `fs.write`, the archive members for `artifact.put`);
 * `archiveEntries` lists every member of a tar or tar+gzip found inside those files, nested archives flattened.
 * They come from this client's own tar reader and are best-effort: a validator that must be exact about what an
 * archive would extract to should refuse archives it cares about rather than approve them on this list.
 * `opaque` names content this client could not inspect, so a validator can refuse what it cannot see.
 */
export type ShipRequest = {
    readonly capability: ShipCapability;
    readonly machineId?: string;
    readonly remotePath?: string;
    /** pushTree: the local directory as the caller named it, and its realpath (symlinks resolved). */
    readonly localDir?: string;
    readonly localRealPath?: string;
    /** A write whose content was read from a machine: where it was read. */
    readonly source?: {
        readonly machineId: string;
        readonly path: string;
    };
    readonly entries: readonly ShipEntry[];
    readonly archiveEntries: readonly ShipEntry[];
    readonly opaque: readonly string[];
};
/** The operator's validator: the refusal reasons for one request, empty when it may be shipped. */
export type ShipValidator = (request: ShipRequest) => readonly string[] | Promise<readonly string[]>;
/** An operator validator refused a ship. Nothing was uploaded or sent. */
export declare class ShipRefusedError extends Error {
    readonly code = "ship_refused";
    readonly capability: ShipCapability;
    readonly remotePath: string | undefined;
    readonly reasons: readonly string[];
    constructor(request: ShipRequest, reasons: readonly string[]);
}
/** A ship validator is configured but could not be loaded or did not answer with a list of reasons. Every ship
 *  fails closed with this error until the configuration is fixed; nothing was uploaded or sent. */
export declare class ShipValidatorError extends Error {
    readonly code = "ship_validator_unavailable";
    /** The configured module path, or the operator file that could not be read. */
    readonly validatorPath: string;
    constructor(validatorPath: string, detail: string, cause?: unknown);
}
