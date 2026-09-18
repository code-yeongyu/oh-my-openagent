import { z } from "zod";
export declare const TaskStatusSchema: z.ZodEnum<{
    completed: "completed";
    deleted: "deleted";
    in_progress: "in_progress";
    pending: "pending";
}>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export declare const TaskSchema: z.ZodObject<{
    id: z.ZodString;
    subject: z.ZodString;
    description: z.ZodString;
    status: z.ZodEnum<{
        completed: "completed";
        deleted: "deleted";
        in_progress: "in_progress";
        pending: "pending";
    }>;
    activeForm: z.ZodOptional<z.ZodString>;
    blocks: z.ZodArray<z.ZodString>;
    blockedBy: z.ZodArray<z.ZodString>;
    owner: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strict>;
export type Task = z.infer<typeof TaskSchema>;
