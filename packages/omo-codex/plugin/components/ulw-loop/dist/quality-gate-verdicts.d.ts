export declare function passedVerdict(value: unknown, field: string): "passed";
export declare function codeQualityStatusField(value: unknown, field: string): "CLEAR" | "WATCH";
export declare function adversarialVerdict(row: Record<string, unknown>, field: string): {
    verdict: "passed" | "not_applicable";
    reason?: string;
};
