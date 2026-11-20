export type MachineFindQuery = {
    readonly tag?: string;
    readonly os?: string;
    readonly arch?: string;
};
export declare class MachineNotFoundError extends Error {
    readonly lookup: string;
    constructor(lookup: string);
}
/** One row an ambiguous lookup could have meant, with what a caller needs to pick it by id. */
export type MachineLookupCandidate = {
    readonly id: string;
    readonly state: "online" | "offline";
    readonly lastSeenMs?: number;
};
export declare class AmbiguousMachineLookupError extends Error {
    readonly lookup: string;
    readonly matches: readonly string[];
    readonly candidates: readonly MachineLookupCandidate[] | undefined;
    constructor(lookup: string, matches: readonly string[], candidates?: readonly MachineLookupCandidate[]);
}
export declare class CapabilityUnavailableError extends Error {
    readonly machineId: string;
    readonly capability: string;
    constructor(machineId: string, capability: string);
}
export declare class MachineConnectionUnavailableError extends Error {
    readonly machineId: string;
    constructor(machineId: string);
}
