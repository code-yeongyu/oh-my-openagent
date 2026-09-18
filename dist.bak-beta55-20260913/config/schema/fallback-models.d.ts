import { z } from "zod";
export declare const FallbackModelObjectSchema: z.ZodObject<{
    model: z.ZodString;
    reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
        auto: "auto";
        high: "high";
        low: "low";
        max: "max";
        medium: "medium";
        minimal: "minimal";
        off: "off";
        xhigh: "xhigh";
    }>, z.ZodString]>>;
    variant: z.ZodOptional<z.ZodString>;
    reasoningEffort: z.ZodOptional<z.ZodEnum<{
        high: "high";
        low: "low";
        max: "max";
        medium: "medium";
        minimal: "minimal";
        none: "none";
        xhigh: "xhigh";
    }>>;
    temperature: z.ZodOptional<z.ZodNumber>;
    top_p: z.ZodOptional<z.ZodNumber>;
    maxTokens: z.ZodOptional<z.ZodNumber>;
    thinking: z.ZodOptional<z.ZodObject<{
        type: z.ZodEnum<{
            disabled: "disabled";
            enabled: "enabled";
        }>;
        budgetTokens: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type FallbackModelObject = z.infer<typeof FallbackModelObjectSchema>;
export declare const FallbackModelStringArraySchema: z.ZodArray<z.ZodString>;
export declare const FallbackModelObjectArraySchema: z.ZodArray<z.ZodObject<{
    model: z.ZodString;
    reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
        auto: "auto";
        high: "high";
        low: "low";
        max: "max";
        medium: "medium";
        minimal: "minimal";
        off: "off";
        xhigh: "xhigh";
    }>, z.ZodString]>>;
    variant: z.ZodOptional<z.ZodString>;
    reasoningEffort: z.ZodOptional<z.ZodEnum<{
        high: "high";
        low: "low";
        max: "max";
        medium: "medium";
        minimal: "minimal";
        none: "none";
        xhigh: "xhigh";
    }>>;
    temperature: z.ZodOptional<z.ZodNumber>;
    top_p: z.ZodOptional<z.ZodNumber>;
    maxTokens: z.ZodOptional<z.ZodNumber>;
    thinking: z.ZodOptional<z.ZodObject<{
        type: z.ZodEnum<{
            disabled: "disabled";
            enabled: "enabled";
        }>;
        budgetTokens: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>>;
export declare const FallbackModelMixedArraySchema: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
    model: z.ZodString;
    reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
        auto: "auto";
        high: "high";
        low: "low";
        max: "max";
        medium: "medium";
        minimal: "minimal";
        off: "off";
        xhigh: "xhigh";
    }>, z.ZodString]>>;
    variant: z.ZodOptional<z.ZodString>;
    reasoningEffort: z.ZodOptional<z.ZodEnum<{
        high: "high";
        low: "low";
        max: "max";
        medium: "medium";
        minimal: "minimal";
        none: "none";
        xhigh: "xhigh";
    }>>;
    temperature: z.ZodOptional<z.ZodNumber>;
    top_p: z.ZodOptional<z.ZodNumber>;
    maxTokens: z.ZodOptional<z.ZodNumber>;
    thinking: z.ZodOptional<z.ZodObject<{
        type: z.ZodEnum<{
            disabled: "disabled";
            enabled: "enabled";
        }>;
        budgetTokens: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>]>>;
export declare const FallbackModelsSchema: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>, z.ZodArray<z.ZodObject<{
    model: z.ZodString;
    reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
        auto: "auto";
        high: "high";
        low: "low";
        max: "max";
        medium: "medium";
        minimal: "minimal";
        off: "off";
        xhigh: "xhigh";
    }>, z.ZodString]>>;
    variant: z.ZodOptional<z.ZodString>;
    reasoningEffort: z.ZodOptional<z.ZodEnum<{
        high: "high";
        low: "low";
        max: "max";
        medium: "medium";
        minimal: "minimal";
        none: "none";
        xhigh: "xhigh";
    }>>;
    temperature: z.ZodOptional<z.ZodNumber>;
    top_p: z.ZodOptional<z.ZodNumber>;
    maxTokens: z.ZodOptional<z.ZodNumber>;
    thinking: z.ZodOptional<z.ZodObject<{
        type: z.ZodEnum<{
            disabled: "disabled";
            enabled: "enabled";
        }>;
        budgetTokens: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
    model: z.ZodString;
    reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
        auto: "auto";
        high: "high";
        low: "low";
        max: "max";
        medium: "medium";
        minimal: "minimal";
        off: "off";
        xhigh: "xhigh";
    }>, z.ZodString]>>;
    variant: z.ZodOptional<z.ZodString>;
    reasoningEffort: z.ZodOptional<z.ZodEnum<{
        high: "high";
        low: "low";
        max: "max";
        medium: "medium";
        minimal: "minimal";
        none: "none";
        xhigh: "xhigh";
    }>>;
    temperature: z.ZodOptional<z.ZodNumber>;
    top_p: z.ZodOptional<z.ZodNumber>;
    maxTokens: z.ZodOptional<z.ZodNumber>;
    thinking: z.ZodOptional<z.ZodObject<{
        type: z.ZodEnum<{
            disabled: "disabled";
            enabled: "enabled";
        }>;
        budgetTokens: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>]>>]>;
export type FallbackModels = z.infer<typeof FallbackModelsSchema>;
