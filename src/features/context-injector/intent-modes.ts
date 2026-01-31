/**
 * Intent Modes for Dynamic System Instruction Adjustment
 *
 * Three modes: dev (default), review, research
 * Each mode injects different system instructions.
 */

export type IntentMode = "dev" | "review" | "research"

export interface IntentModeConfig {
  /** Enable intent mode detection (default: true) */
  enabled: boolean
  /** Custom keywords for each mode */
  custom_keywords: Partial<Record<IntentMode, string[]>>
}

export const DEFAULT_INTENT_MODE_CONFIG: IntentModeConfig = {
  enabled: true,
  custom_keywords: {},
}

/**
 * Keywords that indicate REVIEW mode
 */
const REVIEW_KEYWORDS: RegExp[] = [
  /\breview\b/i,
  /审查/,
  /\bcode\s*review\b/i,
  /\bpr\s*review\b/i,
  /评审/,
  /\bcheck\s*(this|my|the)\s*code\b/i,
  /\bfeedback\s*on\b/i,
  /\bcritique\b/i,
  /看看这段代码/,
  /\bfind\s*(issues|problems|bugs)\b/i,
]

/**
 * Keywords that indicate RESEARCH mode
 */
const RESEARCH_KEYWORDS: RegExp[] = [
  /\bresearch\b/i,
  /研究/,
  /探索/,
  /\bexplore\b/i,
  /\binvestigate\b/i,
  /\banalyze\b/i,
  /分析/,
  /\bunderstand\b/i,
  /\blearn\s*about\b/i,
  /\bhow\s*does\b/i,
  /\bwhat\s*is\b/i,
  /\bexplain\b/i,
  /解释/,
  /\bcompare\b/i,
  /比较/,
]

/**
 * System instructions for each mode
 */
const MODE_INSTRUCTIONS: Record<IntentMode, string> = {
  dev: `
[Intent Mode: DEVELOPMENT]
You are in development mode. Focus on:
- Writing clean, working code
- Following project conventions
- Running tests after changes
- Atomic commits for each logical unit
`,
  review: `
[Intent Mode: REVIEW]
You are in code review mode. Focus on:
- Finding bugs, security issues, and anti-patterns
- Suggesting improvements with specific examples
- Checking for edge cases and error handling
- Evaluating maintainability and readability
- Being constructive, not just critical

Structure your review:
1. **Summary**: Overall assessment (1-2 sentences)
2. **Critical Issues**: Must fix before merge
3. **Suggestions**: Nice-to-have improvements
4. **Positive Aspects**: What's done well
`,
  research: `
[Intent Mode: RESEARCH]
You are in research mode. Focus on:
- Understanding before acting
- Exploring multiple approaches
- Gathering comprehensive information
- Documenting findings clearly
- NOT making changes unless explicitly asked

Structure your response:
1. **Current Understanding**: What you've learned
2. **Key Findings**: Important discoveries
3. **Options/Alternatives**: Different approaches
4. **Recommendations**: What you suggest (if asked)
`,
}

/**
 * Detect intent mode from user prompt
 */
export function detectIntentMode(
  prompt: string,
  config: IntentModeConfig = DEFAULT_INTENT_MODE_CONFIG
): IntentMode {
  if (!config.enabled) {
    return "dev"
  }

  // Check for explicit mode flag first
  const explicitModeMatch = prompt.match(/--mode[=\s]*(dev|review|research)/i)
  if (explicitModeMatch) {
    return explicitModeMatch[1].toLowerCase() as IntentMode
  }

  // Priority: review > research > dev
  
  // Check review keywords
  const reviewPatterns = [
    ...REVIEW_KEYWORDS,
    ...(config.custom_keywords.review || []).map(k => new RegExp(k, "i")),
  ]
  if (reviewPatterns.some(p => p.test(prompt))) {
    return "review"
  }

  // Check research keywords
  const researchPatterns = [
    ...RESEARCH_KEYWORDS,
    ...(config.custom_keywords.research || []).map(k => new RegExp(k, "i")),
  ]
  if (researchPatterns.some(p => p.test(prompt))) {
    return "research"
  }

  // Default to dev mode
  return "dev"
}

/**
 * Get system instructions for a mode
 */
export function getModeInstructions(mode: IntentMode): string {
  return MODE_INSTRUCTIONS[mode]
}

/**
 * Detect mode and return instructions
 */
export function getIntentModeInstructions(
  prompt: string,
  config: IntentModeConfig = DEFAULT_INTENT_MODE_CONFIG
): { mode: IntentMode; instructions: string } {
  const mode = detectIntentMode(prompt, config)
  return {
    mode,
    instructions: getModeInstructions(mode),
  }
}
