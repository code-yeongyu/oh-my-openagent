import { z } from "zod";
export declare const TmuxLayoutSchema: z.ZodEnum<{
    "main-horizontal": "main-horizontal";
    "main-vertical": "main-vertical";
    tiled: "tiled";
    "even-horizontal": "even-horizontal";
    "even-vertical": "even-vertical";
}>;
export declare const TmuxConfigSchema: z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    layout: z.ZodDefault<z.ZodEnum<{
        "main-horizontal": "main-horizontal";
        "main-vertical": "main-vertical";
        tiled: "tiled";
        "even-horizontal": "even-horizontal";
        "even-vertical": "even-vertical";
    }>>;
    main_pane_size: z.ZodDefault<z.ZodNumber>;
    main_pane_min_width: z.ZodDefault<z.ZodNumber>;
    agent_pane_min_width: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export type TmuxConfig = z.infer<typeof TmuxConfigSchema>;
export type TmuxLayout = z.infer<typeof TmuxLayoutSchema>;
