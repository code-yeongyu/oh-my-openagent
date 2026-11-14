import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import ts from "@typescript/typescript6"

export type NamedImport = {
  readonly name: string
  readonly local: string
  readonly typeOnly: boolean
}

export type ImportEdge = {
  readonly kind: "import" | "export-from" | "dynamic-import" | "require"
  readonly specifier: string
  readonly typeOnly: boolean
  readonly names: readonly NamedImport[]
  readonly whole: boolean
}

export type FileFacts = {
  readonly file: string
  readonly edges: readonly ImportEdge[]
  readonly identifiers: ReadonlySet<string>
  readonly localExports: ReadonlyMap<string, string>
  readonly nonLiteralImportLines: readonly number[]
}

const SOURCE_FILE = /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/
const SKIPPED_DIRS = new Set(["node_modules", "dist", "vendor", "upstreams", "fixtures", "golden", "__snapshots__"])
// Committed build outputs (.prettierignore): bundles of the sources this guard already scans.
const SKIPPED_PATHS = [
  "packages/omo-senpi/plugin/extensions/",
  "packages/omo-senpi/plugin/runtime/",
  "packages/omo-senpi/plugin/scripts/install.mjs",
  "packages/omo-codex/scripts/install-dist/",
]

export function listSourceFiles(repoRoot: string): string[] {
  const files: string[] = []
  const walk = (relativeDir: string): void => {
    for (const entry of readdirSync(join(repoRoot, relativeDir), { withFileTypes: true })) {
      const path = `${relativeDir}/${entry.name}`
      if (SKIPPED_PATHS.some((skipped) => path.startsWith(skipped))) continue
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && !SKIPPED_DIRS.has(entry.name)) walk(path)
      } else if (entry.isFile() && SOURCE_FILE.test(entry.name) && !entry.name.includes(".generated.")) {
        files.push(path)
      }
    }
  }
  walk("packages")
  return files.toSorted()
}

const literalText = (node: ts.Node | undefined): string | undefined =>
  node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined

const moduleName = (name: ts.ModuleExportName): string => name.text

function importDeclarationEdge(node: ts.ImportDeclaration, specifier: string): ImportEdge {
  const clause = node.importClause
  const typeOnly = clause?.isTypeOnly === true
  const names: NamedImport[] = []
  let whole = false
  if (clause?.name !== undefined) names.push({ name: "default", local: clause.name.text, typeOnly })
  const bindings = clause?.namedBindings
  if (bindings !== undefined && ts.isNamespaceImport(bindings)) whole = true
  if (bindings !== undefined && ts.isNamedImports(bindings)) {
    for (const element of bindings.elements) {
      names.push({
        name: moduleName(element.propertyName ?? element.name),
        local: element.name.text,
        typeOnly: typeOnly || element.isTypeOnly,
      })
    }
  }
  return { kind: "import", specifier, typeOnly, names, whole }
}

function exportDeclarationEdge(node: ts.ExportDeclaration, specifier: string): ImportEdge {
  const clause = node.exportClause
  const names =
    clause !== undefined && ts.isNamedExports(clause)
      ? clause.elements.map((element) => ({
          name: moduleName(element.propertyName ?? element.name),
          local: moduleName(element.name),
          typeOnly: node.isTypeOnly || element.isTypeOnly,
        }))
      : []
  return { kind: "export-from", specifier, typeOnly: node.isTypeOnly, names, whole: clause === undefined }
}

export function scanSource(file: string, text: string): FileFacts {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : /\.[cm]?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, kind)
  const edges: ImportEdge[] = []
  const identifiers = new Set<string>()
  const localExports = new Map<string, string>()
  const nonLiteralImportLines: number[] = []
  const lineOf = (node: ts.Node): number => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) identifiers.add(node.text)
    const specifier =
      ts.isImportDeclaration(node) || ts.isExportDeclaration(node) ? literalText(node.moduleSpecifier) : undefined
    if (ts.isImportDeclaration(node) && specifier !== undefined) edges.push(importDeclarationEdge(node, specifier))
    if (ts.isExportDeclaration(node) && specifier !== undefined) edges.push(exportDeclarationEdge(node, specifier))
    if (ts.isExportDeclaration(node) && node.moduleSpecifier === undefined && node.exportClause !== undefined) {
      if (ts.isNamedExports(node.exportClause) && !node.isTypeOnly) {
        for (const element of node.exportClause.elements) {
          if (!element.isTypeOnly)
            localExports.set(moduleName(element.propertyName ?? element.name), moduleName(element.name))
        }
      }
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const required = literalText(node.moduleReference.expression)
      if (required !== undefined) {
        edges.push({ kind: "require", specifier: required, typeOnly: node.isTypeOnly, names: [], whole: true })
      }
    }
    if (ts.isCallExpression(node)) {
      const argument = node.arguments[0]
      const literal = literalText(argument)
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        if (literal === undefined) nonLiteralImportLines.push(lineOf(node))
        else edges.push({ kind: "dynamic-import", specifier: literal, typeOnly: false, names: [], whole: true })
      } else if (ts.isIdentifier(node.expression) && node.expression.text === "require" && literal !== undefined) {
        edges.push({ kind: "require", specifier: literal, typeOnly: false, names: [], whole: true })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return { file, edges, identifiers, localExports, nonLiteralImportLines }
}

export function scanRepository(repoRoot: string, files: readonly string[] = listSourceFiles(repoRoot)): FileFacts[] {
  return files.map((file) => scanSource(file, readFileSync(join(repoRoot, file), "utf8")))
}
