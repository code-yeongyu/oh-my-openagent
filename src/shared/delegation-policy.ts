/**
 * Delegation Policy Types (LIF-69)
 *
 * Defines policy rules that map intent and triggers to required agents.
 * Enables BLOCKING enforcement for documentation delegation.
 *
 * @see .cursor/specs/LIF-69-feat-omo-delegation-optimization/plan.md
 */

/* --- Core Types --- */

/** Intent categories for delegation routing */
export type DelegationIntent =
  | "documentation"
  | "implementation"
  | "security"
  | "testing"
  | "planning"
  | "research"
  | "unknown"

/** Policy enforcement mode */
export type PolicyMode = "disabled" | "warn" | "block"

/** Policy evaluation result */
export type PolicyDecision = "allowed" | "warned" | "blocked"

/* --- Match Conditions --- */

export interface DelegationPolicyMatch {
  /** Primary deterministic triggers: glob-like path prefixes */
  paths?: string[]
  /** Primary deterministic triggers: tool names to match */
  tools?: string[]
  /** Secondary heuristic triggers: keywords in content/prompt */
  intentKeywords?: string[]
  /** Secondary heuristic triggers: markdown-like content signal */
  requiresMarkdown?: boolean
}

/* --- Requirements --- */

export interface DelegationPolicyRequirement {
  /** Required agent for this delegation (e.g., "document-writer") */
  requiredAgent: string
  /** User-facing explanation for why delegation is required */
  rationale: string
}

/* --- Exceptions --- */

export interface DelegationPolicyException {
  /** Agents allowed to bypass this rule */
  allowAgents?: string[]
  /** Paths explicitly allowed (override match.paths) */
  allowPaths?: string[]
}

/* --- Escalation --- */

export interface DelegationPolicyEscalation {
  /** Number of violations before escalating to block */
  strikesToBlock: number
  /** Time window in ms (session-scoped) */
  windowMs: number
}

/* --- Policy Rule --- */

export interface DelegationPolicyRule {
  /** Unique rule identifier */
  id: string
  /** Enforcement mode */
  mode: PolicyMode
  /** Conditions that trigger this rule */
  match: DelegationPolicyMatch
  /** Required delegation when rule matches */
  require: DelegationPolicyRequirement
  /** Optional exceptions to the rule */
  exceptions?: DelegationPolicyException
  /** Optional escalation configuration */
  escalation?: DelegationPolicyEscalation
}

/* --- Policy Container --- */

export interface DelegationPolicy {
  /** Schema version for forward compatibility */
  version: "1.0"
  /** List of policy rules (evaluated in order) */
  rules: DelegationPolicyRule[]
}

/* --- Evaluation Result --- */

export interface PolicyEvaluationResult {
  /** The decision made */
  decision: PolicyDecision
  /** Rule that matched (if any) */
  matchedRule?: DelegationPolicyRule
  /** User-facing message */
  message: string
  /** Suggested remediation (for warn/block) */
  remediation?: string
  /** Current strike count (for escalation tracking) */
  strikeCount?: number
}

/* --- Default Documentation Policy --- */

/**
 * Default policy for documentation BLOCKING gate.
 * Requires delegation to document-writer for docs edits.
 */
export const DEFAULT_DOCS_POLICY_RULE: DelegationPolicyRule = {
  id: "docs-blocking-gate",
  mode: "block",
  match: {
    paths: [
      "docs/",
      "README.md",
      "README.*.md",
      "CHANGELOG.md",
      "changelog/",
      "*.mdx",
      ".cursor/memory/",
      "context/memory/",
    ],
    tools: ["write", "edit"],
    intentKeywords: ["documentation", "readme", "changelog", "write docs", "update docs"],
  },
  require: {
    requiredAgent: "document-writer",
    rationale:
      "Documentation changes must be delegated to document-writer for consistent style and quality.",
  },
  exceptions: {
    allowAgents: ["document-writer", "docs-publisher"],
    allowPaths: [".cursor/specs/", "context/specs/"], // Spec folders are OK
  },
  escalation: {
    strikesToBlock: 3,
    windowMs: 3600000, // 1 hour session window
  },
}

/**
 * Default delegation policy.
 */
export const DEFAULT_DELEGATION_POLICY: DelegationPolicy = {
  version: "1.0",
  rules: [DEFAULT_DOCS_POLICY_RULE],
}

/* --- Utility Functions --- */

/**
 * Check if a path matches any of the patterns.
 * Uses simple prefix/suffix matching (not full glob).
 */
export function matchesPathPattern(path: string, patterns: string[]): boolean {
  const normalized = path.startsWith("/") ? path.slice(1) : path

  for (const pattern of patterns) {
    // Exact match
    if (normalized === pattern) return true

    // Prefix match (pattern ends with /)
    if (pattern.endsWith("/") && normalized.startsWith(pattern)) return true

    // Suffix match (pattern starts with *)
    if (pattern.startsWith("*.") && normalized.endsWith(pattern.slice(1))) return true

    // Contains match (for README.*.md style patterns)
    if (pattern.includes("*")) {
      const parts = pattern.split("*")
      if (parts.length === 2) {
        const [prefix, suffix] = parts
        if (normalized.startsWith(prefix) && normalized.endsWith(suffix)) return true
      }
    }
  }

  return false
}

/**
 * Check if content contains any of the keywords (case-insensitive).
 */
export function matchesKeywords(content: string, keywords: string[]): boolean {
  const lower = content.toLowerCase()
  return keywords.some((kw) => lower.includes(kw.toLowerCase()))
}

/**
 * Check if the current agent is in the exception list.
 */
export function isAgentExcepted(agentName: string, exceptions?: DelegationPolicyException): boolean {
  if (!exceptions?.allowAgents) return false
  return exceptions.allowAgents.includes(agentName)
}

/**
 * Check if the path is in the exception allowlist.
 */
export function isPathExcepted(path: string, exceptions?: DelegationPolicyException): boolean {
  if (!exceptions?.allowPaths) return false
  return matchesPathPattern(path, exceptions.allowPaths)
}

/**
 * Evaluate a single rule against the given context.
 */
export function evaluateRule(
  rule: DelegationPolicyRule,
  context: {
    path?: string
    tool?: string
    content?: string
    currentAgent?: string
  }
): { matches: boolean; reason: string } {
  // Check agent exception first
  if (context.currentAgent && isAgentExcepted(context.currentAgent, rule.exceptions)) {
    return { matches: false, reason: `Agent ${context.currentAgent} is excepted` }
  }

  // Check path exception
  if (context.path && isPathExcepted(context.path, rule.exceptions)) {
    return { matches: false, reason: `Path ${context.path} is excepted` }
  }

  // Check path match (primary trigger)
  const pathMatches = context.path && rule.match.paths
    ? matchesPathPattern(context.path, rule.match.paths)
    : false

  // Check tool match (primary trigger)
  const toolMatches = context.tool && rule.match.tools
    ? rule.match.tools.includes(context.tool)
    : false

  // Primary triggers: path AND tool must match (if both specified)
  const primaryMatch = rule.match.paths && rule.match.tools
    ? pathMatches && toolMatches
    : pathMatches || toolMatches

  // Full match: primary match, optionally strengthened by keywords
  if (primaryMatch) {
    return {
      matches: true,
      reason: `Matched ${pathMatches ? "path" : ""}${pathMatches && toolMatches ? " and " : ""}${toolMatches ? "tool" : ""} pattern`,
    }
  }

  return { matches: false, reason: "No match" }
}

/**
 * Evaluate all rules in a policy against the given context.
 * Returns the first matching rule's result.
 */
export function evaluatePolicy(
  policy: DelegationPolicy,
  context: {
    path?: string
    tool?: string
    content?: string
    currentAgent?: string
  }
): PolicyEvaluationResult {
  for (const rule of policy.rules) {
    if (rule.mode === "disabled") continue

    const { matches } = evaluateRule(rule, context)

    if (matches) {
      const decision: PolicyDecision = rule.mode === "block" ? "blocked" : "warned"
      return {
        decision,
        matchedRule: rule,
        message: rule.require.rationale,
        remediation: `Delegate to ${rule.require.requiredAgent} using task(subagent_type="${rule.require.requiredAgent}")`,
      }
    }
  }

  return {
    decision: "allowed",
    message: "No policy rules matched",
  }
}
