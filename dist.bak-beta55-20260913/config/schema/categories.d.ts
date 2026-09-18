import { z } from "zod";
export declare const CategoryConfigSchema: z.ZodObject<{
    description: z.ZodOptional<z.ZodString>;
    model: z.ZodOptional<z.ZodString>;
    models: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
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
    }, z.core.$strip>]>>>;
    fallback_models: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>, z.ZodArray<z.ZodObject<{
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
    }, z.core.$strip>]>>]>>;
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
    temperature: z.ZodOptional<z.ZodNumber>;
    top_p: z.ZodOptional<z.ZodNumber>;
    max_tokens: z.ZodOptional<z.ZodNumber>;
    provider_options: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    maxTokens: z.ZodOptional<z.ZodNumber>;
    thinking: z.ZodOptional<z.ZodObject<{
        type: z.ZodEnum<{
            disabled: "disabled";
            enabled: "enabled";
        }>;
        budgetTokens: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    reasoningEffort: z.ZodOptional<z.ZodEnum<{
        high: "high";
        low: "low";
        max: "max";
        medium: "medium";
        minimal: "minimal";
        none: "none";
        xhigh: "xhigh";
    }>>;
    textVerbosity: z.ZodOptional<z.ZodEnum<{
        high: "high";
        low: "low";
        medium: "medium";
    }>>;
    tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
    prompt_append: z.ZodOptional<z.ZodString>;
    max_prompt_tokens: z.ZodOptional<z.ZodNumber>;
    is_unstable_agent: z.ZodOptional<z.ZodBoolean>;
    disable: z.ZodOptional<z.ZodBoolean>;
    warn_unavailable: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export declare const BuiltinCategoryNameSchema: z.ZodEnum<{
    artistry: "artistry";
    deep: "deep";
    quick: "quick";
    ultrabrain: "ultrabrain";
    "unspecified-high": "unspecified-high";
    "unspecified-low": "unspecified-low";
    "visual-engineering": "visual-engineering";
    writing: "writing";
}>;
export declare const CategoriesConfigSchema: z.ZodRecord<z.ZodString, z.ZodObject<{
    description: z.ZodOptional<z.ZodString>;
    model: z.ZodOptional<z.ZodString>;
    models: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
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
    }, z.core.$strip>]>>>;
    fallback_models: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>, z.ZodArray<z.ZodObject<{
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
    }, z.core.$strip>]>>]>>;
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
    temperature: z.ZodOptional<z.ZodNumber>;
    top_p: z.ZodOptional<z.ZodNumber>;
    max_tokens: z.ZodOptional<z.ZodNumber>;
    provider_options: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    maxTokens: z.ZodOptional<z.ZodNumber>;
    thinking: z.ZodOptional<z.ZodObject<{
        type: z.ZodEnum<{
            disabled: "disabled";
            enabled: "enabled";
        }>;
        budgetTokens: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    reasoningEffort: z.ZodOptional<z.ZodEnum<{
        high: "high";
        low: "low";
        max: "max";
        medium: "medium";
        minimal: "minimal";
        none: "none";
        xhigh: "xhigh";
    }>>;
    textVerbosity: z.ZodOptional<z.ZodEnum<{
        high: "high";
        low: "low";
        medium: "medium";
    }>>;
    tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
    prompt_append: z.ZodOptional<z.ZodString>;
    max_prompt_tokens: z.ZodOptional<z.ZodNumber>;
    is_unstable_agent: z.ZodOptional<z.ZodBoolean>;
    disable: z.ZodOptional<z.ZodBoolean>;
    warn_unavailable: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>>;
export type CategoryConfig = z.infer<typeof CategoryConfigSchema>;
export type CategoriesConfig = z.infer<typeof CategoriesConfigSchema>;
export type BuiltinCategoryName = z.infer<typeof BuiltinCategoryNameSchema>;
