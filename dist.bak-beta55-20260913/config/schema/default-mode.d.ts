import { z } from "zod";
export declare const DefaultModeConfigSchema: z.ZodObject<{
    ultrawork: z.ZodDefault<z.ZodBoolean>;
    goal: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export type DefaultModeConfig = z.infer<typeof DefaultModeConfigSchema>;
