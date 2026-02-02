export type IntentMode = "review" | "research" | "implement" | "debug" | "default"

export interface Resource {
  path: string
  type?: string
}

const BASE_SCORE = 0.5
const BOOST_HIGH = 1.5
const BOOST_MEDIUM = 1.3

const TEST_PATTERNS = [/\.test\.[tj]sx?$/, /\.spec\.[tj]sx?$/, /__tests__\//]
const DOC_PATTERNS = [/\.md$/, /^docs\//, /\/docs\//]
const SOURCE_PATTERNS = [/^src\/.*\.[tj]sx?$/, /^lib\/.*\.[tj]sx?$/, /\.[tj]sx?$/]
const DEBUG_PATTERNS = [/\.log$/, /^errors\//, /\/errors\//, /error/i, /^debug\//, /\/debug\//, /stacktrace/i]

function matchesPatterns(path: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(path))
}

function isTestFile(resource: Resource): boolean {
  if (resource.type === "test") return true
  return matchesPatterns(resource.path, TEST_PATTERNS)
}

function isDocFile(resource: Resource): boolean {
  if (resource.type === "doc" || resource.type === "documentation") return true
  return matchesPatterns(resource.path, DOC_PATTERNS)
}

function isSourceFile(resource: Resource): boolean {
  if (resource.type === "source") return true
  if (isTestFile(resource)) return false
  return matchesPatterns(resource.path, SOURCE_PATTERNS)
}

function isDebugFile(resource: Resource): boolean {
  if (resource.type === "debug" || resource.type === "log") return true
  return matchesPatterns(resource.path, DEBUG_PATTERNS)
}

function getMultiplier(resource: Resource, intentMode: IntentMode): number {
  switch (intentMode) {
    case "review":
      return isTestFile(resource) ? BOOST_HIGH : 1.0
    case "research":
      return isDocFile(resource) ? BOOST_HIGH : 1.0
    case "implement":
      return isSourceFile(resource) ? BOOST_MEDIUM : 1.0
    case "debug":
      return isDebugFile(resource) ? BOOST_HIGH : 1.0
    case "default":
    default:
      return 1.0
  }
}

export function scoreRelevance(resource: Resource, intentMode: IntentMode): number {
  const multiplier = getMultiplier(resource, intentMode)
  const score = BASE_SCORE * multiplier
  return Math.min(Math.max(score, 0), 1.0)
}
