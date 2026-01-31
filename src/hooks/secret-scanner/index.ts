/**
 * Secret Scanner Hook
 *
 * Detects sensitive information (API keys, passwords, etc.) in content
 * before it's written to disk. Blocks or warns based on configuration.
 */

import type { SecretScannerConfig, ScanResult, SecretMatch } from "./types"
import { DEFAULT_SECRET_SCANNER_CONFIG, SECRET_PATTERNS, SAFE_PATTERNS } from "./patterns"

/**
 * Check if a path matches any whitelist pattern
 */
function isWhitelisted(filePath: string, whitelistPatterns: string[]): boolean {
  const normalizedPath = filePath.replace(/\\/g, "/")
  
  for (const pattern of whitelistPatterns) {
    // Simple glob matching for common patterns
    // Escape special regex chars except * and ?
    let regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, "<<<GLOBSTAR>>>")
      .replace(/\*/g, "[^/]*")
      .replace(/<<<GLOBSTAR>>>/g, ".*")
      .replace(/\?/g, ".")
    
    // Match full path - ** at start means can match from beginning
    const regex = new RegExp(`^${regexPattern}$|/${regexPattern}$`)
    if (regex.test(normalizedPath)) {
      return true
    }
  }
  
  return false
}

/**
 * Check if the matched text is actually a safe pattern (env var reference, placeholder, etc.)
 */
function isSafeContext(content: string, matchStart: number, matchEnd: number): boolean {
  // Get surrounding context (100 chars before and after)
  const contextStart = Math.max(0, matchStart - 100)
  const contextEnd = Math.min(content.length, matchEnd + 100)
  const context = content.slice(contextStart, contextEnd)
  
  return SAFE_PATTERNS.some(pattern => pattern.test(context))
}

/**
 * Redact a secret for display (show first and last 2 chars)
 */
function redactSecret(text: string): string {
  if (text.length <= 8) {
    return "*".repeat(text.length)
  }
  return text.slice(0, 2) + "*".repeat(text.length - 4) + text.slice(-2)
}

/**
 * Scan content for secrets
 */
export function scanContent(
  content: string,
  filePath: string,
  config: SecretScannerConfig = DEFAULT_SECRET_SCANNER_CONFIG
): ScanResult {
  // Check whitelist
  if (isWhitelisted(filePath, config.whitelist_paths)) {
    return {
      hasSecrets: false,
      matches: [],
      shouldBlock: false,
    }
  }

  const matches: SecretMatch[] = []
  const lines = content.split("\n")

  for (const pattern of SECRET_PATTERNS) {
    let lineNumber = 0
    for (const line of lines) {
      lineNumber++
      
      const match = line.match(pattern.pattern)
      if (match) {
        const matchStart = content.indexOf(line)
        const matchEnd = matchStart + line.length
        
        // Skip if it's a safe context (env var reference, placeholder, etc.)
        if (isSafeContext(content, matchStart, matchEnd)) {
          continue
        }
        
        matches.push({
          pattern,
          matchedText: redactSecret(match[0]),
          lineNumber,
        })
      }
    }
  }

  const hasSecrets = matches.length > 0
  const shouldBlock = hasSecrets && 
    config.block_on_detection &&
    matches.some(m => config.block_severity_levels.includes(m.pattern.severity))

  let message: string | undefined
  if (hasSecrets) {
    const criticalCount = matches.filter(m => m.pattern.severity === "critical").length
    const highCount = matches.filter(m => m.pattern.severity === "high").length
    
    message = `[Secret Scanner] Detected ${matches.length} potential secret(s) in ${filePath}:\n`
    message += matches
      .slice(0, 5) // Show max 5 matches
      .map(m => `  - Line ${m.lineNumber}: ${m.pattern.description} (${m.pattern.severity})`)
      .join("\n")
    
    if (matches.length > 5) {
      message += `\n  ... and ${matches.length - 5} more`
    }
    
    if (shouldBlock) {
      message += "\n\n⛔ Edit blocked. Remove secrets or use environment variables."
    } else {
      message += "\n\n⚠️ Warning: Consider using environment variables instead of hardcoded secrets."
    }
  }

  return {
    hasSecrets,
    matches,
    shouldBlock,
    message,
  }
}

export interface SecretScannerHookContext {
  cwd: string
  log?: (message: string) => void
}

export interface SecretScannerHookOptions {
  config?: Partial<SecretScannerConfig>
}

/**
 * Create the Secret Scanner Hook
 */
export function createSecretScannerHook(
  ctx: SecretScannerHookContext,
  options: SecretScannerHookOptions = {}
) {
  const config: SecretScannerConfig = {
    ...DEFAULT_SECRET_SCANNER_CONFIG,
    ...options.config,
  }

  return {
    name: "secret-scanner",
    
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: {
        args: Record<string, unknown>
        blocked?: boolean
        message?: string
      }
    ): Promise<void> => {
      // Only intercept Edit and Write tools
      const toolLower = input.tool.toLowerCase()
      if (toolLower !== "edit" && toolLower !== "write") {
        return
      }

      // Check if hook is enabled
      if (!config.enabled) {
        return
      }

      // Get file path and content from args
      const filePath = (output.args.filePath ?? output.args.file_path ?? output.args.path) as string | undefined
      const content = (output.args.content ?? output.args.newString ?? output.args.new_string) as string | undefined

      if (!filePath || !content) {
        return
      }

      // Scan for secrets
      const result = scanContent(content, filePath, config)

      if (result.hasSecrets) {
        if (ctx.log) {
          ctx.log(result.message || `[Secret Scanner] Found ${result.matches.length} potential secret(s)`)
        }

        if (result.shouldBlock) {
          output.blocked = true
          output.message = result.message
        }
      }
    },
  }
}

export { DEFAULT_SECRET_SCANNER_CONFIG } from "./patterns"
export type { SecretScannerConfig, ScanResult, SecretMatch } from "./types"
