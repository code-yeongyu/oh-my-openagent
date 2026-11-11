import { CATEGORY_MODEL_REQUIREMENTS } from "../../../shared/model-requirements"
import { resolveCategoryExecution } from "../../../tools/delegate-task/category-resolver"
import type { ExecutorContext } from "../../../tools/delegate-task/executor-types"
import type { OmoConfig, RuntimeCategoryResolution } from "./model-resolution-types"

/**
 * Resolves every user-configured, enabled builtin category through the delegate-task runtime resolver,
 * so doctor shows exactly the model, reasoning or error a task() spawn would get.
 */
export async function resolveConfiguredCategoriesAtRuntime(
  config: OmoConfig,
): Promise<Record<string, RuntimeCategoryResolution>> {
  const executorCtx = {
    client: {},
    manager: {},
    directory: process.cwd(),
    userCategories: config.categories,
    sisyphusJuniorModel: undefined,
  } as unknown as ExecutorContext
  const configured = Object.entries(config.categories ?? {})
    .filter(([name]) => CATEGORY_MODEL_REQUIREMENTS[name] !== undefined)
  const resolved = await Promise.all(configured.map(async ([name, category]): Promise<[string, RuntimeCategoryResolution]> => {
    // mergeCategories drops a disabled category, so the runtime has no model for it at all.
    if (category?.disable === true) return [name, { disabled: true }]
    const result = await resolveCategoryExecution(
      { category: name, prompt: "", description: "doctor model resolution", run_in_background: false, load_skills: [] },
      executorCtx,
      undefined,
      undefined,
    )
    if (result.error !== undefined) return [name, { error: result.error }]
    const reasoning = result.categoryModel?.reasoning ?? result.categoryModel?.variant
    return [name, {
      ...(result.actualModel === undefined ? {} : { model: result.actualModel }),
      ...(reasoning === undefined ? {} : { reasoning }),
      userDefined: result.modelInfo?.type === "user-defined",
    }]
  }))
  return Object.fromEntries(resolved)
}
