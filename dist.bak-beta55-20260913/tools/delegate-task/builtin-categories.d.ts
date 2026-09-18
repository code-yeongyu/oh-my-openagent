import type { CategoryConfig } from "../../config/schema";
export declare const DEFAULT_CATEGORIES: Record<string, CategoryConfig>;
export declare const CATEGORY_PROMPT_APPENDS: Record<string, string>;
export declare const CATEGORY_DESCRIPTIONS: Record<string, string>;
export declare const CATEGORY_CALLER_GUIDANCE: Record<string, string | undefined>;
export declare const CATEGORY_PROMPT_APPEND_RESOLVERS: Record<string, (model: string | undefined) => string>;
export declare const BUILTIN_CATEGORY_REQUIRES_MODEL: Record<string, readonly string[]>;
export declare function builtinCategoryGateModels(categoryName: string, requirementGateModel: string | undefined): readonly string[];
