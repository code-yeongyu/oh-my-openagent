import { z } from "zod";
export declare const FallbackModelsSchema: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>;
export type FallbackModels = z.infer<typeof FallbackModelsSchema>;
