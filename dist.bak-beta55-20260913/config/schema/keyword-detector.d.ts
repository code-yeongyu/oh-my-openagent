import { z } from "zod";
export declare const KeywordTypeSchema: z.ZodEnum<{
    hyperplan: "hyperplan";
    "hyperplan-ultrawork": "hyperplan-ultrawork";
    team: "team";
    ultrawork: "ultrawork";
}>;
export type KeywordType = z.infer<typeof KeywordTypeSchema>;
export declare const KeywordDetectorConfigSchema: z.ZodObject<{
    enabled_expansions: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        hyperplan: "hyperplan";
        "hyperplan-ultrawork": "hyperplan-ultrawork";
        team: "team";
        ultrawork: "ultrawork";
    }>>>;
    disabled_keywords: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        hyperplan: "hyperplan";
        "hyperplan-ultrawork": "hyperplan-ultrawork";
        team: "team";
        ultrawork: "ultrawork";
    }>>>;
}, z.core.$strip>;
export type KeywordDetectorConfig = z.infer<typeof KeywordDetectorConfigSchema>;
