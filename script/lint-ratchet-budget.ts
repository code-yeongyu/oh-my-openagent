// Resolve numeric budgets through lexical bindings without running the test or its imports.
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import ts from "@typescript/typescript6"

type Unit = { readonly file: ts.SourceFile; readonly checker: ts.TypeChecker }
const imported = new Map<string, Unit>()

function unit(path: string, source: string): Unit {
  const full = resolve(path)
  const options: ts.CompilerOptions = { noLib: true, noResolve: true, allowJs: true, types: [] }
  const file = ts.createSourceFile(full, source, ts.ScriptTarget.Latest, true)
  const host = ts.createCompilerHost(options)
  host.getSourceFile = (name) => (name === full ? file : undefined)
  const program = ts.createProgram([full], options, host)
  return { file, checker: program.getTypeChecker() }
}

function fromImport(path: string, specifier: string): Unit | undefined {
  if (!specifier.startsWith(".")) return undefined
  try {
    const target = Bun.resolveSync(specifier, dirname(path))
    if (!/\.[cm]?[jt]sx?$/.test(target)) return undefined
    const cached = imported.get(target)
    if (cached !== undefined) return cached
    const parsed = unit(target, readFileSync(target, "utf8"))
    imported.set(target, parsed)
    return parsed
  } catch {
    return undefined
  }
}

function initializer(here: Unit, symbol: ts.Symbol | undefined): { here: Unit; expr: ts.Expression } | undefined {
  const decl = symbol?.declarations?.[0]
  if (decl === undefined) return undefined
  if (ts.isImportSpecifier(decl)) {
    const declaration = decl.parent.parent.parent
    if (!ts.isImportDeclaration(declaration) || !ts.isStringLiteral(declaration.moduleSpecifier)) return undefined
    const other = fromImport(here.file.fileName, declaration.moduleSpecifier.text)
    if (other === undefined) return undefined
    const module = other.checker.getSymbolAtLocation(other.file)
    if (module === undefined) return undefined
    const name = (decl.propertyName ?? decl.name).text
    const target = other.checker.getExportsOfModule(module).find((entry) => entry.name === name)
    return initializer(other, target)
  }
  if (
    ts.isVariableDeclaration(decl) &&
    ts.isVariableDeclarationList(decl.parent) &&
    (decl.parent.flags & ts.NodeFlags.Const) !== 0 &&
    decl.initializer !== undefined
  ) {
    return { here, expr: decl.initializer }
  }
  return undefined
}

function expressionAt(file: ts.SourceFile, start: number, end: number): ts.Expression | undefined {
  function find(node: ts.Node): ts.Expression | undefined {
    if (node.end < end || node.getStart(file) > start) return undefined
    if (node.end === end && node.getStart(file) === start && ts.isExpression(node)) return node
    return ts.forEachChild(node, find)
  }
  return find(file)
}

function evaluate(here: Unit, expr: ts.Expression, windows: boolean, seen: Set<ts.Node>): number | null {
  if (seen.has(expr)) return null
  const active = new Set(seen).add(expr)
  const value = (node: ts.Expression) => evaluate(here, node, windows, active)
  if (ts.isNumericLiteral(expr)) return Number(expr.text)
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr))
    return value(expr.expression)
  if (ts.isIdentifier(expr)) {
    const target = initializer(here, here.checker.getSymbolAtLocation(expr))
    return target === undefined ? null : evaluate(target.here, target.expr, windows, active)
  }
  if (ts.isBinaryExpression(expr)) {
    const left = value(expr.left),
      right = value(expr.right)
    if (left === null || right === null) return null
    if (expr.operatorToken.kind === ts.SyntaxKind.PlusToken) return left + right
    if (expr.operatorToken.kind === ts.SyntaxKind.AsteriskToken) return left * right
  }
  if (ts.isConditionalExpression(expr) && ts.isBinaryExpression(expr.condition)) {
    const { left, right, operatorToken } = expr.condition
    if (
      left.getText() === "process.platform" &&
      ts.isStringLiteral(right) &&
      right.text === "win32" &&
      operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
    )
      return value(windows ? expr.whenTrue : expr.whenFalse)
  }
  // Two real budgets sum their declared phase caps and a numeric initial allowance.
  if (
    ts.isCallExpression(expr) &&
    ts.isPropertyAccessExpression(expr.expression) &&
    expr.expression.name.text === "reduce"
  ) {
    const values = expr.expression.expression
    const [combine, initial] = expr.arguments
    if (
      !ts.isCallExpression(values) ||
      values.expression.getText() !== "Object.values" ||
      combine === undefined ||
      initial === undefined ||
      !ts.isArrowFunction(combine) ||
      !ts.isBinaryExpression(combine.body) ||
      combine.body.operatorToken.kind !== ts.SyntaxKind.PlusToken ||
      combine.body.left.getText() !== combine.parameters[0]?.name.getText() ||
      combine.body.right.getText() !== combine.parameters[1]?.name.getText()
    )
      return null
    const argument = values.arguments[0]
    if (argument === undefined || !ts.isIdentifier(argument)) return null
    const binding = initializer(here, here.checker.getSymbolAtLocation(argument))
    if (binding === undefined) return null
    const object = ts.isAsExpression(binding.expr) ? binding.expr.expression : binding.expr
    let sum = value(initial)
    if (!ts.isObjectLiteralExpression(object) || sum === null) return null
    for (const property of object.properties) {
      if (!ts.isPropertyAssignment(property)) return null
      const term = evaluate(binding.here, property.initializer, windows, active)
      if (term === null) return null
      sum += term
    }
    return sum
  }
  return null
}

export function sourceBudgets(path: string, source: string) {
  let here: Unit | undefined
  return (
    start: number,
    end: number,
    callStart?: number,
    callEnd?: number,
  ): { value: number | null; windows?: number } | undefined => {
    here ??= unit(path, source)
    // The lint count also includes lookalikes such as a local function named describe and
    // methods on a local object named test. They have no test budget to compare.
    if (callStart !== undefined && callEnd !== undefined) {
      const call = expressionAt(here.file, callStart, callEnd)
      if (call !== undefined && ts.isCallExpression(call)) {
        let root = call.expression
        while (ts.isPropertyAccessExpression(root) || ts.isCallExpression(root)) root = root.expression
        const declaration = here.checker.getSymbolAtLocation(root)?.valueDeclaration
        if (
          declaration !== undefined &&
          ts.isFunctionDeclaration(declaration) &&
          declaration.parameters[1]?.type !== undefined
        ) {
          const parameter = here.checker.getTypeAtLocation(declaration.parameters[1])
          if (
            (parameter.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) === 0 &&
            parameter.getCallSignatures().length === 0
          )
            return undefined
        }
        if (declaration !== undefined && ts.isVariableDeclaration(declaration)) {
          const type = here.checker.getTypeAtLocation(root)
          if ((type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) === 0 && type.getCallSignatures().length === 0)
            return undefined
        }
      }
    }
    const expression = expressionAt(here.file, start, end)
    if (expression === undefined) return { value: null }
    const value = evaluate(here, expression, false, new Set())
    const windows = evaluate(here, expression, true, new Set())
    if (value === null || windows === null || !Number.isFinite(value) || !Number.isFinite(windows))
      return { value: null }
    return value === windows ? { value } : { value, windows }
  }
}
