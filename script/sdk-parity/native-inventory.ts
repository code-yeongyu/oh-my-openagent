import { readFileSync } from "node:fs"
import { join } from "node:path"
import ts from "@typescript/typescript6"

import { reachableModules } from "./reachable"

// Inventory (1) of design section 7.1 for the native edition: every comparison of an argv element against a string
// literal in a module reachable from the binary's two entry points. Its findings are compared with the registry's native
// CLI entries both ways: a literal no row names fails, and a row token the code never compares fails.
//
// What counts as a comparison (the scan's whole contract, so a reviewer can see what it does not see):
// - a flag-shaped literal (`-x`, `--x`, `--x=`) anywhere in `===`/`!==`/`==`/`!=`, a `case` label, an `.includes()`,
//   `.indexOf()`, `.has()`, `.startsWith()` argument, an element of an array or Set literal, or a key of an object
//   literal used as an option table (`parseArgs` options, Commander `.option()` text);
// - a word literal compared with an argv element: `args[0] === "x"`, `process.argv[2] === "x"`, `args.at(1) === "x"`,
//   a `switch` on one, `[...].includes(args[0])`, or a word in a module-level verb table (`VERBS`, `SUBCOMMANDS`,
//   `ENGINE_COMMANDS`, ...); Commander `.command("x")` and `.alias("x")` text;
// - a flag-shaped literal passed beside an argv value to any call (`readValue(argv, "--x")`, `hasFlag(args, "--x")`),
//   a `"--a --b".split(" ")` table, or a constant whose value is one (`const FLAG = "--x"`).
// A decision computed from plain code that compares no literal (a regex, a computed name) is outside it (7.5).

export { GENERATED_SOURCES } from "./reachable"

export const NATIVE_ENTRY_POINTS = ["packages/omo-native/bin/omo.js", "packages/omo-native/compile-entry.ts"] as const

// Where a flag literal sits: the word keys on its object-table path (`COMMANDS.send.values` gives send and values), the
// verbs an enclosing `if`/`case` compares an argv element with, and whether it is in a table every verb shares.
export type ArgvScope = { readonly words: readonly string[]; readonly shared: boolean }

export type ArgvFinding = {
  readonly token: string
  readonly file: string
  readonly line: number
  readonly scope?: ArgvScope
}

const FLAG = /^--?[A-Za-z][A-Za-z0-9-]*=?$/
const WORD = /^[a-z_][a-z0-9_-]*$/
const VERB_TABLE = /(VERB|COMMAND|SUBCOMMAND|TARGET|ROUTE|VALUE)S?$/i
const SHARED_TABLE = /^(COMMON|SHARED|GLOBAL)/i
const ARGV_NAME = /^(?:args?|argv|rest|tail|params|flags)$/i

function splitTable(node: ts.Node): string[] | undefined {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return undefined
  if (node.expression.name.text !== "split") return undefined
  const text = literalOf(node.expression.expression)
  return text === undefined ? undefined : text.split(/\s+/).filter((part) => part !== "")
}

const literalOf = (node: ts.Node): string | undefined =>
  ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : undefined

/** `args[1]`, `process.argv[2]`, `args.at(0)`, or a name bound to one (`const verb = args[0]`, `const [verb] = args`). */
function isArgvElement(node: ts.Node, bound: ReadonlySet<string>): boolean {
  if (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node)) return isArgvElement(node.expression, bound)
  if (ts.isIdentifier(node)) return bound.has(node.text)
  if (ts.isElementAccessExpression(node))
    return ts.isNumericLiteral(node.argumentExpression) && isArgvRoot(node.expression)
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression))
    return node.expression.name.text === "at" && isArgvRoot(node.expression.expression)
  return false
}

function isArgvRoot(node: ts.Node): boolean {
  if (ts.isIdentifier(node)) return ARGV_NAME.test(node.text)
  if (ts.isPropertyAccessExpression(node)) return node.name.text === "argv" || ARGV_NAME.test(node.name.text)
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression))
    return node.expression.name.text === "slice" && isArgvRoot(node.expression.expression)
  return false
}

function argvBindings(source: ts.SourceFile): Set<string> {
  const bound = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
      if (ts.isIdentifier(node.name) && isArgvElement(node.initializer, bound)) bound.add(node.name.text)
      if (ts.isArrayBindingPattern(node.name) && isArgvRoot(node.initializer))
        for (const element of node.name.elements)
          if (ts.isBindingElement(element) && ts.isIdentifier(element.name) && element.dotDotDotToken === undefined)
            bound.add(element.name.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return bound
}

const COMPARE = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
])
const MEMBER_TESTS = new Set(["includes", "indexOf", "has", "startsWith", "find", "findIndex", "some"])
const COMMANDER_TEXT = new Set(["command", "alias", "option", "requiredOption", "addOption"])

/** Flag and word tokens a Commander `.command("x [y]")` or `.option("-a, --all <v>")` text declares. */
function commanderTokens(text: string): string[] {
  return text
    .split(/[\s,|]+/)
    .filter((part) => part !== "" && !part.startsWith("<") && !part.startsWith("["))
    .map((part) => part.replace(/[.]{3}$/, ""))
    .filter((part) => FLAG.test(part) || WORD.test(part))
}

export function scanArgvComparisons(file: string, text: string): ArgvFinding[] {
  const kind = /\.[cm]?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
  const bound = argvBindings(source)
  const found: ArgvFinding[] = []
  const lineOf = (node: ts.Node): number => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
  const comparedWords = (condition: ts.Node): string[] => {
    const words: string[] = []
    const walk = (node: ts.Node): void => {
      if (ts.isBinaryExpression(node) && COMPARE.has(node.operatorToken.kind))
        for (const [literal, other] of [
          [node.right, node.left],
          [node.left, node.right],
        ] as const) {
          const value = literalOf(literal)
          if (value !== undefined && WORD.test(value) && isArgvElement(other, bound)) words.push(value)
        }
      ts.forEachChild(node, walk)
    }
    walk(condition)
    return words
  }
  const scopeOf = (node: ts.Node): ArgvScope => {
    const words: string[] = []
    let shared = false
    for (let at: ts.Node | undefined = node; at !== undefined; at = at.parent) {
      const parent: ts.Node | undefined = at.parent
      if (ts.isPropertyAssignment(at) && ts.isIdentifier(at.name) && WORD.test(at.name.text)) words.push(at.name.text)
      if (ts.isPropertyAssignment(at) && ts.isStringLiteral(at.name) && WORD.test(at.name.text))
        words.push(at.name.text)
      if (ts.isVariableDeclaration(at) && ts.isIdentifier(at.name) && SHARED_TABLE.test(at.name.text)) shared = true
      if (parent !== undefined && ts.isIfStatement(parent) && parent.thenStatement === at)
        words.push(...comparedWords(parent.expression))
      if (
        ts.isCaseClause(at) &&
        ts.isSwitchStatement(at.parent.parent) &&
        isArgvElement(at.parent.parent.expression, bound)
      ) {
        const value = literalOf(at.expression)
        if (value !== undefined && WORD.test(value)) words.push(value)
      }
    }
    return { words, shared }
  }
  const add = (token: string, node: ts.Node): void => {
    const clean = token.endsWith("=") ? token.slice(0, -1) : token
    found.push({ token: clean, file, line: lineOf(node), ...(FLAG.test(clean) ? { scope: scopeOf(node) } : {}) })
  }
  const flagOrArgvWord = (literal: ts.Node, other: ts.Node | undefined): void => {
    const value = literalOf(literal)
    if (value === undefined) return
    if (FLAG.test(value)) add(value, literal)
    else if (WORD.test(value) && other !== undefined && isArgvElement(other, bound)) add(value, literal)
  }
  const tableElements = (node: ts.Node, argvTable: boolean): void => {
    const split = splitTable(node)
    if (split !== undefined) {
      for (const value of split) if (FLAG.test(value) || (argvTable && WORD.test(value))) add(value, node)
      return
    }
    if (ts.isNewExpression(node) && node.arguments?.[0] !== undefined && splitTable(node.arguments[0]) !== undefined) {
      tableElements(node.arguments[0], argvTable)
      return
    }
    const elements = ts.isArrayLiteralExpression(node)
      ? node.elements
      : ts.isNewExpression(node) && node.arguments?.[0] !== undefined && ts.isArrayLiteralExpression(node.arguments[0])
        ? node.arguments[0].elements
        : undefined
    if (elements !== undefined) {
      for (const element of elements) {
        const value = literalOf(element)
        if (value === undefined) {
          if (ts.isArrayLiteralExpression(element)) tableElements(element, argvTable)
          continue
        }
        if (FLAG.test(value) || (argvTable && WORD.test(value))) add(value, element)
      }
    }
    if (ts.isObjectLiteralExpression(node))
      for (const property of node.properties) {
        const key =
          property.name === undefined
            ? undefined
            : ts.isIdentifier(property.name)
              ? property.name.text
              : literalOf(property.name)
        if (argvTable && key !== undefined && (FLAG.test(key) || WORD.test(key))) add(key, property)
        // A per-verb spec nests its flag lists: `{ send: { values: ["--mode"], booleans: [] } }`.
        if (ts.isPropertyAssignment(property)) {
          const value = property.initializer
          if (ts.isArrayLiteralExpression(value)) tableElements(value, false)
          if (ts.isObjectLiteralExpression(value)) tableElements(value, false)
        }
      }
  }
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && COMPARE.has(node.operatorToken.kind)) {
      flagOrArgvWord(node.right, node.left)
      flagOrArgvWord(node.left, node.right)
    }
    if (ts.isSwitchStatement(node)) {
      const onArgv = isArgvElement(node.expression, bound)
      for (const clause of node.caseBlock.clauses) {
        if (!ts.isCaseClause(clause)) continue
        const value = literalOf(clause.expression)
        if (value !== undefined && (FLAG.test(value) || (onArgv && WORD.test(value)))) add(value, clause.expression)
      }
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text
      const first = node.arguments[0]
      if (MEMBER_TESTS.has(method) && first !== undefined) {
        flagOrArgvWord(first, undefined)
        // `["a", "b"].includes(args[0])`: the receiver is a verb table for an argv element.
        if (isArgvElement(first, bound)) tableElements(node.expression.expression, true)
      }
      if (COMMANDER_TEXT.has(method) && first !== undefined) {
        const value = literalOf(first)
        if (value !== undefined) for (const token of commanderTokens(value)) add(token, first)
      }
    }
    if (ts.isCallExpression(node) && node.arguments.some((argument) => isArgvRoot(argument)))
      for (const argument of node.arguments) flagOrArgvWord(argument, undefined)
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined && ts.isIdentifier(node.name)) {
      const init = ts.isAsExpression(node.initializer) ? node.initializer.expression : node.initializer
      const argvTable = VERB_TABLE.test(node.name.text)
      flagOrArgvWord(init, undefined)
      if (
        argvTable ||
        ts.isArrayLiteralExpression(init) ||
        ts.isNewExpression(init) ||
        ts.isObjectLiteralExpression(init)
      )
        tableElements(init, argvTable)
    }
    // `parseArgs({ options: { json: { type: "boolean" } } })`: each key is a `--key` flag.
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === "options") {
      const isParseArgs = ts.isObjectLiteralExpression(node.parent) && ts.isCallExpression(node.parent.parent)
      if (isParseArgs && ts.isObjectLiteralExpression(node.initializer))
        for (const property of node.initializer.properties) {
          const key =
            property.name === undefined
              ? undefined
              : ts.isIdentifier(property.name)
                ? property.name.text
                : literalOf(property.name)
          if (key !== undefined) add(`--${key}`, property)
        }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

export function nativeArgvInventory(repoRoot: string, entries: readonly string[] = NATIVE_ENTRY_POINTS): ArgvFinding[] {
  return reachableModules(repoRoot, entries)
    .filter((file) => !/\.test\.[cm]?[jt]s$/.test(file))
    .flatMap((file) => scanArgvComparisons(file, readFileSync(join(repoRoot, file), "utf8")))
    .toSorted((a, b) => a.token.localeCompare(b.token) || a.file.localeCompare(b.file) || a.line - b.line)
}
