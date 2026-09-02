export declare function invalid(message: string, field: string): never;
export declare function isRecord(value: unknown): value is Record<string, unknown>;
export declare function section(value: unknown, field: string): Record<string, unknown>;
export declare function textField(value: unknown, field: string): string;
export declare function numberField(value: unknown, field: string): number;
export declare function stringArray(value: unknown, field: string): readonly string[];
export declare function emptyBlockers(value: unknown, field: string): readonly [];
export declare function literal<T extends string | boolean>(value: unknown, expected: T, field: string): T;
