import { extname } from "node:path"

export type RuleId =
  | "source-grep"
  | "prose-pin"
  | "fixed-sleep"
  | "focused"
  | "skipped"
  | "self-compare"
  | "lower-bound"

export type Language = "typescript" | "python" | "rust" | "go"

export type ReadKind = "prose" | "source"

export type LineRule = {
  readonly rule: RuleId
  readonly languages: readonly Language[]
  readonly pattern: RegExp
  readonly message: string
}

export const RULE_IDS: readonly RuleId[] = [
  "source-grep",
  "prose-pin",
  "fixed-sleep",
  "focused",
  "skipped",
  "self-compare",
  "lower-bound",
]

export function languageOf(file: string): Language | undefined {
  switch (extname(file)) {
    case ".ts":
    case ".tsx":
    case ".mts":
    case ".cts":
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return "typescript"
    case ".py":
      return "python"
    case ".rs":
      return "rust"
    case ".go":
      return "go"
    default:
      return undefined
  }
}

const SLEEP_MESSAGE = "fixed sleep: wait on the event or state change, not on the clock"
const SKIP_MESSAGE = "skipped test: fix the test or delete it with its proof; never park it"
const LOWER_BOUND_MESSAGE = "lower bound on a cardinality: removing one item stays green; pin the exact set"

export const LINE_RULES: readonly LineRule[] = [
  {
    rule: "fixed-sleep",
    languages: ["typescript"],
    pattern: /\bsetTimeout\s*\(\s*(resolve|res|r|done|cb)\s*,\s*[1-9]|\bawait\s+(Bun\.)?sleep\s*\(\s*[1-9]|new Promise\s*\(\s*\(?\s*\w*\s*\)?\s*=>\s*setTimeout\s*\(\s*\w+\s*,\s*[1-9]/,
    message: SLEEP_MESSAGE,
  },
  { rule: "fixed-sleep", languages: ["python"], pattern: /\btime\.sleep\s*\(|\bawait\s+(asyncio|anyio|trio)\.sleep\s*\(\s*[0-9]/, message: SLEEP_MESSAGE },
  { rule: "fixed-sleep", languages: ["rust"], pattern: /\bthread::sleep\s*\(|\btokio::time::sleep\s*\(/, message: SLEEP_MESSAGE },
  { rule: "fixed-sleep", languages: ["go"], pattern: /\btime\.Sleep\s*\(/, message: SLEEP_MESSAGE },
  {
    rule: "focused",
    languages: ["typescript"],
    pattern: /\b(test|it|describe)\.only\s*\(/,
    message: "focused test: the rest of the suite is skipped silently",
  },
  { rule: "skipped", languages: ["typescript"], pattern: /\b(test|it|describe)\.skip\s*\(|\b(xit|xdescribe|xtest)\s*\(/, message: SKIP_MESSAGE },
  { rule: "skipped", languages: ["python"], pattern: /@pytest\.mark\.skip\b|\bpytest\.skip\s*\(|\bunittest\.skip\b/, message: SKIP_MESSAGE },
  { rule: "skipped", languages: ["rust"], pattern: /#\[ignore\b/, message: SKIP_MESSAGE },
  { rule: "skipped", languages: ["go"], pattern: /\bt\.Skip(f|Now)?\s*\(/, message: SKIP_MESSAGE },
  {
    rule: "lower-bound",
    languages: ["typescript"],
    pattern: /\.(length|size|count)\s*\)\s*\.(toBeGreaterThan\s*\(\s*[1-9]|toBeGreaterThanOrEqual\s*\(\s*([2-9]|\d{2,}))/,
    message: LOWER_BOUND_MESSAGE,
  },
  {
    rule: "lower-bound",
    languages: ["python"],
    pattern: /\bassert\s+len\s*\(.+\)\s*(>\s*[1-9]|>=\s*([2-9]|\d{2,}))/,
    message: LOWER_BOUND_MESSAGE,
  },
]

export const SELF_COMPARE: Readonly<Record<Language, RegExp>> = {
  typescript: /\bexpect\s*\(\s*([^()]+?)\s*\)\s*\.(toBe|toEqual|toStrictEqual)\s*\(\s*\1\s*\)/,
  python: /\bassert\s+([A-Za-z_][\w.]*)\s*==\s*\1\s*(#|$)/,
  rust: /\bassert_eq!\s*\(\s*([^,()]+?)\s*,\s*\1\s*\)/,
  go: /\b(Equal|Exactly)\s*\(\s*t\s*,\s*([^,()]+?)\s*,\s*\2\s*\)/,
}

const SOURCE_EXTENSIONS = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py|rs|go)$/
const PROSE_EXTENSIONS = /\.(md|mdc|txt|prompt)$/
const READ_ASSIGNMENT = /\b(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s+)?(?:\w+\.)?(?:readFileSync|readFile|readTextSync|Bun\.file|open|read_text|read)\s*\(([^\n]*)$/
const PYTHON_READ_ASSIGNMENT = /^\s*(\w+)\s*=\s*(?:\w+\.)?(?:open|Path|read_text)\s*\(([^\n]*)$/
const STRING_LITERAL = /["'`]([^"'`]+)["'`]/g

function readKindOf(callArguments: string): ReadKind | undefined {
  for (const literal of callArguments.matchAll(STRING_LITERAL)) {
    const value = literal[1] ?? ""
    if (PROSE_EXTENSIONS.test(value)) return "prose"
    if (SOURCE_EXTENSIONS.test(value)) return "source"
  }
  return undefined
}

export function collectReadVariables(lines: readonly string[], language: Language): ReadonlyMap<string, ReadKind> {
  const variables = new Map<string, ReadKind>()
  const pattern = language === "python" ? PYTHON_READ_ASSIGNMENT : READ_ASSIGNMENT
  for (const line of lines) {
    const match = pattern.exec(line)
    if (match === null) continue
    const kind = readKindOf(match[2] ?? "")
    if (kind !== undefined && match[1] !== undefined) variables.set(match[1], kind)
  }
  return variables
}

export function greppedVariable(line: string, language: Language): string | undefined {
  if (language === "python") {
    return /\bassert\s+(?:not\s+)?["'][^"']*["']\s+(?:not\s+)?in\s+(\w+)/.exec(line)?.[1]
  }
  return (
    /\bexpect\s*\(\s*(\w+)\s*\)\s*(?:\.not)?\.(?:toContain|toMatch|toMatchSnapshot|toMatchInlineSnapshot|toInclude|toStartWith|toEndWith)\s*\(/.exec(line)?.[1] ??
    /\bexpect\s*\(\s*(\w+)\.(?:includes|match|indexOf|search)\s*\(/.exec(line)?.[1]
  )
}

export const READ_RULE_MESSAGES: Readonly<Record<ReadKind, { readonly rule: RuleId; readonly message: string }>> = {
  prose: { rule: "prose-pin", message: "wording of a prompt/skill/doc is pinned; assert a machine-consumed value or write no test" },
  source: { rule: "source-grep", message: "a source file is grepped as text; drive the module and assert behavior" },
}
