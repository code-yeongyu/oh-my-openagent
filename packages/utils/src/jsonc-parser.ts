import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parse, ParseError, printParseErrorCode } from "jsonc-parser"

export interface JsoncParseResult<T> {
  data: T | null
  errors: Array<{ message: string; offset: number; length: number }>
}

type DetectPluginConfigResult = {
  format: "json" | "jsonc" | "none"
  path: string
  legacyPath?: string
}

export interface DetectPluginConfigFileOptions {
  readonly basenames: readonly [string, ...string[]]
  readonly legacyBasenames?: readonly string[]
}

const pluginConfigFileDetectionCache = new Map<string, DetectPluginConfigResult>()

function getPluginConfigCacheKey(dir: string, options: DetectPluginConfigFileOptions): string {
  const basenames = [...options.basenames].join(",")
  const legacyBasenames = options.legacyBasenames ? [...options.legacyBasenames].join(",") : ""
  return `${dir}::${basenames}::${legacyBasenames}`
}

function stripBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content
}

export function parseJsonc<T = unknown>(content: string): T {
  const errors: ParseError[] = []
  const result = parse(stripBom(content), errors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as T

  if (errors.length > 0) {
    const errorMessages = errors
      .map((e) => `${printParseErrorCode(e.error)} at offset ${e.offset}`)
      .join(", ")
    throw new SyntaxError(`JSONC parse error: ${errorMessages}`)
  }

  return result
}

export function parseJsoncSafe<T = unknown>(content: string): JsoncParseResult<T> {
  const errors: ParseError[] = []
  const data = parse(stripBom(content), errors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as T | null

  return {
    data: errors.length > 0 ? null : data,
    errors: errors.map((e) => ({
      message: printParseErrorCode(e.error),
      offset: e.offset,
      length: e.length,
    })),
  }
}

export function readJsoncFile<T = unknown>(filePath: string): T | null {
  try {
    const content = readFileSync(filePath, "utf-8")
    return parseJsonc<T>(content)
  } catch {
    return null
  }
}

export function detectConfigFile(basePath: string): {
  format: "json" | "jsonc" | "none"
  path: string
} {
  const jsoncPath = `${basePath}.jsonc`
  const jsonPath = `${basePath}.json`

  if (existsSync(jsoncPath)) {
    return { format: "jsonc", path: jsoncPath }
  }
  if (existsSync(jsonPath)) {
    return { format: "json", path: jsonPath }
  }
  return { format: "none", path: jsonPath }
}

export function clearPluginConfigFileDetectionCache(): void {
  pluginConfigFileDetectionCache.clear()
}

export function detectPluginConfigFile(
  dir: string,
  options: DetectPluginConfigFileOptions,
): DetectPluginConfigResult {
  const cacheKey = getPluginConfigCacheKey(dir, options)
  const cachedResult = pluginConfigFileDetectionCache.get(cacheKey)

  if (cachedResult !== undefined) {
    return cachedResult
  }

  const canonicalBasename = options.basenames[0]
  const canonicalResult = detectConfigFile(join(dir, canonicalBasename))
  const legacyResults = (options.legacyBasenames ?? []).map((legacyBasename) =>
    detectConfigFile(join(dir, legacyBasename)),
  )
  const firstExistingLegacyResult = legacyResults.find((result) => result.format !== "none")

  let detectionResult: DetectPluginConfigResult

  if (canonicalResult.format !== "none") {
    detectionResult = {
      ...canonicalResult,
      legacyPath: firstExistingLegacyResult?.path,
    }
  } else if (firstExistingLegacyResult) {
    detectionResult = firstExistingLegacyResult
  } else {
    detectionResult = { format: "none", path: join(dir, `${canonicalBasename}.json`) }
  }

  pluginConfigFileDetectionCache.set(cacheKey, detectionResult)

  return detectionResult
}
