import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

const CACHE_DIR = ".agentic-loop/cache"
const PATTERNS_FILE = "patterns.json"

export interface PatternCache {
  wrapperApiPattern?: {
    layers: string[]
    imports: string[]
    encryptionModule: string
    commonTypes: string[]
    lastUpdated: string
  }
  coreApiPattern?: {
    layers: string[]
    commonModules: string[]
    lastUpdated: string
  }
  typeMappings?: Record<string, string>
  commonImports?: string[]
  fileStructure?: {
    wrapperDir: string
    coreDir: string
    lastUpdated: string
  }
}

function getCachePath(workspaceRoot: string): string {
  return join(workspaceRoot, CACHE_DIR, PATTERNS_FILE)
}

export function loadPatternCache(workspaceRoot: string): PatternCache | undefined {
  const cachePath = getCachePath(workspaceRoot)
  
  if (!existsSync(cachePath)) {
    return undefined
  }

  try {
    const content = readFileSync(cachePath, "utf-8")
    return JSON.parse(content) as PatternCache
  } catch {
    return undefined
  }
}

export function savePatternCache(workspaceRoot: string, cache: PatternCache): void {
  const cacheDir = join(workspaceRoot, CACHE_DIR)
  
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true })
  }

  const cachePath = getCachePath(workspaceRoot)
  writeFileSync(cachePath, JSON.stringify(cache, null, 2), "utf-8")
}

export function invalidatePatternCache(workspaceRoot: string): void {
  const cachePath = getCachePath(workspaceRoot)
  
  if (existsSync(cachePath)) {
    const cache = loadPatternCache(workspaceRoot)
    if (cache) {
      savePatternCache(workspaceRoot, {
        ...cache,
        wrapperApiPattern: undefined,
        coreApiPattern: undefined,
      })
    }
  }
}

export function isCacheStale(cache: PatternCache, maxAgeHours: number = 24): boolean {
  if (!cache.wrapperApiPattern?.lastUpdated) {
    return true
  }

  const lastUpdated = new Date(cache.wrapperApiPattern.lastUpdated)
  const now = new Date()
  const hoursSinceUpdate = (now.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60)

  return hoursSinceUpdate > maxAgeHours
}

export function formatPatternCacheForPrompt(cache: PatternCache): string {
  const parts: string[] = []

  if (cache.wrapperApiPattern) {
    parts.push(`## Wrapper API Pattern (4-Layer Architecture)
- Layers: ${cache.wrapperApiPattern.layers.join(" → ")}
- Common Imports: ${cache.wrapperApiPattern.imports.join(", ")}
- Encryption: ${cache.wrapperApiPattern.encryptionModule}
- Types: ${cache.wrapperApiPattern.commonTypes.join(", ")}`)
  }

  if (cache.coreApiPattern) {
    parts.push(`## Core API Pattern (6-Layer Architecture)
- Layers: ${cache.coreApiPattern.layers.join(" → ")}
- Common Modules: ${cache.coreApiPattern.commonModules.join(", ")}`)
  }

  if (cache.commonImports) {
    parts.push(`## Common Imports
${cache.commonImports.map(imp => `- ${imp}`).join("\n")}`)
  }

  if (cache.typeMappings) {
    parts.push(`## Type Mappings
${Object.entries(cache.typeMappings).map(([k, v]) => `- ${k}: ${v}`).join("\n")}`)
  }

  if (cache.fileStructure) {
    parts.push(`## File Structure
- Wrapper: ${cache.fileStructure.wrapperDir}
- Core: ${cache.fileStructure.coreDir}`)
  }

  return parts.join("\n\n")
}
