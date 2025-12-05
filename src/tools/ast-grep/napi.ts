import { parse, Lang } from "@ast-grep/napi"
import { NAPI_LANGUAGES } from "./constants"
import type { NapiLanguage, AnalyzeResult, MetaVariable, Range } from "./types"

const LANG_MAP: Record<NapiLanguage, Lang> = {
  html: Lang.Html,
  javascript: Lang.JavaScript,
  tsx: Lang.Tsx,
  css: Lang.Css,
  typescript: Lang.TypeScript,
}

export function parseCode(code: string, lang: NapiLanguage) {
  const parseLang = LANG_MAP[lang]
  if (!parseLang) {
    const supportedLangs = NAPI_LANGUAGES.join(", ")
    throw new Error(
      `Unsupported language for NAPI: "${lang}"\n` +
        `Supported languages: ${supportedLangs}\n\n` +
        `Use ast_grep_search for other languages (25 supported via CLI).`
    )
  }
  return parse(parseLang, code)
}

export function findPattern(root: ReturnType<typeof parseCode>, pattern: string) {
  return root.root().findAll(pattern)
}

function nodeToRange(node: ReturnType<ReturnType<typeof parseCode>["root"]>): Range {
  const range = node.range()
  return {
    start: { line: range.start.line, column: range.start.column },
    end: { line: range.end.line, column: range.end.column },
  }
}

function extractMetaVariablesFromPattern(pattern: string): string[] {
  const matches = pattern.match(/\$[A-Z_][A-Z0-9_]*/g) || []
  return [...new Set(matches.map((m) => m.slice(1)))]
}

export function extractMetaVariables(
  node: ReturnType<ReturnType<typeof parseCode>["root"]>,
  pattern: string
): MetaVariable[] {
  const varNames = extractMetaVariablesFromPattern(pattern)
  const result: MetaVariable[] = []

  for (const name of varNames) {
    const match = node.getMatch(name)
    if (match) {
      result.push({
        name,
        text: match.text(),
        kind: String(match.kind()),
      })
    }
  }

  return result
}

export function analyzeCode(
  code: string,
  lang: NapiLanguage,
  pattern: string,
  shouldExtractMetaVars: boolean
): AnalyzeResult[] {
  const root = parseCode(code, lang)
  const matches = findPattern(root, pattern)

  return matches.map((node) => ({
    text: node.text(),
    range: nodeToRange(node),
    kind: String(node.kind()),
    metaVariables: shouldExtractMetaVars ? extractMetaVariables(node, pattern) : [],
  }))
}

export function transformCode(
  code: string,
  lang: NapiLanguage,
  pattern: string,
  rewrite: string
): { transformed: string; editCount: number } {
  const root = parseCode(code, lang)
  const matches = findPattern(root, pattern)

  if (matches.length === 0) {
    return { transformed: code, editCount: 0 }
  }

  const edits = matches.map((node) => {
    const metaVars = extractMetaVariables(node, pattern)
    let replacement = rewrite

    for (const mv of metaVars) {
      replacement = replacement.replace(new RegExp(`\\$${mv.name}`, "g"), mv.text)
    }

    return node.replace(replacement)
  })

  const transformed = root.root().commitEdits(edits)
  return { transformed, editCount: edits.length }
}

export function getRootInfo(code: string, lang: NapiLanguage): { kind: string; childCount: number } {
  const root = parseCode(code, lang)
  const rootNode = root.root()
  return {
    kind: String(rootNode.kind()),
    childCount: rootNode.children().length,
  }
}
