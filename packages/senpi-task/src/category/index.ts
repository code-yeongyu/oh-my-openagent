export {
  BUILTIN_CATEGORY_DEFAULTS,
  BUILTIN_CATEGORY_REQUIRES_MODEL,
  CATEGORY_DESCRIPTIONS,
  CATEGORY_PROMPT_APPENDS,
  DEFAULT_CATEGORIES,
  categoryGateModel,
  isCategoryGateSatisfied,
} from "./builtins"
export { resolveCategory } from "./resolver"
export type {
  BuiltinCategoryDefinition,
  CategoryModelSelection,
  CategoryResolutionResult,
  ResolveCategoryOptions,
  ResolvedChildSpec,
  SenpiModelPort,
  SenpiModelRegistryPort,
} from "./types"
