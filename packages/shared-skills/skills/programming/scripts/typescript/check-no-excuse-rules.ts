#!/usr/bin/env bun
/**
 * Check TypeScript files for no-excuse violations.
 *
 * Rules:
 *   no-any-assertion       - `as any`
 *   no-unknown-assertion    - `as unknown`
 *   no-ts-ignore            - `@ts-ignore` comments
 *   no-ts-expect-error      - `@ts-expect-error` comments
 *   no-enum                 - `enum` declarations
 *   no-non-null-assertion   - `x!` postfix operator
 *   no-throw-literal        - `throw "string"` / `throw 123`
 *   no-mutable-export       - `export let` / `export var`
 *   no-any-annotation       - `: any` in annotations (opt out: `// no-excuse-ok: any`)
 *   no-explicit-any-return  - `(): any` return types (opt out: `// no-excuse-ok: any`)
 *   empty-catch             - `catch { }` or `catch (e) { }` with empty body
 *   catch-without-narrowing - catch block that uses error without instanceof narrowing
 *   no-prose-assertion      - natural-language assertions in test files
 *
 * Usage:
 *   bun run scripts/check-no-excuse-rules.ts <file-or-dir>...
 *
 * Exit codes:
 *   0 - no violations
 *   1 - violations found
 *   2 - input error
 */

import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import ts from "typescript"

type RuleId =
  | "no-any-assertion"
  | "no-unknown-assertion"
  | "no-ts-ignore"
  | "no-ts-expect-error"
  | "no-enum"
  | "no-non-null-assertion"
  | "no-throw-literal"
  | "no-mutable-export"
  | "no-any-annotation"
  | "no-explicit-any-return"
  | "empty-catch"
  | "catch-without-narrowing"
  | "no-prose-assertion"

type Violation = {
  readonly ruleId: RuleId
  readonly filePath: string
  readonly line: number
  readonly column: number
  readonly message: string
}

const INCLUDED_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"])
const IGNORED_DIRECTORIES = new Set([
  ".git", ".next", ".nuxt", ".turbo", ".yarn",
  "coverage", "dist", "build", "node_modules",
])

const OPT_OUT_RE = /\/\/\s*no-excuse-ok:\s*any/
const CATCH_OK_RE = /\/\/\s*no-excuse-ok:\s*catch/
const PROSE_ASSERTION_OK_RE = /\/\/\s*no-excuse-ok:\s*no-prose-assertion/
const PROSE_STRING_ASSERTION_MATCHERS = new Set(["toContain", "toMatch", "toBe"])
const MACHINE_STRING_RE = /[<>{}\[\]\\/:=]|(?:^|\s)--/
const PROSE_WORD_RE = /[A-Za-z][A-Za-z0-9'-]*/g

function isIncludedFile(filePath: string): boolean {
  return INCLUDED_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

function isDeclarationFile(filePath: string): boolean {
  return filePath.endsWith(".d.ts") || filePath.endsWith(".d.mts") || filePath.endsWith(".d.cts")
}

function isTestFile(filePath: string): boolean {
  return /\.(test|spec)\.[^.]+$/i.test(path.basename(filePath)) || /(^|[\\/])__tests__([\\/]|$)/.test(filePath)
}

function isNaturalLanguageProse(value: string): boolean {
  if (MACHINE_STRING_RE.test(value)) return false
  return (value.match(PROSE_WORD_RE)?.length ?? 0) >= 3
}

function discoverFiles(inputs: string[]): string[] {
  const files: string[] = []
  for (const input of inputs) {
    const resolved = path.resolve(input)
    if (!fs.existsSync(resolved)) {
      console.error(`Path does not exist: ${resolved}`)
      process.exit(2)
    }
    if (fs.statSync(resolved).isFile()) {
      if (isIncludedFile(resolved) && !isDeclarationFile(resolved)) files.push(resolved)
      continue
    }
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (!IGNORED_DIRECTORIES.has(entry.name)) walk(path.join(dir, entry.name))
        } else if (isIncludedFile(entry.name) && !isDeclarationFile(entry.name)) {
          files.push(path.join(dir, entry.name))
        }
      }
    }
    walk(resolved)
  }
  return files
}

function getLineText(sourceFile: ts.SourceFile, line: number): string {
  const lineStarts = sourceFile.getLineStarts()
  const start = lineStarts[line]
  const end = line + 1 < lineStarts.length ? lineStarts[line + 1] : sourceFile.getEnd()
  return sourceFile.text.slice(start, end)
}

function analyzeFile(filePath: string): Violation[] {
  const source = fs.readFileSync(filePath, "utf-8")
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true)
  const violations: Violation[] = []

  function pos(node: ts.Node): { line: number; column: number } {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    return { line: line + 1, column: character + 1 }
  }

  function lineHasOptOut(node: ts.Node): boolean {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    return OPT_OUT_RE.test(getLineText(sourceFile, line))
  }

  function visit(node: ts.Node): void {
    // ── as any / as unknown ──
    if (ts.isAsExpression(node)) {
      const typeText = node.type.getText(sourceFile)
      if (typeText === "any") {
        const p = pos(node)
        violations.push({ ruleId: "no-any-assertion", filePath, ...p, message: "`as any` — narrow with type guards or redesign the types" })
      }
      if (typeText === "unknown") {
        const p = pos(node)
        violations.push({ ruleId: "no-unknown-assertion", filePath, ...p, message: "`as unknown` — redesign the types" })
      }
    }

    // ── enum ──
    if (ts.isEnumDeclaration(node)) {
      const p = pos(node)
      violations.push({ ruleId: "no-enum", filePath, ...p, message: "`enum` — use `as const` object + literal union type" })
    }

    // ── x! non-null assertion ──
    if (ts.isNonNullExpression(node)) {
      const p = pos(node)
      violations.push({ ruleId: "no-non-null-assertion", filePath, ...p, message: "`x!` — use narrowing or optional chaining" })
    }

    // ── throw "literal" ──
    if (ts.isThrowStatement(node) && node.expression) {
      const expr = node.expression
      if (ts.isStringLiteral(expr) || ts.isNumericLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
        const p = pos(node)
        violations.push({ ruleId: "no-throw-literal", filePath, ...p, message: "`throw literal` — throw an Error subclass" })
      }
      if (ts.isTemplateExpression(expr)) {
        const p = pos(node)
        violations.push({ ruleId: "no-throw-literal", filePath, ...p, message: "`throw template` — throw an Error subclass" })
      }
    }

    // ── export let / export var ──
    if (ts.isVariableStatement(node)) {
      const hasExport = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      if (hasExport) {
        const flags = node.declarationList.flags
        if (!(flags & ts.NodeFlags.Const)) {
          const p = pos(node)
          violations.push({ ruleId: "no-mutable-export", filePath, ...p, message: "`export let/var` — use `export const`" })
        }
      }
    }

    // ── : any in annotations ──
    if (ts.isTypeReferenceNode(node) || node.kind === ts.SyntaxKind.AnyKeyword) {
      if (node.kind === ts.SyntaxKind.AnyKeyword && !lineHasOptOut(node)) {
        const parent = node.parent
        // Skip `as any` — already caught by no-any-assertion
        if (parent && ts.isAsExpression(parent)) {
          // already handled
        } else if (parent && (
          ts.isParameter(parent) ||
          ts.isVariableDeclaration(parent) ||
          ts.isPropertyDeclaration(parent) ||
          ts.isPropertySignature(parent)
        )) {
          const p = pos(node)
          violations.push({ ruleId: "no-any-annotation", filePath, ...p, message: "`: any` annotation — use `unknown` and narrow" })
        } else if (parent && (
          ts.isFunctionDeclaration(parent) ||
          ts.isMethodDeclaration(parent) ||
          ts.isArrowFunction(parent) ||
          ts.isFunctionExpression(parent)
        )) {
          const p = pos(node)
          violations.push({ ruleId: "no-explicit-any-return", filePath, ...p, message: "`(): any` return — use a specific type" })
        }
      }
    }

    // ── prose assertions in test files ──
    if (isTestFile(filePath) && ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const matcher = node.expression.name.text
      const argument = node.arguments[0]
      const isOptedOut = PROSE_ASSERTION_OK_RE.test(getLineText(sourceFile, sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line))
      const stringArgument = argument !== undefined && ts.isStringLiteral(argument) ? argument : null
      const isProseArgument = stringArgument !== null && isNaturalLanguageProse(stringArgument.text)
      const shouldFlag = matcher === "toMatchSnapshot"
        || (PROSE_STRING_ASSERTION_MATCHERS.has(matcher) && isProseArgument && (
          matcher === "toContain"
          || matcher === "toMatch"
          || (matcher === "toBe" && stringArgument !== null && stringArgument.text.length >= 24)
        ))

      if (shouldFlag && !isOptedOut) {
        const p = pos(node)
        violations.push({
          ruleId: "no-prose-assertion",
          filePath,
          ...p,
          message: `\`${matcher}\` prose assertion — assert parsed behavior, structure, or rule data instead`,
        })
      }
    }

    // ── empty catch / catch without narrowing ──
    if (ts.isCatchClause(node)) {
      const catchLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line
      const catchLineText = getLineText(sourceFile, catchLine)
      if (!CATCH_OK_RE.test(catchLineText)) {
        const body = node.block
        const stmts = body.statements

        if (stmts.length === 0) {
          // Empty catch — swallows everything silently
          const p = pos(node)
          violations.push({ ruleId: "empty-catch", filePath, ...p, message: "empty `catch` block — handle, re-throw, or remove the try/catch" })
        } else if (node.variableDeclaration) {
          // Has a bound variable — check if it's narrowed with instanceof
          const varName = node.variableDeclaration.name.getText(sourceFile)
          const blockText = body.getText(sourceFile)
          const hasInstanceof = blockText.includes(`instanceof`)
          const hasRethrow = blockText.includes(`throw ${varName}`) || blockText.includes(`throw new`)
          if (!hasInstanceof && !hasRethrow) {
            const p = pos(node)
            violations.push({ ruleId: "catch-without-narrowing", filePath, ...p, message: "`catch` without `instanceof` narrowing or re-throw — narrow the error type or re-throw" })
          }
        }
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  // ── @ts-ignore / @ts-expect-error in comments ──
  const commentRanges = [
    ...(ts.getLeadingCommentRanges(source, 0) ?? []),
  ]
  // Scan all comments via regex for reliability
  const commentRegex = /\/\/\s*@ts-(ignore|expect-error)/g
  let match: RegExpExecArray | null
  while ((match = commentRegex.exec(source)) !== null) {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(match.index)
    const kind = match[1]
    violations.push({
      ruleId: kind === "ignore" ? "no-ts-ignore" : "no-ts-expect-error",
      filePath,
      line: line + 1,
      column: character + 1,
      message: `\`@ts-${kind}\` — fix the underlying type`,
    })
  }

  return violations
}

function formatViolation(v: Violation): string {
  return `${v.filePath}:${v.line}:${v.column}: [${v.ruleId}] ${v.message}`
}

function main(): void {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    console.error("usage: check-no-excuse-rules.ts <file-or-dir>...")
    process.exit(2)
  }

  const files = discoverFiles(args)
  if (files.length === 0) {
    console.error("No TypeScript files found.")
    process.exit(2)
  }

  const violations = files.flatMap((f) => analyzeFile(f))

  if (violations.length === 0) {
    console.log(`No violations in ${files.length} file(s).`)
    return
  }

  for (const v of violations) {
    console.error(formatViolation(v))
  }
  console.error(`\n${violations.length} violation(s) in ${files.length} file(s).`)
  process.exit(1)
}

main()
