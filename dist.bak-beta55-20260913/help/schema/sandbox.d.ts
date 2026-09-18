import { z } from "zod";
/**
 * Help JSON schema for the `sandbox` surface.
 * Defines the structure of sandboxed execution environment output.
 */
export declare const SandboxConfigSchema: z.ZodObject<{
    enabled: z.ZodBoolean;
    timeout: z.ZodNumber;
    memory: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    network: z.ZodBoolean;
    filesystem: z.ZodObject<{
        read: z.ZodArray<z.ZodString>;
        write: z.ZodArray<z.ZodString>;
        tempDir: z.ZodString;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const SandboxExecutionSchema: z.ZodObject<{
    id: z.ZodString;
    command: z.ZodString;
    exitCode: z.ZodNumber;
    stdout: z.ZodString;
    stderr: z.ZodString;
    duration: z.ZodNumber;
    sandboxed: z.ZodBoolean;
}, z.core.$strip>;
export declare const SandboxStatusSchema: z.ZodObject<{
    active: z.ZodBoolean;
    uptime: z.ZodNumber;
    executionsTotal: z.ZodNumber;
    executionsActive: z.ZodNumber;
    config: z.ZodObject<{
        enabled: z.ZodBoolean;
        timeout: z.ZodNumber;
        memory: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        network: z.ZodBoolean;
        filesystem: z.ZodObject<{
            read: z.ZodArray<z.ZodString>;
            write: z.ZodArray<z.ZodString>;
            tempDir: z.ZodString;
        }, z.core.$strip>;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const SandboxResultSchema: z.ZodObject<{
    status: z.ZodObject<{
        active: z.ZodBoolean;
        uptime: z.ZodNumber;
        executionsTotal: z.ZodNumber;
        executionsActive: z.ZodNumber;
        config: z.ZodObject<{
            enabled: z.ZodBoolean;
            timeout: z.ZodNumber;
            memory: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            network: z.ZodBoolean;
            filesystem: z.ZodObject<{
                read: z.ZodArray<z.ZodString>;
                write: z.ZodArray<z.ZodString>;
                tempDir: z.ZodString;
            }, z.core.$strip>;
        }, z.core.$strip>;
    }, z.core.$strip>;
    recentExecutions: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        command: z.ZodString;
        exitCode: z.ZodNumber;
        stdout: z.ZodString;
        stderr: z.ZodString;
        duration: z.ZodNumber;
        sandboxed: z.ZodBoolean;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export type SandboxConfig = z.infer<typeof SandboxConfigSchema>;
export type SandboxExecution = z.infer<typeof SandboxExecutionSchema>;
export type SandboxStatus = z.infer<typeof SandboxStatusSchema>;
export type SandboxResult = z.infer<typeof SandboxResultSchema>;
