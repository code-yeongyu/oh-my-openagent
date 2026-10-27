import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import ts from "@typescript/typescript6"

const MESSAGE = "No em dashes in product copy. Use a period, comma, colon, or parentheses instead."

// These embedded directives and runtime bundles are generated from source outside this check's scope.
const GENERATED_SOURCES = new Set([
  "packages/omo-codex/plugin/components/ultrawork/src/directive-content.ts",
  "packages/omo-senpi/src/components/ultrawork/generated-directive.ts",
])
const SHIPPED_SKILL_SYNC_SCRIPTS = new Set([
  "packages/omo-codex/plugin/scripts/sync-skills.mjs",
  "packages/omo-senpi/plugin/scripts/sync-skills.mjs",
])
const SENPI_SYNC_HEADING_MATCHERS = new Set([
  "## ABSOLUTE RULE: YOU ARE AN ORCHESTRATOR — NEVER THE IMPLEMENTER",
  "## ABSOLUTE RULE (root session): YOU ARE AN ORCHESTRATOR — NEVER THE IMPLEMENTER",
])

export function isProductSource(path: string): boolean {
  return /\.[cm]?[jt]sx?$/.test(path)
    && /^(?:(?:src|app|lib|workers|bin)\/|packages\/[^/]+\/(?:src|app|lib|components|i18n|plugin)\/|packages\/omo-native\/bin\/|packages\/shared-skills\/skills\/[^/]+\/(?:[^/]+\/)*scripts\/)/.test(path)
    && !/(?:^|\/)(?:__tests__|tests?|testkit|fixtures|testUtils|_generated|vendor|vendored|upstreams|node_modules|dist|install-dist)(?:\/|$)/.test(path)
    && (!/(?:^|\/)scripts\//.test(path)
      || /^packages\/shared-skills\/skills\//.test(path)
      || SHIPPED_SKILL_SYNC_SCRIPTS.has(path))
    && !/\.(?:test|spec|testkit|gen|generated)\.|\.d\.[cm]?ts$/.test(path)
    && !/(?:^|\/)testUtils\.[cm]?[jt]sx?$/.test(path)
    && !/^packages\/(?:lsp-daemon|lsp-tools-mcp)\//.test(path)
    && !/^packages\/omo-senpi\/plugin\/(?:extensions|runtime)\//.test(path)
    && !GENERATED_SOURCES.has(path)
}

export function findEmDashCopy(content: string, path: string): { line: number; column: number }[] {
  if (!isProductSource(path)) return []
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true)
  const hits: { line: number; column: number }[] = []
  const visit = (node: ts.Node): void => {
    // These skill parsers use the character as data, not as display copy.
    if (path === "packages/omo-senpi/plugin/scripts/sync-skills.mjs"
      && ts.isStringLiteralLike(node) && SENPI_SYNC_HEADING_MATCHERS.has(node.text)) return
    if (path === "packages/shared-skills/skills/ulw-research/scripts/entities.mjs"
      && ts.isPropertyAssignment(node) && node.name.getText(source) === "mdash") return
    if (path === "packages/shared-skills/skills/ulw-research/scripts/gates-text.mjs"
      && ts.isVariableDeclaration(node) && node.name.getText(source) === "EM_DASH") return
    // The OXC em-dash lint rule must name the character it forbids.
    if (path === "packages/shared-skills/skills/programming/scripts/typescript/oxc/lint/oxlint-plugin/no-em-dash-copy.js"
      && ts.isVariableDeclaration(node) && node.name.getText(source) === "EM_DASH") return
    if ((ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node)
      || ts.isTemplateTail(node) || ts.isJsxText(node)) && node.text.includes("\u2014")) {
      const position = source.getLineAndCharacterOfPosition(node.getStart(source))
      hits.push({ line: position.line + 1, column: position.character + 1 })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return hits
}

export function findUnexplainedSuppressions(content: string, path: string): { line: number; column: number }[] {
  if (!isProductSource(path)) return []
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true)
  const comments = new Map<number, ts.CommentRange>()
  const visit = (node: ts.Node): void => {
    const positions = [node.pos, node.end]
    if (ts.isJsxExpression(node)) positions.push(node.getStart(source) + 1)
    for (const position of positions) {
      for (const range of [
        ...ts.getLeadingCommentRanges(content, position) ?? [],
        ...ts.getTrailingCommentRanges(content, position) ?? [],
      ]) comments.set(range.pos, range)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  const parsed = [...comments.values()].sort((a, b) => a.pos - b.pos).map((range) => {
    const start = source.getLineAndCharacterOfPosition(range.pos)
    const end = source.getLineAndCharacterOfPosition(range.end)
    const text = content.slice(range.pos + 2, range.end - (range.kind === ts.SyntaxKind.MultiLineCommentTrivia ? 2 : 0))
    return { start, end, text, ownLine: !content.slice(source.getPositionOfLineAndCharacter(start.line, 0), range.pos).trim() }
  })
  const ownLines = new Map(parsed.filter((comment) => comment.ownLine).map((comment) => [comment.end.line, comment]))
  const directive = /^\s*\*?\s*(?:(?:oxlint|eslint)-(?:disable|enable)|biome-ignore|@ts-(?:expect-error|ignore|nocheck)|@effect-diagnostics)/
  const hits: { line: number; column: number }[] = []
  for (const comment of parsed) {
    const lint = /^\s*\*?\s*(?:oxlint|eslint)-disable(?:-next-line|-line)?(?![\w-])([\s\S]*)$/.exec(comment.text)
    const typescript = /^\s*\*?\s*@ts-(?:expect-error|ignore|nocheck)(?![\w-])([\s\S]*)$/.exec(comment.text)
    const biome = /^\s*\*?\s*biome-ignore(?:-all|-start)?(?![\w-])([\s\S]*)$/.exec(comment.text)
    if (!lint && !typescript && !biome) continue
    const reason = lint ? /--\s*\S/.test(lint[1] ?? "")
      : typescript ? !!(typescript[1] ?? "").replace(/^[\s:-]+/, "").trim()
      : /:\s*\S/.test(biome?.[1] ?? "")
    if (reason) continue
    let above = ownLines.get(comment.start.line - 1)
    while (above && (directive.test(above.text) || /^[\s*]*$/.test(above.text))) {
      above = ownLines.get(above.start.line - 1)
    }
    if (!above) hits.push({ line: comment.start.line + 1, column: comment.start.character + 1 })
  }
  return hits
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..")
  const paths = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  }).split("\0").filter(isProductSource)
  let count = 0
  for (const path of new Set(paths)) {
    const content = readFileSync(resolve(root, path), "utf8")
    for (const hit of findEmDashCopy(content, path)) {
      console.error(`${path}:${hit.line}:${hit.column}: ${MESSAGE}`)
      count += 1
    }
    for (const hit of findUnexplainedSuppressions(content, path)) {
      console.error(`${path}:${hit.line}:${hit.column}: Say why: give the suppression reason after the directive or in a comment on the line above.`)
      count += 1
    }
  }
  console.log(`check:copy: ${count} violation(s)`)
  process.exitCode = count > 0 ? 1 : 0
}
