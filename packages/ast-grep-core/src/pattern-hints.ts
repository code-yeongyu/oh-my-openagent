import type { CliLanguage } from "./types"

export function detectRegexMisuse(pattern: string): string | null {
  const src = pattern.trim()

  if (/\\[wWdDsSbB]/.test(src)) {
    return 'Hint: "\\w", "\\d", "\\s", "\\b" are regex escapes. ast-grep matches AST nodes, not text - use $VAR for identifiers, $$$ for node lists, or switch to grep for text search.'
  }

  if (/\[[a-zA-Z0-9]-[a-zA-Z0-9]\]/.test(src)) {
    return 'Hint: "[a-z]" and similar character classes are regex, not AST. Use $VAR to match any identifier, or switch to grep for text search.'
  }

  if (!src.includes("$") && /\w\.[*+]/.test(src)) {
    return 'Hint: ".*" and ".+" are regex wildcards. In ast-grep use $$$ for multiple AST nodes and $VAR for a single node. For text patterns, switch to grep.'
  }

  if (/^[-\w.*]+\|[-\w.*|]+$/.test(src)) {
    return 'Hint: "|" is regex alternation and does NOT work in ast-grep patterns. Options: (a) fire one ast_grep_search per alternative, or (b) switch to grep with a regex pattern like "foo|bar".'
  }

  return null
}

export function detectLanguageSpecificMistake(
  pattern: string,
  lang: CliLanguage,
): string | null {
  const src = pattern.trim()

  if (lang === "python") {
    if (src.startsWith("class ") && src.endsWith(":")) {
      return `Hint: Remove trailing colon. Try: "${src.slice(0, -1)}"`
    }
    if ((src.startsWith("def ") || src.startsWith("async def ")) && src.endsWith(":")) {
      return `Hint: Remove trailing colon. Try: "${src.slice(0, -1)}"`
    }
  }

  if (["javascript", "typescript", "tsx"].includes(lang)) {
    if (/^(export\s+)?(async\s+)?function\s+\$[A-Z_]+\s*$/i.test(src)) {
      return 'Hint: Function patterns need params and body. Try "function $NAME($$$) { $$$ }"'
    }
  }

  if (lang === "go") {
    if (/^func\s+\$[A-Z_]+\s*$/i.test(src)) {
      return 'Hint: Go function patterns need params and body. Try "func $NAME($$$) { $$$ }"'
    }
  }

  if (lang === "rust") {
    if (/^fn\s+\$[A-Z_]+\s*$/i.test(src)) {
      return 'Hint: Rust fn patterns need params and body. Try "fn $NAME($$$) { $$$ }"'
    }
  }

  return null
}

export function getPatternHint(pattern: string, lang: CliLanguage): string | null {
  return detectRegexMisuse(pattern) ?? detectLanguageSpecificMistake(pattern, lang)
}
