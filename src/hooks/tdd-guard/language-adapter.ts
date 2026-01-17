/**
 * Language Adapter
 *
 * Detects programming language and test file patterns.
 * Adapted from superpowers-fusion/lib/language-adapter.ts
 */

import type { SupportedLanguage } from "./types"
import { LANGUAGE_PATTERNS } from "./constants"

/**
 * Detect language from file path
 */
export function detectLanguage(filePath: string): SupportedLanguage {
  const lower = filePath.toLowerCase()

  for (const [lang, patterns] of Object.entries(LANGUAGE_PATTERNS)) {
    if (lang === "unknown") continue
    if (patterns.extension.some((ext) => lower.endsWith(ext))) {
      return lang as SupportedLanguage
    }
  }

  return "unknown"
}

/**
 * Check if file is a test file
 */
export function isTestFile(filePath: string, language?: SupportedLanguage): boolean {
  const lang = language ?? detectLanguage(filePath)
  const patterns = LANGUAGE_PATTERNS[lang]

  if (!patterns || patterns.testPatterns.length === 0) {
    return false
  }

  // Normalize path for consistent matching
  const normalizedPath = filePath.replace(/\\/g, "/")
  const fileName = normalizedPath.split("/").pop() ?? ""
  
  return patterns.testPatterns.some((p) => p.test(fileName) || p.test(normalizedPath))
}

/**
 * Get assertion patterns for a language
 */
export function getAssertionPatterns(language: SupportedLanguage): RegExp[] {
  return LANGUAGE_PATTERNS[language]?.assertionPatterns ?? []
}

/**
 * Check if content contains assertions
 */
export function hasAssertions(content: string, language: SupportedLanguage): boolean {
  const patterns = getAssertionPatterns(language)
  return patterns.some((p) => p.test(content))
}

/**
 * Get the expected test file path for a source file
 */
export function getExpectedTestFilePath(filePath: string): string | null {
  const lang = detectLanguage(filePath)
  
  if (lang === "unknown") {
    return null
  }

  const normalizedPath = filePath.replace(/\\/g, "/")
  
  // Handle TypeScript/JavaScript
  if (lang === "typescript" || lang === "javascript") {
    // src/foo.ts -> src/foo.test.ts
    const ext = lang === "typescript" ? ".ts" : ".js"
    const baseWithoutExt = normalizedPath.replace(/\.(tsx?|jsx?)$/, "")
    return `${baseWithoutExt}.test${ext}`
  }
  
  // Handle Python
  if (lang === "python") {
    // src/foo.py -> src/test_foo.py or tests/test_foo.py
    const parts = normalizedPath.split("/")
    const fileName = parts.pop() ?? ""
    const baseName = fileName.replace(/\.py$/, "")
    parts.push(`test_${baseName}.py`)
    return parts.join("/")
  }
  
  // Handle Go
  if (lang === "go") {
    // foo.go -> foo_test.go
    return normalizedPath.replace(/\.go$/, "_test.go")
  }
  
  return null
}
