import { z } from "zod";
export declare const UlwExecuteConfigSchema: z.ZodObject<{
    auto_commit: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export type UlwExecuteConfig = z.infer<typeof UlwExecuteConfigSchema>;
