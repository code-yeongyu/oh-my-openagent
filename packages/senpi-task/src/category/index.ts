export {
  BUILTIN_CATEGORY_DEFAULTS,
  BUILTIN_CATEGORY_REQUIRES_MODEL,
  CATEGORY_DESCRIPTIONS,
  CATEGORY_PROMPT_APPENDS,
  DEFAULT_CATEGORIES,
  categoryGateModel,
  isCategoryChainRungResolvable,
  isCategoryChainViable,
  isCategoryGateSatisfied,
} from "./builtins"
export { resolveAvailableCategoryNames, resolveCategory } from "./resolver"
export type {
  BuiltinCategoryDefinition,
  CategoryModelSelection,
  CategoryResolutionResult,
  ResolveCategoryOptions,
  ResolvedChildSpec,
  SenpiModelPort,
  SenpiModelRegistryPort,
} from "./types"
