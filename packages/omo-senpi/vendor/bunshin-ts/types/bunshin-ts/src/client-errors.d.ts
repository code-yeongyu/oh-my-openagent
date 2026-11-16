export declare class MachineHubConnectError extends Error {
    constructor(message: string, cause?: Error);
}
export declare class TreeTransferUnsupportedError extends Error {
    readonly code = "tree_transfer_unsupported";
    constructor(machineId: string);
}
type LedgerMismatchDetails = {
    readonly taskId: string;
    readonly stepName: string;
    readonly opSeq: number;
    readonly expectedOpId: string;
    readonly actualOpId: string;
};
/** Typed abort raised when a re-driven step's opId diverges from the seq the prior journal recorded. Surfacing this
 *  instead of re-sending is what keeps a memoized re-drive from replaying a duplicate side-effect (D9 / review #1). */
export declare class LedgerMismatchError extends Error {
    readonly taskId: string;
    readonly stepName: string;
    readonly opSeq: number;
    readonly expectedOpId: string;
    readonly actualOpId: string;
    constructor(details: LedgerMismatchDetails);
}
/** Raised when step() is called on a machine that has not been bound to a task via withTask(). */
export declare class TaskContextRequiredError extends Error {
    constructor();
}
export {};
