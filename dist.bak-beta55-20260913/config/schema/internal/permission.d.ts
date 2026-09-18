import { z } from "zod";
export declare const PermissionValueSchema: z.ZodEnum<{
    allow: "allow";
    ask: "ask";
    deny: "deny";
}>;
export type PermissionValue = z.infer<typeof PermissionValueSchema>;
export declare const AgentPermissionSchema: z.ZodObject<{
    edit: z.ZodOptional<z.ZodEnum<{
        allow: "allow";
        ask: "ask";
        deny: "deny";
    }>>;
    bash: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
        allow: "allow";
        ask: "ask";
        deny: "deny";
    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
        allow: "allow";
        ask: "ask";
        deny: "deny";
    }>>]>>;
    webfetch: z.ZodOptional<z.ZodEnum<{
        allow: "allow";
        ask: "ask";
        deny: "deny";
    }>>;
    task: z.ZodOptional<z.ZodEnum<{
        allow: "allow";
        ask: "ask";
        deny: "deny";
    }>>;
    doom_loop: z.ZodOptional<z.ZodEnum<{
        allow: "allow";
        ask: "ask";
        deny: "deny";
    }>>;
    external_directory: z.ZodOptional<z.ZodEnum<{
        allow: "allow";
        ask: "ask";
        deny: "deny";
    }>>;
}, z.core.$catchall<z.ZodOptional<z.ZodEnum<{
    allow: "allow";
    ask: "ask";
    deny: "deny";
}>>>>;
export type AgentPermission = z.infer<typeof AgentPermissionSchema>;
