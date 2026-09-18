import { z } from "zod";
export declare const TuiRuntimeSnapshotSchema: z.ZodObject<{
    version: z.ZodLiteral<1>;
    projectDir: z.ZodString;
    updatedAt: z.ZodNumber;
    activeAgents: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        status: z.ZodEnum<{
            busy: "busy";
            error: "error";
            idle: "idle";
            retry: "retry";
            running: "running";
        }>;
    }, z.core.$strip>>;
    jobBoard: z.ZodArray<z.ZodObject<{
        title: z.ZodString;
        status: z.ZodEnum<{
            cancelled: "cancelled";
            completed: "completed";
            error: "error";
            interrupt: "interrupt";
            pending: "pending";
            running: "running";
        }>;
        toolCalls: z.ZodNullable<z.ZodNumber>;
        lastTool: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    loop: z.ZodNullable<z.ZodObject<{
        kind: z.ZodLiteral<"live">;
        goalsDone: z.ZodNumber;
        goalsTotal: z.ZodNumber;
        pass: z.ZodNumber;
        fail: z.ZodNumber;
        pending: z.ZodNumber;
        blocked: z.ZodNumber;
        activeGoal: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type TuiRuntimeSnapshot = z.infer<typeof TuiRuntimeSnapshotSchema>;
export declare function parseSnapshot(raw: unknown): TuiRuntimeSnapshot | null;
