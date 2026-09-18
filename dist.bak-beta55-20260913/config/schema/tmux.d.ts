import { z } from "zod";
import type { TmuxConfig, TmuxIsolation, TmuxLayout } from "@oh-my-opencode/tmux-core";
export declare const TmuxLayoutSchema: z.ZodEnum<{
    "even-horizontal": "even-horizontal";
    "even-vertical": "even-vertical";
    "main-horizontal": "main-horizontal";
    "main-vertical": "main-vertical";
    tiled: "tiled";
}>;
export declare const TmuxIsolationSchema: z.ZodEnum<{
    inline: "inline";
    session: "session";
    window: "window";
}>;
export declare const TmuxConfigSchema: z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    layout: z.ZodDefault<z.ZodEnum<{
        "even-horizontal": "even-horizontal";
        "even-vertical": "even-vertical";
        "main-horizontal": "main-horizontal";
        "main-vertical": "main-vertical";
        tiled: "tiled";
    }>>;
    main_pane_size: z.ZodDefault<z.ZodNumber>;
    main_pane_min_width: z.ZodDefault<z.ZodNumber>;
    agent_pane_min_width: z.ZodDefault<z.ZodNumber>;
    isolation: z.ZodDefault<z.ZodEnum<{
        inline: "inline";
        session: "session";
        window: "window";
    }>>;
}, z.core.$strip>;
export type { TmuxConfig, TmuxIsolation, TmuxLayout };
