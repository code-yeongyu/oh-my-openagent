import * as z from "zod";
export type UnknownKeyPath = readonly PropertyKey[];
type Schema = z.core.$ZodType;
export declare function findUnknownKeyPaths(schema: Schema, value: unknown): readonly UnknownKeyPath[];
export {};
