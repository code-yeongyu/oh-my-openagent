#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(scriptDir, "..", "..")
const repoRoot = resolve(packageRoot, "..", "..")
const sourceRoot = join(packageRoot, "src", "components", "lsp", "lsp")

const toolImports = {
  diagnostics: join(sourceRoot, "tools", "diagnostics.ts"),
  references: join(sourceRoot, "tools", "find-references.ts"),
  definition: join(sourceRoot, "tools", "goto-definition.ts"),
  rename: join(sourceRoot, "tools", "rename.ts"),
  symbols: join(sourceRoot, "tools", "symbols.ts"),
}

function usage() {
  return `lsp-renderers QA

Usage:
  node packages/omo-senpi/scripts/qa/lsp-renderers.mjs
  node packages/omo-senpi/scripts/qa/lsp-renderers.mjs --self-test
`
}

function findBun() {
  const configured = process.env.BUN_BIN?.trim()
  if (configured) return configured
  return "bun"
}

function requireSources() {
  for (const [name, path] of Object.entries(toolImports)) {
    if (!existsSync(path)) throw new Error(`missing ${name} tool source: ${path}`)
  }
}

function importUrl(path) {
  return pathToFileURL(path).href
}

function runnerSource() {
  return `import { lsp_diagnostics } from ${JSON.stringify(importUrl(toolImports.diagnostics))}
import { lsp_find_references } from ${JSON.stringify(importUrl(toolImports.references))}
import { lsp_goto_definition } from ${JSON.stringify(importUrl(toolImports.definition))}
import { lsp_prepare_rename, lsp_rename } from ${JSON.stringify(importUrl(toolImports.rename))}
import { lsp_symbols } from ${JSON.stringify(importUrl(toolImports.symbols))}

const theme = { fg(_key, text) { return text }, bold(text) { return text } }
const sampleFile = "/tmp/omo-senpi-lsp/sample.ts"
const sampleUri = "file:///tmp/omo-senpi-lsp/sample.ts"
const targetUri = "file:///tmp/omo-senpi-lsp/target.ts"
const range = (line, character) => ({ start: { line, character }, end: { line, character: character + 5 } })
const location = (uri, line, character) => ({ uri, range: range(line, character) })
const diagnostic = { range: range(0, 12), severity: 1, source: "ts", code: "TS2322", message: "Type 'number' is not assignable to type 'string'." }
const scenarios = [
  { name: "lsp_diagnostics", tool: lsp_diagnostics, args: { filePath: sampleFile, severity: "error" }, callIncludes: ["lsp_diagnostics", sampleFile, "[error]"], resultIncludes: ["E:1", "1 file"], result: { content: [{ type: "text", text: "error[ts] (TS2322) at 1:12: Type mismatch" }], details: { filePath: sampleFile, severity: "error", mode: "file", diagnostics: [{ file: sampleFile, diagnostic }], totalDiagnostics: 1, truncated: false } } },
  { name: "lsp_goto_definition", tool: lsp_goto_definition, args: { filePath: sampleFile, line: 1, character: 13 }, callIncludes: ["lsp_goto_definition", sampleFile + ":1:13"], resultIncludes: ["target.ts:4:2"], result: { content: [{ type: "text", text: "/tmp/omo-senpi-lsp/target.ts:4:2" }], details: { filePath: sampleFile, line: 1, character: 13, locations: [location(targetUri, 3, 2)] } } },
  { name: "lsp_find_references", tool: lsp_find_references, args: { filePath: sampleFile, line: 1, character: 13, includeDeclaration: true }, callIncludes: ["lsp_find_references", sampleFile + ":1:13"], resultIncludes: ["2 references", "2 files"], result: { content: [{ type: "text", text: "/tmp/omo-senpi-lsp/sample.ts:1:13" }], details: { filePath: sampleFile, line: 1, character: 13, references: [location(sampleUri, 0, 13), location(targetUri, 3, 2)], totalReferences: 2, truncated: false } } },
  { name: "lsp_prepare_rename", tool: lsp_prepare_rename, args: { filePath: sampleFile, line: 1, character: 13 }, callIncludes: ["lsp_prepare_rename", sampleFile + ":1:13"], resultIncludes: ["Rename available"], result: { content: [{ type: "text", text: "Rename available: value" }], details: { filePath: sampleFile, line: 1, character: 13, result: { range: range(0, 13), placeholder: "value" } } } },
  { name: "lsp_rename", tool: lsp_rename, args: { filePath: sampleFile, line: 1, character: 13, newName: "renamedValue" }, callIncludes: ["lsp_rename", sampleFile + ":1:13", "renamedValue"], resultIncludes: ["Applied 1 edit", "1 file"], result: { content: [{ type: "text", text: "Applied 1 edit to 1 file" }], details: { filePath: sampleFile, line: 1, character: 13, newName: "renamedValue", apply: { success: true, filesModified: [sampleFile], totalEdits: 1, errors: [] }, edit: null } } },
  { name: "lsp_symbols", tool: lsp_symbols, args: { filePath: sampleFile, scope: "document" }, callIncludes: ["lsp_symbols", "[document]", sampleFile], resultIncludes: ["1 symbol", "document"], result: { content: [{ type: "text", text: "function value at 1:0" }], details: { filePath: sampleFile, scope: "document", symbols: [{ name: "value", kind: 12, range: range(0, 13), selectionRange: range(0, 13) }], totalSymbols: 1, truncated: false } } },
]

function textOf(value) {
  return String(value)
}

function renderScenario(scenario) {
  if (typeof scenario.tool.renderCall !== "function") throw new Error(scenario.name + " missing renderCall")
  if (typeof scenario.tool.renderResult !== "function") throw new Error(scenario.name + " missing renderResult")
  const call = textOf(scenario.tool.renderCall(scenario.args, theme))
  const result = textOf(scenario.tool.renderResult(scenario.result, { expanded: false }, theme))
  for (const phrase of scenario.callIncludes) {
    if (!call.includes(phrase)) throw new Error(scenario.name + " call output missing required phrase: " + phrase)
  }
  for (const phrase of scenario.resultIncludes) {
    if (!result.includes(phrase)) throw new Error(scenario.name + " result output missing required phrase: " + phrase)
  }
  return "[" + scenario.name + "]\\ncall: " + call + "\\nresult:\\n" + result
}

const output = ["custom LSP renderer transcript", ...scenarios.map(renderScenario)].join("\\n\\n")
const forbidden = ['{"filePath"', '"details":', '"diagnostics":']
for (const marker of forbidden) {
  if (output.includes(marker)) throw new Error("renderer output contains raw fallback marker: " + marker)
}
const required = [
  "lsp_diagnostics",
  "E:1",
  "1 file",
  "lsp_goto_definition",
  "target.ts:4:2",
  "lsp_find_references",
  "2 references",
  "lsp_prepare_rename",
  "Rename available",
  "lsp_rename",
  "Applied 1 edit",
  "lsp_symbols",
  "1 symbol",
]
for (const phrase of required) {
  if (!output.includes(phrase)) throw new Error("renderer output missing required phrase: " + phrase)
}
console.log(output)
`
}

function runSelfTest() {
  requireSources()
  const source = runnerSource()
  if (!source.includes("renderCall")) throw new Error("self-test expected runner to call renderCall")
  if (!source.includes("renderResult")) throw new Error("self-test expected runner to call renderResult")
  console.log("SELF-TEST OK")
}

function runQa() {
  requireSources()
  const tmp = mkdtempSync(join(tmpdir(), "omo-senpi-lsp-renderers-"))
  try {
    const runnerPath = join(tmp, "runner.ts")
    writeFileSync(runnerPath, runnerSource(), "utf8")
    const childEnv = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? tmp }
    if (process.env.BUN_INSTALL) childEnv.BUN_INSTALL = process.env.BUN_INSTALL
    const bun = spawnSync(findBun(), [runnerPath], {
      cwd: repoRoot,
      env: childEnv,
      encoding: "utf8",
      timeout: 60_000,
    })
    if (bun.status !== 0) {
      process.stderr.write(bun.stderr)
      process.stdout.write(bun.stdout)
      throw new Error(`renderer QA runner failed with status ${bun.status ?? "signal " + bun.signal}`)
    }
    process.stdout.write(bun.stdout)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write(usage())
    return
  }
  if (process.argv.includes("--self-test")) {
    runSelfTest()
    return
  }
  runQa()
}

main()
