import { z } from "zod";

export const KeywordTypeSchema = z.enum([
  "ultrawork",
  "search",
  "analyze",
  "team",
  "hyperplan",
  "hyperplan-ultrawork",
]);
export type KeywordType = z.infer<typeof KeywordTypeSchema>;

export type StaticModeType = "search" | "analyze" | "team" | "hyperplan";
export type DynamicModeType = "ultrawork" | "hyperplan-ultrawork";

export const PatternAppendSchema = z
  .string()
  .max(500, "pattern_append must be 500 characters or less");

export const ModeConfigSchema = z.object({
  pattern_append: PatternAppendSchema.optional(),
  message_append: z.string().optional(),
  message: z.string().optional(),
});
export type ModeConfig = z.infer<typeof ModeConfigSchema>;

export const DynamicModeConfigSchema = z.strictObject({
  pattern_append: PatternAppendSchema.optional(),
});

export const ModesConfigSchema = z.strictObject({
  ultrawork: DynamicModeConfigSchema.optional(),
  search: ModeConfigSchema.optional(),
  analyze: ModeConfigSchema.optional(),
  team: ModeConfigSchema.optional(),
  hyperplan: ModeConfigSchema.optional(),
  "hyperplan-ultrawork": DynamicModeConfigSchema.optional(),
});

export const KeywordDetectorConfigSchema = z.object({
  disabled_keywords: z.array(KeywordTypeSchema).optional(),
  modes: ModesConfigSchema.optional(),
});

export type KeywordDetectorConfig = z.infer<typeof KeywordDetectorConfigSchema>;
