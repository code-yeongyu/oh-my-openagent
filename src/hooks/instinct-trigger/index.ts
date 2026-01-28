import { existsSync, readdirSync, readFileSync } from "fs"
import { join } from "path"
import { getClaudeConfigDir } from "../../shared/claude-config-dir"
import { parseFrontmatter } from "../../shared/frontmatter"
import { matchesTrigger, filterByConfidence, extractActionSection, type Instinct } from "./matcher"

interface InstinctFrontmatter {
  name?: string
  trigger?: string
  confidence?: number
  domain?: string
  instinct?: boolean
}

const CACHE_TTL = 60_000 // 1 minute

interface CacheEntry {
  instincts: Instinct[]
  timestamp: number
}

// Per-directory cache to support multiple config dirs
const cache = new Map<string, CacheEntry>()

function scanInstincts(claudeConfigDir: string): Instinct[] {
  const now = Date.now()
  const instinctsDir = join(claudeConfigDir, "skills", "instincts")
  
  // Return cached results if still valid for this directory
  const cached = cache.get(instinctsDir)
  if (cached && (now - cached.timestamp) < CACHE_TTL) {
    return cached.instincts
  }

  // Silently return empty if directory doesn't exist
  if (!existsSync(instinctsDir)) {
    cache.set(instinctsDir, { instincts: [], timestamp: now })
    return []
  }

  const instincts: Instinct[] = []

  try {
    const entries = readdirSync(instinctsDir, { withFileTypes: true })
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      
      const skillPath = join(instinctsDir, entry.name, "SKILL.md")
      if (!existsSync(skillPath)) continue

      try {
        const content = readFileSync(skillPath, "utf-8")
        const { data, body } = parseFrontmatter<InstinctFrontmatter>(content)

        // Only process if marked as instinct and has required fields
        if (!data.instinct || !data.name || !data.trigger || typeof data.confidence !== "number") {
          continue
        }

        const action = extractActionSection(body)

        instincts.push({
          name: data.name,
          trigger: data.trigger,
          confidence: data.confidence,
          domain: data.domain || "general",
          action,
        })
      } catch {
        // Skip malformed instinct files
        continue
      }
    }
  } catch {
    // Silently handle directory read errors
  }

  cache.set(instinctsDir, { instincts, timestamp: now })
  return instincts
}

// Export for testing - allows cache invalidation
export function clearInstinctCache(): void {
  cache.clear()
}

export function createInstinctTriggerHook(ctx: { claudeConfigDir?: string }) {
  const claudeConfigDir = ctx.claudeConfigDir || getClaudeConfigDir()

  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown> }
    ): Promise<void> => {
      // Scan instincts (uses cache if available)
      const allInstincts = scanInstincts(claudeConfigDir)
      
      // Filter by confidence threshold
      const qualifiedInstincts = filterByConfidence(allInstincts, 0.7)
      
      if (qualifiedInstincts.length === 0) return

      // Build search context from tool name and args
      const searchContext = [
        input.tool,
        JSON.stringify(output.args),
      ].join(" ")

      // Find matching instincts
      const matched = qualifiedInstincts.filter(instinct => 
        matchesTrigger(instinct, searchContext)
      )

      if (matched.length === 0) return

      // Inject actions into the first string argument we find
      const injections = matched
        .filter(i => i.action)
        .map(i => i.action)
        .join("\n\n")

      if (!injections) return

      // Find first string argument and inject (prioritize content-related keys)
      const priorityKeys = ["oldString", "newString", "content", "pattern", "prompt", "query"]
      const allKeys = Object.keys(output.args)
      const orderedKeys = [
        ...priorityKeys.filter(k => allKeys.includes(k)),
        ...allKeys.filter(k => !priorityKeys.includes(k))
      ]
      
      for (const key of orderedKeys) {
        if (typeof output.args[key] === "string") {
          output.args[key] = `${output.args[key]}\n\n${injections}`
          break
        }
      }
    },
  }
}
