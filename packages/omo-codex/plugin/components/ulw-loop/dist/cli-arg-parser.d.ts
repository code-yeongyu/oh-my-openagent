type RecordEvidenceCliArgs = {
    readonly goalId: string;
    readonly criterionId: string;
    readonly status: "pass" | "fail" | "blocked";
    readonly evidence: string;
    readonly notes?: string;
};
export declare function hasFlag(argv: readonly string[], flag: string): boolean;
export declare function readValue(argv: readonly string[], flag: string): string | undefined;
export declare function readRepeated(argv: readonly string[], flag: string): string[];
export declare function parseGoalArg(argv: readonly string[]): string | undefined;
export declare function readStdin(): Promise<string>;
export declare function positionalText(argv: readonly string[]): string;
export declare function readJsonInput(value: string | undefined): Promise<unknown | undefined>;
export declare function parseCodexGoalJson(value: string | undefined): Promise<string | undefined>;
export declare function parseRecordEvidenceArgs(argv: readonly string[]): RecordEvidenceCliArgs;
export {};
