import { z } from "zod";
/**
 * Help JSON schema for the `doctor` surface.
 * Defines the structure of doctor diagnostic output.
 */
export declare const DoctorIssueSchema: z.ZodObject<{
    title: z.ZodString;
    description: z.ZodString;
    fix: z.ZodOptional<z.ZodString>;
    affects: z.ZodOptional<z.ZodArray<z.ZodString>>;
    severity: z.ZodEnum<{
        error: "error";
        warning: "warning";
    }>;
}, z.core.$strip>;
export declare const CheckResultSchema: z.ZodObject<{
    name: z.ZodString;
    status: z.ZodEnum<{
        fail: "fail";
        pass: "pass";
        skip: "skip";
        warn: "warn";
    }>;
    message: z.ZodString;
    details: z.ZodOptional<z.ZodArray<z.ZodString>>;
    issues: z.ZodArray<z.ZodObject<{
        title: z.ZodString;
        description: z.ZodString;
        fix: z.ZodOptional<z.ZodString>;
        affects: z.ZodOptional<z.ZodArray<z.ZodString>>;
        severity: z.ZodEnum<{
            error: "error";
            warning: "warning";
        }>;
    }, z.core.$strip>>;
    duration: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const SystemInfoSchema: z.ZodObject<{
    opencodeVersion: z.ZodNullable<z.ZodString>;
    opencodePath: z.ZodNullable<z.ZodString>;
    pluginVersion: z.ZodNullable<z.ZodString>;
    loadedVersion: z.ZodNullable<z.ZodString>;
    bunVersion: z.ZodNullable<z.ZodString>;
    configPath: z.ZodNullable<z.ZodString>;
    configValid: z.ZodBoolean;
    isLocalDev: z.ZodBoolean;
}, z.core.$strip>;
export declare const LspServerInfoSchema: z.ZodObject<{
    id: z.ZodString;
    extensions: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export declare const GhCliInfoSchema: z.ZodObject<{
    installed: z.ZodBoolean;
    authenticated: z.ZodBoolean;
    username: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export declare const ToolsSummarySchema: z.ZodObject<{
    lspServers: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        extensions: z.ZodArray<z.ZodString>;
    }, z.core.$strip>>;
    astGrepCli: z.ZodBoolean;
    astGrepNapi: z.ZodBoolean;
    commentChecker: z.ZodBoolean;
    ghCli: z.ZodObject<{
        installed: z.ZodBoolean;
        authenticated: z.ZodBoolean;
        username: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>;
    mcpBuiltin: z.ZodArray<z.ZodString>;
    mcpUser: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export declare const DoctorSummarySchema: z.ZodObject<{
    total: z.ZodNumber;
    passed: z.ZodNumber;
    failed: z.ZodNumber;
    warnings: z.ZodNumber;
    skipped: z.ZodNumber;
    duration: z.ZodNumber;
}, z.core.$strip>;
export declare const DoctorResultSchema: z.ZodObject<{
    results: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        status: z.ZodEnum<{
            fail: "fail";
            pass: "pass";
            skip: "skip";
            warn: "warn";
        }>;
        message: z.ZodString;
        details: z.ZodOptional<z.ZodArray<z.ZodString>>;
        issues: z.ZodArray<z.ZodObject<{
            title: z.ZodString;
            description: z.ZodString;
            fix: z.ZodOptional<z.ZodString>;
            affects: z.ZodOptional<z.ZodArray<z.ZodString>>;
            severity: z.ZodEnum<{
                error: "error";
                warning: "warning";
            }>;
        }, z.core.$strip>>;
        duration: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    systemInfo: z.ZodObject<{
        opencodeVersion: z.ZodNullable<z.ZodString>;
        opencodePath: z.ZodNullable<z.ZodString>;
        pluginVersion: z.ZodNullable<z.ZodString>;
        loadedVersion: z.ZodNullable<z.ZodString>;
        bunVersion: z.ZodNullable<z.ZodString>;
        configPath: z.ZodNullable<z.ZodString>;
        configValid: z.ZodBoolean;
        isLocalDev: z.ZodBoolean;
    }, z.core.$strip>;
    tools: z.ZodObject<{
        lspServers: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            extensions: z.ZodArray<z.ZodString>;
        }, z.core.$strip>>;
        astGrepCli: z.ZodBoolean;
        astGrepNapi: z.ZodBoolean;
        commentChecker: z.ZodBoolean;
        ghCli: z.ZodObject<{
            installed: z.ZodBoolean;
            authenticated: z.ZodBoolean;
            username: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
        mcpBuiltin: z.ZodArray<z.ZodString>;
        mcpUser: z.ZodArray<z.ZodString>;
    }, z.core.$strip>;
    summary: z.ZodObject<{
        total: z.ZodNumber;
        passed: z.ZodNumber;
        failed: z.ZodNumber;
        warnings: z.ZodNumber;
        skipped: z.ZodNumber;
        duration: z.ZodNumber;
    }, z.core.$strip>;
    exitCode: z.ZodNumber;
}, z.core.$strip>;
export type DoctorIssue = z.infer<typeof DoctorIssueSchema>;
export type CheckResult = z.infer<typeof CheckResultSchema>;
export type SystemInfo = z.infer<typeof SystemInfoSchema>;
export type LspServerInfo = z.infer<typeof LspServerInfoSchema>;
export type GhCliInfo = z.infer<typeof GhCliInfoSchema>;
export type ToolsSummary = z.infer<typeof ToolsSummarySchema>;
export type DoctorSummary = z.infer<typeof DoctorSummarySchema>;
export type DoctorResult = z.infer<typeof DoctorResultSchema>;
