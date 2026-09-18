import { z } from "zod";
export declare const MonitorConfigSchema: z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    live_mode_enabled: z.ZodDefault<z.ZodBoolean>;
    allowed_commands: z.ZodOptional<z.ZodArray<z.ZodString>>;
    max_monitors_per_session: z.ZodDefault<z.ZodNumber>;
    max_runtime_ms: z.ZodDefault<z.ZodNumber>;
    batch_max_lines: z.ZodDefault<z.ZodNumber>;
    batch_max_bytes: z.ZodDefault<z.ZodNumber>;
    flush_interval_ms: z.ZodDefault<z.ZodNumber>;
    ring_max_lines: z.ZodDefault<z.ZodNumber>;
    line_max_bytes: z.ZodDefault<z.ZodNumber>;
    pattern_max_length: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export type MonitorConfig = z.infer<typeof MonitorConfigSchema>;
