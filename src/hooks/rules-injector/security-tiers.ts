/**
 * Security Tiers for High-Risk Operation Detection
 *
 * Classifies operations by risk level and injects security analysis prompts.
 */

export type SecurityTier = "LOW" | "MEDIUM" | "HIGH"

export interface SecurityTierConfig {
  /** Enable security tier analysis (default: true) */
  enabled: boolean
  /** Inject security analysis prompt for HIGH tier (default: true) */
  inject_analysis_prompt: boolean
  /** Custom patterns for HIGH tier detection */
  high_tier_patterns: string[]
  /** Custom patterns for MEDIUM tier detection */
  medium_tier_patterns: string[]
}

export const DEFAULT_SECURITY_TIER_CONFIG: SecurityTierConfig = {
  enabled: true,
  inject_analysis_prompt: true,
  high_tier_patterns: [],
  medium_tier_patterns: [],
}

/**
 * Patterns that indicate HIGH risk operations (delete, execute, destructive)
 */
export const HIGH_RISK_PATTERNS: RegExp[] = [
  // File deletion
  /\brm\s+-[rf]+\b/i,
  /\brm\s+[^|&;]+/i,
  /\brmdir\b/i,
  /\bdel\s+\/[sfq]/i, // Windows del
  /\bRemove-Item\b/i, // PowerShell
  
  // Destructive git operations
  /\bgit\s+push\s+.*--force\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[fd]+/i,
  /\bgit\s+checkout\s+--\s+\./i,
  
  // Database destructive
  /\bDROP\s+(TABLE|DATABASE|INDEX|SCHEMA)\b/i,
  /\bTRUNCATE\s+TABLE\b/i,
  /\bDELETE\s+FROM\b.*\bWHERE\b.*[^=!<>]=\s*[^=]/i, // DELETE without WHERE clause check
  
  // System commands
  /\bsudo\s+rm\b/i,
  /\bchmod\s+777\b/i,
  /\bchown\s+-R\b.*root/i,
  
  // Container/VM destructive
  /\bdocker\s+rm\s+-f\b/i,
  /\bdocker\s+system\s+prune\b/i,
  /\bkubectl\s+delete\b/i,
  
  // Arbitrary code execution
  /\beval\s*\(/i,
  /\bexec\s*\(/i,
  /Function\s*\(\s*['"`]/i,
]

/**
 * Patterns that indicate MEDIUM risk operations (write, modify)
 */
export const MEDIUM_RISK_PATTERNS: RegExp[] = [
  // File write operations
  /\bmv\s+/i,
  /\bcp\s+/i,
  /\bchmod\b/i,
  /\bchown\b/i,
  
  // Git modifications
  /\bgit\s+commit\b/i,
  /\bgit\s+merge\b/i,
  /\bgit\s+rebase\b/i,
  /\bgit\s+stash\b/i,
  
  // Database modifications
  /\bUPDATE\s+\w+\s+SET\b/i,
  /\bINSERT\s+INTO\b/i,
  /\bALTER\s+TABLE\b/i,
  
  // Package management
  /\bnpm\s+install\b/i,
  /\bbun\s+add\b/i,
  /\bpip\s+install\b/i,
  /\byarn\s+add\b/i,
]

/**
 * Determine the security tier of an operation
 */
export function classifySecurityTier(
  tool: string,
  args: Record<string, unknown>,
  config: SecurityTierConfig = DEFAULT_SECURITY_TIER_CONFIG
): SecurityTier {
  const toolLower = tool.toLowerCase()
  
  // Read operations are always LOW
  if (toolLower === "read" || toolLower === "glob" || toolLower === "grep") {
    return "LOW"
  }
  
  // Check bash/command content for risk patterns
  if (toolLower === "bash" || toolLower === "shell" || toolLower === "command") {
    const command = (args.command ?? args.cmd ?? "") as string
    
    // Check HIGH risk patterns
    for (const pattern of HIGH_RISK_PATTERNS) {
      if (pattern.test(command)) {
        return "HIGH"
      }
    }
    
    // Check custom HIGH patterns
    for (const customPattern of config.high_tier_patterns) {
      if (new RegExp(customPattern, "i").test(command)) {
        return "HIGH"
      }
    }
    
    // Check MEDIUM risk patterns
    for (const pattern of MEDIUM_RISK_PATTERNS) {
      if (pattern.test(command)) {
        return "MEDIUM"
      }
    }
    
    // Check custom MEDIUM patterns
    for (const customPattern of config.medium_tier_patterns) {
      if (new RegExp(customPattern, "i").test(command)) {
        return "MEDIUM"
      }
    }
    
    return "LOW"
  }
  
  // Write/Edit operations are MEDIUM by default
  if (toolLower === "write" || toolLower === "edit" || toolLower === "multiedit") {
    return "MEDIUM"
  }
  
  return "LOW"
}

/**
 * Generate security analysis prompt for HIGH tier operations
 */
export function getSecurityAnalysisPrompt(
  tool: string,
  tier: SecurityTier,
  command?: string
): string | null {
  if (tier !== "HIGH") {
    return null
  }
  
  const commandPreview = command ? `\nCommand: \`${command.slice(0, 100)}${command.length > 100 ? "..." : ""}\`` : ""
  
  return `
[Security Analysis Required - HIGH RISK OPERATION]

Tool: ${tool}${commandPreview}

Before proceeding, you MUST provide a security analysis:

1. **Impact Assessment**: What files/data will be affected?
2. **Reversibility**: Can this operation be undone? How?
3. **Alternatives**: Is there a safer way to achieve the same goal?
4. **Confirmation**: Explicitly confirm you understand the risks.

⚠️ This operation has been classified as HIGH RISK. Proceed with caution.
`
}
