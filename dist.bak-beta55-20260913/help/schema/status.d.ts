import { z } from "zod";
/**
 * Help JSON schema for the `status` surface.
 * Defines the structure of overall system status output.
 */
export declare const SessionStatusSchema: z.ZodObject<{
    type: z.ZodEnum<{
        busy: "busy";
        idle: "idle";
        retry: "retry";
    }>;
    attempt: z.ZodOptional<z.ZodNumber>;
    message: z.ZodOptional<z.ZodString>;
    next: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const ProviderHealthSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    connected: z.ZodBoolean;
    defaultModel: z.ZodNullable<z.ZodString>;
    modelsAvailable: z.ZodNumber;
}, z.core.$strip>;
export declare const McpHealthSchema: z.ZodObject<{
    name: z.ZodString;
    status: z.ZodEnum<{
        error: "error";
        running: "running";
        stopped: "stopped";
    }>;
    error: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
export declare const LspHealthSchema: z.ZodObject<{
    id: z.ZodString;
    running: z.ZodBoolean;
    workspaceRoot: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export declare const SystemHealthSchema: z.ZodObject<{
    opencode: z.ZodObject<{
        version: z.ZodString;
        running: z.ZodBoolean;
        uptime: z.ZodNumber;
    }, z.core.$strip>;
    sessions: z.ZodObject<{
        total: z.ZodNumber;
        active: z.ZodNumber;
        statuses: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
            type: z.ZodEnum<{
                busy: "busy";
                idle: "idle";
                retry: "retry";
            }>;
            attempt: z.ZodOptional<z.ZodNumber>;
            message: z.ZodOptional<z.ZodString>;
            next: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>>;
    }, z.core.$strip>;
    providers: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        connected: z.ZodBoolean;
        defaultModel: z.ZodNullable<z.ZodString>;
        modelsAvailable: z.ZodNumber;
    }, z.core.$strip>>;
    mcps: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        status: z.ZodEnum<{
            error: "error";
            running: "running";
            stopped: "stopped";
        }>;
        error: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>>;
    lsps: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        running: z.ZodBoolean;
        workspaceRoot: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    plugins: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        version: z.ZodNullable<z.ZodString>;
        enabled: z.ZodBoolean;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const StatusResultSchema: z.ZodObject<{
    system: z.ZodObject<{
        opencode: z.ZodObject<{
            version: z.ZodString;
            running: z.ZodBoolean;
            uptime: z.ZodNumber;
        }, z.core.$strip>;
        sessions: z.ZodObject<{
            total: z.ZodNumber;
            active: z.ZodNumber;
            statuses: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
                type: z.ZodEnum<{
                    busy: "busy";
                    idle: "idle";
                    retry: "retry";
                }>;
                attempt: z.ZodOptional<z.ZodNumber>;
                message: z.ZodOptional<z.ZodString>;
                next: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>>;
        }, z.core.$strip>;
        providers: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodString;
            connected: z.ZodBoolean;
            defaultModel: z.ZodNullable<z.ZodString>;
            modelsAvailable: z.ZodNumber;
        }, z.core.$strip>>;
        mcps: z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            status: z.ZodEnum<{
                error: "error";
                running: "running";
                stopped: "stopped";
            }>;
            error: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.core.$strip>>;
        lsps: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            running: z.ZodBoolean;
            workspaceRoot: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        plugins: z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            version: z.ZodNullable<z.ZodString>;
            enabled: z.ZodBoolean;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    timestamp: z.ZodNumber;
}, z.core.$strip>;
export type SessionStatus = z.infer<typeof SessionStatusSchema>;
export type ProviderHealth = z.infer<typeof ProviderHealthSchema>;
export type McpHealth = z.infer<typeof McpHealthSchema>;
export type LspHealth = z.infer<typeof LspHealthSchema>;
export type SystemHealth = z.infer<typeof SystemHealthSchema>;
export type StatusResult = z.infer<typeof StatusResultSchema>;
