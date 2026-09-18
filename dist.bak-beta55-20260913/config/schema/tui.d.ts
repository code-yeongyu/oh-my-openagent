import { z } from "zod";
export declare const TuiSidebarConfigSchema: z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export declare const TuiConfigSchema: z.ZodObject<{
    sidebar: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type TuiConfig = z.infer<typeof TuiConfigSchema>;
