export interface CategoryConfig {
  name: string
  description?: string
}

export function buildCustomCategories(categories: CategoryConfig[]): string[] {
  return categories.map((c) => c.name)
}

export function suggestCategoryForMemoryType(
  memory_type: string,
  customCategories: string[],
): string | undefined {
  const typeNormalized = memory_type.toLowerCase()
  return customCategories.find((cat) => cat.toLowerCase().includes(typeNormalized))
}

export const SUPER_AGENT_CATEGORIES: CategoryConfig[] = [
  { name: "decision", description: "Architectural and design decisions" },
  { name: "discovery", description: "New learnings and insights" },
  { name: "bugfix", description: "Bug fixes and root causes" },
  { name: "feature", description: "Feature implementations" },
  { name: "convention", description: "Project conventions and patterns" },
  { name: "benchmark", description: "Performance and quality benchmarks" },
]
