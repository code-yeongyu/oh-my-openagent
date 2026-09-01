import type { CategoryConfig } from "../config/schema";
import { DEFAULT_CATEGORIES } from "../tools/delegate-task/constants";

export function resolveCategoryConfig(
  categoryName: string,
  userCategories?: Record<string, CategoryConfig>,
): CategoryConfig | undefined {
  return userCategories?.[categoryName] ?? DEFAULT_CATEGORIES[categoryName];
}
