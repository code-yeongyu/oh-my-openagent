/**
 * Smart Model Router — automatic task complexity estimation +
 * cross-provider round-robin model selection for omo Team Mode.
 *
 * The brain (Atlas/Sisyphus) runs on a fixed powerful model.
 * All subagent tasks flow through this router, which:
 *   1. Estimates task complexity from the prompt
 *   2. Maps complexity → model tier
 *   3. Distributes tasks across providers via round-robin
 *   4. Skips unhealthy providers
 *
 * Zero config needed beyond the brain model. Everything else is automatic.
 */

// ---- Complexity estimation ----

export type TaskComplexity = "trivial" | "simple" | "medium" | "complex" | "architecture"

/** Per-tier model recommendations — ordered by preference (first = cheapest in tier) */
export type TierModelEntry = {
  readonly provider: string
  readonly model: string
}

export type TierModelMap = Record<TaskComplexity, readonly TierModelEntry[]>

const COMPLEXITY_KEYWORDS: Record<TaskComplexity, readonly string[]> = {
  architecture: [
    "architecture", "design system", "from scratch", "greenfield",
    "restructure", "rearchitect", "system design", "data model",
    "database schema", "migration plan", "breaking change", "api design",
  ],
  complex: [
    "refactor", "multi-file", "concurrency", "race condition",
    "deadlock", "memory leak", "performance bottleneck", "security audit",
    "authentication", "authorization", "state machine", "async",
    "transaction", "rollback", "distributed",
  ],
  medium: [
    "implement", "feature", "endpoint", "component",
    "fix bug", "debug", "integrate", "add support for",
    "migrate", "upgrade", "dependency", "error handling",
  ],
  simple: [
    "update", "modify", "change", "adjust", "tweak",
    "add test", "add validation", "logging", "error message",
    "config", "style", "layout", "responsive",
  ],
  trivial: [
    "typo", "spelling", "format", "lint", "comment",
    "rename", "whitespace", "import order", "sort",
    "add type", "type annotation", "remove unused",
  ],
}

/**
 * Heuristic complexity estimation from task prompt.
 * Uses keyword matching + prompt length as signals.
 * This is intentionally simple — the brain (Atlas) already does
 * intelligent category selection. This is a fallback router.
 */
export function estimateComplexity(prompt: string): TaskComplexity {
  const lower = prompt.toLowerCase()
  const len = prompt.length

  // Score each complexity tier by keyword matches
  const scores: Record<TaskComplexity, number> = {
    architecture: 0,
    complex: 0,
    medium: 0,
    simple: 0,
    trivial: 0,
  }

  for (const [tier, keywords] of Object.entries(COMPLEXITY_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        scores[tier as TaskComplexity] += 1
      }
    }
  }

  // Length signal: only applies when no keywords matched
  const hasKeywordMatches = Object.values(scores).some((s) => s > 0)
  if (!hasKeywordMatches) {
    if (len < 100) scores.trivial += 2
    else if (len < 300) scores.simple += 1
  }
  if (len > 4000) scores.architecture += 2
  else if (len > 1500) scores.complex += 2
  else if (len > 800) scores.medium += 1

  // Count file references as complexity signal
  const fileRefs = (prompt.match(/\.(ts|tsx|js|jsx|py|go|rs|java|rb|sql|yaml|json|toml)/g) || []).length
  if (fileRefs >= 8) scores.architecture += 2
  else if (fileRefs >= 5) scores.complex += 2
  else if (fileRefs >= 3) scores.medium += 1

  // Pick the tier with the highest score
  let best: TaskComplexity = "medium"
  let bestScore = -1
  for (const tier of ["architecture", "complex", "medium", "simple", "trivial"] as TaskComplexity[]) {
    if (scores[tier] > bestScore) {
      bestScore = scores[tier]
      best = tier
    }
  }

  return best
}

// ---- Provider health tracking ----

export type ProviderHealth = {
  consecutiveErrors: number
  lastErrorTime: number
  cooldownUntil: number
}

const COOLDOWN_MS = 60_000 // 1 minute cooldown after 3 consecutive errors
const MAX_CONSECUTIVE_ERRORS = 3

const healthRegistry = new Map<string, ProviderHealth>()

export function getProviderHealth(provider: string): ProviderHealth {
  const existing = healthRegistry.get(provider)
  if (existing) return existing
  return { consecutiveErrors: 0, lastErrorTime: 0, cooldownUntil: 0 }
}

export function recordProviderError(provider: string): void {
  const now = Date.now()
  const h = getProviderHealth(provider)
  h.consecutiveErrors += 1
  h.lastErrorTime = now
  if (h.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
    h.cooldownUntil = now + COOLDOWN_MS
  }
  healthRegistry.set(provider, h)
}

export function recordProviderSuccess(provider: string): void {
  healthRegistry.set(provider, {
    consecutiveErrors: 0,
    lastErrorTime: 0,
    cooldownUntil: 0,
  })
}

export function isProviderHealthy(provider: string): boolean {
  const h = healthRegistry.get(provider)
  if (!h) return true
  if (h.cooldownUntil > 0 && Date.now() < h.cooldownUntil) return false
  return true
}

// ---- Round-robin provider selection ----

/** Per-tier round-robin counters */
const rrCounters = new Map<TaskComplexity, number>()

function getNextRoundRobinIndex(tier: TaskComplexity, max: number): number {
  const current = rrCounters.get(tier) ?? 0
  const next = (current + 1) % max
  rrCounters.set(tier, next)
  return current
}

// ---- Main router ----

export type SmartRouteResult = {
  /** Full model string "provider/model" */
  model: string
  provider: string
  modelId: string
  complexity: TaskComplexity
  /** Whether this was an auto-detected route (true) or explicit (false) */
  autoRouted: boolean
  reason: string
}

export type SmartRouteInput = {
  /** The task prompt to analyze */
  prompt: string
  /** Explicit category override from the brain (optional — if set, uses category-based tier) */
  explicitCategory?: string
  /** Available tier→model mappings. Auto-generated from provider model lists. */
  tierMap: TierModelMap
  /** Connected provider names */
  connectedProviders?: readonly string[]
}

export type SmartRouteCategoryResult = {
  category: string
  complexity: TaskComplexity
  autoRouted: boolean
  reason: string
}

/** Map omo category names to complexity tiers */
const CATEGORY_TO_COMPLEXITY: Record<string, TaskComplexity> = {
  ultrabrain: "architecture",
  deep: "complex",
  "unspecified-high": "complex",
  "unspecified-low": "medium",
  quick: "simple",
  artistry: "simple",
  "visual-engineering": "simple",
  writing: "trivial",
  explore: "simple",
  oracle: "medium",
  librarian: "simple",
}

/**
 * Smart model router — the core routing function.
 *
 * 1. If explicit category is given, uses that to pick tier
 * 2. Otherwise, estimates complexity from the task prompt
 * 3. Selects the best available provider+model via round-robin
 * 4. Skips unhealthy providers
 * 5. Returns the final model string ready for dispatch
 */
export function smartRoute(input: SmartRouteInput): SmartRouteResult | null {
  const { prompt, explicitCategory, tierMap, connectedProviders } = input

  // Step 1: Determine complexity tier
  let complexity: TaskComplexity
  let autoRouted: boolean

  if (explicitCategory && CATEGORY_TO_COMPLEXITY[explicitCategory]) {
    complexity = CATEGORY_TO_COMPLEXITY[explicitCategory]
    autoRouted = false
  } else {
    complexity = estimateComplexity(prompt)
    autoRouted = true
  }

  // Step 2: Get candidate models for this tier
  let candidates = tierMap[complexity]
  if (!candidates || candidates.length === 0) {
    // Fallback: try lower tiers
    const fallbackOrder: TaskComplexity[] = ["medium", "simple", "complex", "architecture", "trivial"]
    for (const fb of fallbackOrder) {
      if (tierMap[fb] && tierMap[fb].length > 0) {
        candidates = tierMap[fb]
        complexity = fb
        break
      }
    }
  }

  if (!candidates || candidates.length === 0) {
    return null
  }

  // Step 3: Filter by provider health + connectivity
  const healthy = candidates.filter((c) => {
    if (connectedProviders && connectedProviders.length > 0) {
      if (!connectedProviders.includes(c.provider)) return false
    }
    return isProviderHealthy(c.provider)
  })

  // If all providers unhealthy, try any (reset cooldowns for this attempt)
  const pool = healthy.length > 0 ? healthy : candidates

  // Step 4: Round-robin selection
  const idx = getNextRoundRobinIndex(complexity, pool.length)
  const selected = pool[idx]
  if (!selected) return null

  const reason = autoRouted
    ? `auto: complexity=${complexity} (prompt_score) → ${selected.provider}/${selected.model} [rr#${idx}]`
    : `explicit: category=${explicitCategory} → tier=${complexity} → ${selected.provider}/${selected.model} [rr#${idx}]`

  return {
    model: `${selected.provider}/${selected.model}`,
    provider: selected.provider,
    modelId: selected.model,
    complexity,
    autoRouted,
    reason,
  }
}

// ---- Auto-build tier map from provider model lists ----

/**
 * Build a TierModelMap from flat provider model lists.
 * Classifies models into tiers based on model ID heuristics.
 */
export function buildTierMapFromModels(
  models: readonly { provider: string; modelId: string }[],
): TierModelMap {
  const arch: TierModelEntry[] = []
  const complex: TierModelEntry[] = []
  const medium: TierModelEntry[] = []
  const simple: TierModelEntry[] = []
  const trivial: TierModelEntry[] = []

  for (const m of models) {
    const lower = m.modelId.toLowerCase()
    const entry: TierModelEntry = { provider: m.provider, model: m.modelId }

    // Architecture tier: "pro", "max", "ultra", "opus", "preview", "o1", "o3" models
    if (
      lower.includes("-pro") ||
      lower.includes("-max") ||
      lower.includes("ultra") ||
      lower.includes("opus") ||
      lower.includes("3.7") ||
      lower.includes("5.1") ||
      lower.includes("preview") ||
      lower.includes("reasoner") ||
      lower.includes("o1") ||
      lower.includes("o3")
    ) {
      arch.push(entry)
      complex.push(entry)
      continue
    }

    // Complex tier: "plus", "coder-plus", "5" series, "sonnet", "gpt-4"
    if (
      lower.includes("-plus") ||
      lower.includes("coder") ||
      lower.includes("3.6") ||
      lower.includes("k2.7") ||
      lower.includes("m3") ||
      lower.includes("sonnet") ||
      lower.includes("gpt-4")
    ) {
      complex.push(entry)
      medium.push(entry)
      continue
    }

    // Simple tier: "flash", "mini", "chat", "lite"
    if (
      lower.includes("flash") ||
      lower.includes("mini") ||
      lower.includes("lite") ||
      lower.includes("chat") ||
      lower.includes("3.5") ||
      lower.includes("k2.6") ||
      lower.includes("m2.7") ||
      lower.includes("m2.5")
    ) {
      simple.push(entry)
      trivial.push(entry)
      continue
    }

    // Default: medium tier
    medium.push(entry)
  }

  return { architecture: arch, complex, medium, simple, trivial }
}

// ---- Category-based tier map construction ----

/**
 * Minimal shape for a category model requirement entry.
 * Accepts both the full {@link FallbackEntry} from model-core
 * and plain `{ providers, model }` objects.
 */
export type CategoryRequirementEntry = {
  readonly providers?: readonly string[]
  readonly model?: string
  readonly fallbackChain?: readonly CategoryRequirementEntry[]
}

/**
 * Build a TierModelMap from the canonical CATEGORY_MODEL_REQUIREMENTS.
 *
 * Unlike {@link buildTierMapFromModels} which uses fragile string heuristics
 * on model IDs, this function derives the tier map from the already-maintained
 * category → fallback-chain mappings that power the existing resolution pipeline.
 *
 * @param categoryRequirements — typically `CATEGORY_MODEL_REQUIREMENTS` from model-core
 * @param complexityToCategory — mapping from complexity tier → preferred category name
 * @returns a TierModelMap with entries from each category's fallback chain
 */
export function buildTierMapFromCategoryRequirements(
  categoryRequirements: Readonly<Record<string, CategoryRequirementEntry | undefined>>,
  complexityToCategory?: Readonly<Record<TaskComplexity, string>>,
): TierModelMap {
  const defaultMapping: Record<TaskComplexity, string> = {
    architecture: "ultrabrain",
    complex: "unspecified-high",
    medium: "unspecified-low",
    simple: "quick",
    trivial: "quick",
  }

  const mapping = complexityToCategory ?? defaultMapping

  const arch: TierModelEntry[] = []
  const complex: TierModelEntry[] = []
  const medium: TierModelEntry[] = []
  const simple: TierModelEntry[] = []
  const trivial: TierModelEntry[] = []

  const tierArrays: Record<TaskComplexity, TierModelEntry[]> = {
    architecture: arch,
    complex,
    medium,
    simple,
    trivial,
  }

  // For each complexity tier, look up its preferred category's fallback chain
  for (const [tier, categoryName] of Object.entries(mapping) as [TaskComplexity, string][]) {
    const req = categoryRequirements[categoryName]
    if (!req) continue

    const chain = req.fallbackChain
    if (!chain || chain.length === 0) continue

    const target = tierArrays[tier]
    if (!target) continue

    for (const entry of chain) {
      const providers = entry.providers
      const model = entry.model
      if (!providers || providers.length === 0 || !model) continue

      for (const provider of providers) {
        target.push({ provider, model })
      }
    }
  }

  // Architecture tier also covers complex tasks
  for (const entry of arch) {
    if (!complex.some((e) => e.provider === entry.provider && e.model === entry.model)) {
      complex.push(entry)
    }
  }

  // Complex also serves medium
  for (const entry of complex) {
    if (!medium.some((e) => e.provider === entry.provider && e.model === entry.model)) {
      medium.push(entry)
    }
  }

  // Simple also serves trivial
  for (const entry of simple) {
    if (!trivial.some((e) => e.provider === entry.provider && e.model === entry.model)) {
      trivial.push(entry)
    }
  }

  return { architecture: arch, complex, medium, simple, trivial }
}

// ---- Complexity-to-category routing ----

/** Priority order of categories for each complexity tier. */
const COMPLEXITY_CATEGORY_PRIORITY: Record<TaskComplexity, readonly string[]> = {
  architecture: ["ultrabrain", "deep", "unspecified-high"],
  complex: ["deep", "unspecified-high", "ultrabrain"],
  medium: ["unspecified-low", "quick", "deep"],
  simple: ["quick", "unspecified-low", "artistry", "visual-engineering"],
  trivial: ["quick", "writing", "unspecified-low"],
}

/**
 * Resolve the best category name for a given complexity tier.
 *
 * Selects from the priority list, preferring categories that exist in
 * `enabledCategories`. Falls back to "unspecified-low" if nothing matches.
 */
export function resolveCategoryForComplexity(
  complexity: TaskComplexity,
  enabledCategories?: ReadonlySet<string>,
): string {
  const priorities = COMPLEXITY_CATEGORY_PRIORITY[complexity]
  if (priorities && enabledCategories && enabledCategories.size > 0) {
    for (const cat of priorities) {
      if (enabledCategories.has(cat)) return cat
    }
  }
  // Fallback: return the first priority, or a safe default
  if (priorities && priorities.length > 0) return priorities[0]
  return "unspecified-low"
}

/**
 * Smart route: prompt → complexity → category name.
 *
 * Pure pre-processor that determines WHICH category to use.
 * The caller should then pass this category through the existing
 * `resolveCategoryExecution()` pipeline for full model resolution.
 */
export function smartRouteToCategory(
  prompt: string,
  enabledCategories?: ReadonlySet<string>,
): SmartRouteCategoryResult {
  const complexity = estimateComplexity(prompt)
  const category = resolveCategoryForComplexity(complexity, enabledCategories)

  return {
    category,
    complexity,
    autoRouted: true,
    reason: `auto: complexity=${complexity} → category=${category} (prompt: "${prompt.slice(0, 60)}")`,
  }
}
