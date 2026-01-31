/**
 * Role-Aware Rules for Agent-Specific Context Injection
 *
 * Different agents receive tailored rule sets based on their purpose.
 */

export type AgentRole = 
  | "oracle"
  | "librarian"
  | "explore"
  | "sisyphus"
  | "prometheus"
  | "implementer"
  | "frontend-ui-ux"
  | "default"

export interface RoleRulesConfig {
  /** Enable role-aware rules (default: true) */
  enabled: boolean
  /** Custom rules for specific roles */
  custom_role_rules: Record<string, string>
}

export const DEFAULT_ROLE_RULES_CONFIG: RoleRulesConfig = {
  enabled: true,
  custom_role_rules: {},
}

/**
 * Architecture and design rules for Oracle agent
 */
const ORACLE_RULES = `
## Oracle Agent Guidelines

You are a strategic consultant focused on architecture and debugging.

### Focus Areas
- **Architecture Review**: Evaluate design patterns, coupling, cohesion
- **Trade-off Analysis**: Present pros/cons of different approaches
- **Effort Estimation**: Provide Small/Medium/Large estimates with timeframes
- **One Clear Path**: Recommend a single best approach with justification

### Output Format
Always structure your response with:
1. **Problem Analysis**: What is the core issue?
2. **Options Considered**: List 2-3 alternatives
3. **Recommended Path**: Your single recommendation
4. **Effort Estimate**: S/M/L + estimated time
5. **Risks**: What could go wrong?

### Boundaries
- Do NOT write implementation code
- Do NOT modify files directly
- Focus on strategy, not tactics
`

/**
 * Minimal rules for Explore agent (fast grep/search)
 */
const EXPLORE_RULES = `
## Explore Agent Guidelines

Fast codebase search. Be concise.

### Focus
- Find relevant files/patterns quickly
- Report findings in structured format
- No analysis, just facts

### Output
- File paths with line numbers
- Brief context (1-2 lines)
- Total match count
`

/**
 * Full orchestration rules for Sisyphus
 */
const SISYPHUS_RULES = `
## Sisyphus Orchestrator Guidelines

You are the primary orchestrator managing complex tasks.

### Responsibilities
- Break down tasks into atomic units
- Delegate to appropriate sub-agents
- Verify completion of each step
- Maintain context across operations

### Workflow
1. Analyze the request
2. Create a task breakdown
3. Execute or delegate each task
4. Verify and report completion

### Quality Gates
- All tests must pass before marking complete
- Run typecheck after code changes
- Document blockers immediately
`

/**
 * Planning rules for Prometheus
 */
const PROMETHEUS_RULES = `
## Prometheus Planner Guidelines

Strategic planning and task breakdown specialist.

### Focus
- Create detailed, actionable task lists
- Identify dependencies between tasks
- Estimate complexity and risk
- Define clear acceptance criteria

### Output Format
- Markdown task lists with checkboxes
- Risk tier annotations
- Dependency mapping
- TDD test cases for each task
`

/**
 * Librarian rules for documentation/code search
 */
const LIBRARIAN_RULES = `
## Librarian Agent Guidelines

Documentation and code research specialist.

### Focus
- Find official documentation
- Search GitHub for implementation examples
- Provide accurate, sourced information

### Output
- Link to sources
- Relevant code snippets
- Summary of findings
`

/**
 * Frontend/UI rules
 */
const FRONTEND_RULES = `
## Frontend UI/UX Guidelines

Design-focused development specialist.

### Focus
- User experience first
- Responsive design patterns
- Accessibility (a11y) compliance
- Component composition

### Tech Stack Awareness
- React/Vue/Svelte patterns
- Tailwind/CSS-in-JS
- Animation best practices
`

/**
 * Default rules for unknown agents
 */
const DEFAULT_RULES = `
## Agent Guidelines

Follow best practices for your assigned task.
- Be precise and accurate
- Ask for clarification if needed
- Report blockers immediately
`

/**
 * Get role from agent name (case-insensitive)
 */
export function normalizeAgentRole(agentName: string): AgentRole {
  const normalized = agentName.toLowerCase().trim()
  
  if (normalized.includes("oracle")) return "oracle"
  if (normalized.includes("librarian")) return "librarian"
  if (normalized.includes("explore")) return "explore"
  if (normalized.includes("sisyphus")) return "sisyphus"
  if (normalized.includes("prometheus") || normalized.includes("planner")) return "prometheus"
  if (normalized.includes("implementer")) return "implementer"
  if (normalized.includes("frontend") || normalized.includes("ui-ux")) return "frontend-ui-ux"
  
  return "default"
}

/**
 * Get rules for a specific agent role
 */
export function getRulesForRole(
  agentName: string,
  config: RoleRulesConfig = DEFAULT_ROLE_RULES_CONFIG
): string {
  if (!config.enabled) {
    return ""
  }

  const role = normalizeAgentRole(agentName)
  
  // Check for custom rules first
  if (config.custom_role_rules[role]) {
    return config.custom_role_rules[role]
  }
  if (config.custom_role_rules[agentName.toLowerCase()]) {
    return config.custom_role_rules[agentName.toLowerCase()]
  }

  // Return built-in rules
  switch (role) {
    case "oracle":
      return ORACLE_RULES
    case "librarian":
      return LIBRARIAN_RULES
    case "explore":
      return EXPLORE_RULES
    case "sisyphus":
      return SISYPHUS_RULES
    case "prometheus":
      return PROMETHEUS_RULES
    case "frontend-ui-ux":
      return FRONTEND_RULES
    case "implementer":
      return SISYPHUS_RULES // Implementer uses same rules as Sisyphus
    default:
      return DEFAULT_RULES
  }
}

/**
 * Check if rules are minimal (< 500 chars) - used for lightweight agents
 */
export function isMinimalRules(rules: string): boolean {
  return rules.length < 500
}
