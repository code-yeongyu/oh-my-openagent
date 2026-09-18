import { z } from "zod";
export declare const GoalConfigSchema: z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    auto_start: z.ZodDefault<z.ZodBoolean>;
    default_max_iterations: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export type GoalConfig = z.infer<typeof GoalConfigSchema>;
