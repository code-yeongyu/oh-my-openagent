export type MachineFindQuery = {
    readonly tag?: string;
    readonly os?: string;
    readonly arch?: string;
};
export declare class MachineNotFoundError extends Error {
    readonly lookup: string;
    constructor(lookup: string);
}
export declare class AmbiguousMachineLookupError extends Error {
    readonly lookup: string;
    readonly matches: readonly string[];
    constructor(lookup: string, matches: readonly string[]);
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
