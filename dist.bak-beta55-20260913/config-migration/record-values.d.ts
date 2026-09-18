export declare function isPlainRecord(value: unknown): value is Record<string, unknown>;
export declare function copyRecord(value: Readonly<Record<string, unknown>>): Record<string, unknown>;
export declare function mergeRecords(base: Readonly<Record<string, unknown>>, override: Readonly<Record<string, unknown>>): Record<string, unknown>;
export declare function withoutLegacyMetadata(value: Readonly<Record<string, unknown>>): Record<string, unknown>;
