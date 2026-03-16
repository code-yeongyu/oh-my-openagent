import { z } from "zod";

export const OpenClawHookEventSchema = z.enum([
  "session-start",
  "session-end",
  "session-idle",
  "ask-user-question",
  "stop",
]);

export const OpenClawHttpGatewayConfigSchema = z.object({
  type: z.literal("http").optional(),
  url: z.string(), // Allow looser URL validation as it might contain placeholders
  headers: z.record(z.string(), z.string()).optional(),
  method: z.enum(["POST", "PUT"]).optional(),
  timeout: z.number().optional(),
});

export const OpenClawCommandGatewayConfigSchema = z.object({
  type: z.literal("command"),
  command: z.string(),
  timeout: z.number().optional(),
});

export const OpenClawGatewayConfigSchema = z.union([
  OpenClawHttpGatewayConfigSchema,
  OpenClawCommandGatewayConfigSchema,
]);

export const OpenClawHookMappingSchema = z.object({
  gateway: z.string(),
  instruction: z.string(),
  enabled: z.boolean(),
});

export const OpenClawConfigSchema = z.object({
  enabled: z.boolean(),
  gateways: z.record(z.string(), OpenClawGatewayConfigSchema),
  hooks: z
    .object({
      "session-start": OpenClawHookMappingSchema.optional(),
      "session-end": OpenClawHookMappingSchema.optional(),
      "session-idle": OpenClawHookMappingSchema.optional(),
      "ask-user-question": OpenClawHookMappingSchema.optional(),
      stop: OpenClawHookMappingSchema.optional(),
    })
    .strict()
    .optional(),
});

export type OpenClawConfig = z.infer<typeof OpenClawConfigSchema>;
