import { z } from "zod";
export declare const BuiltinCommandNameSchema: z.ZodEnum<{
    goal: "goal";
    hyperplan: "hyperplan";
    refactor: "refactor";
    "remove-ai-slops": "remove-ai-slops";
    "stop-continuation": "stop-continuation";
    "ulw-execute": "ulw-execute";
}>;
export type BuiltinCommandName = z.infer<typeof BuiltinCommandNameSchema>;
