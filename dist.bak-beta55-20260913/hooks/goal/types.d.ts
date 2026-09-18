import { z } from "zod";
export declare const GOAL_STATUS_VALUES: readonly ["active", "paused", "complete"];
export declare const GoalStatusSchema: z.ZodEnum<{
    active: "active";
    complete: "complete";
    paused: "paused";
}>;
export type GoalStatus = z.infer<typeof GoalStatusSchema>;
export declare const GoalSchema: z.ZodObject<{
    id: z.ZodString;
    sessionID: z.ZodString;
    objective: z.ZodString;
    status: z.ZodEnum<{
        active: "active";
        complete: "complete";
        paused: "paused";
    }>;
    tokensUsed: z.ZodNumber;
    timeUsedSeconds: z.ZodNumber;
    createdAt: z.ZodNumber;
    updatedAt: z.ZodNumber;
    lastStartedAt: z.ZodOptional<z.ZodNumber>;
    completedAt: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type Goal = z.infer<typeof GoalSchema>;
export declare const GoalFileSchema: z.ZodObject<{
    version: z.ZodLiteral<1>;
    goal: z.ZodNullable<z.ZodObject<{
        id: z.ZodString;
        sessionID: z.ZodString;
        objective: z.ZodString;
        status: z.ZodEnum<{
            active: "active";
            complete: "complete";
            paused: "paused";
        }>;
        tokensUsed: z.ZodNumber;
        timeUsedSeconds: z.ZodNumber;
        createdAt: z.ZodNumber;
        updatedAt: z.ZodNumber;
        lastStartedAt: z.ZodOptional<z.ZodNumber>;
        completedAt: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type GoalFile = z.infer<typeof GoalFileSchema>;
export type GoalStoreRef = {
    readonly baseDir: string;
    readonly sessionID: string;
};
export type TokenUsageSnapshot = {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
    readonly totalTokens: number;
};
export type GoalUpdate = {
    readonly objective?: string;
    readonly status?: GoalStatus;
    readonly tokensUsed?: number;
    readonly timeUsedSeconds?: number;
};
export declare const GoalToolSnapshotSchema: z.ZodObject<{
    sessionID: z.ZodString;
    objective: z.ZodString;
    status: z.ZodEnum<{
        active: "active";
        complete: "complete";
        paused: "paused";
    }>;
    tokensUsed: z.ZodNumber;
    timeUsedSeconds: z.ZodNumber;
    createdAt: z.ZodNumber;
    updatedAt: z.ZodNumber;
}, z.core.$strip>;
export type GoalToolSnapshot = z.infer<typeof GoalToolSnapshotSchema>;
export declare const GoalToolResponseSchema: z.ZodObject<{
    goal: z.ZodNullable<z.ZodObject<{
        sessionID: z.ZodString;
        objective: z.ZodString;
        status: z.ZodEnum<{
            active: "active";
            complete: "complete";
            paused: "paused";
        }>;
        tokensUsed: z.ZodNumber;
        timeUsedSeconds: z.ZodNumber;
        createdAt: z.ZodNumber;
        updatedAt: z.ZodNumber;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type GoalToolResponse = z.infer<typeof GoalToolResponseSchema>;
export type GoalAccountingMode = "active" | "activeOrComplete";
