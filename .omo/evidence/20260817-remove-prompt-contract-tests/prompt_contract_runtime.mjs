import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const scannerRepositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")

export class ScannerArgumentError extends Error {}
export class TypeScriptCompilerError extends Error {}

export function findTypeScript(root) {
  const candidates = []
  const roots = [...new Set([root, scannerRepositoryRoot])]
  for (const candidateRoot of roots) {
    const bunModules = path.join(candidateRoot, "node_modules", ".bun")
    if (!fs.existsSync(bunModules)) continue
    for (const entry of fs.readdirSync(bunModules).sort()) {
      if (!entry.startsWith("typescript@")) continue
      const compiler = path.join(bunModules, entry, "node_modules", "typescript", "lib", "typescript.js")
      if (fs.existsSync(compiler)) candidates.push(compiler)
    }
  }
  for (const compiler of candidates.reverse()) {
    const typescript = require(compiler)
    if (typeof typescript.createSourceFile === "function") return typescript
  }
  throw new TypeScriptCompilerError(
    `installed TypeScript compiler with createSourceFile() not found under ${roots.join(", ")}`,
  )
}

export function parseArgs(argv) {
  const result = { root: process.cwd(), files: [] }
  for (let index = 2; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === "--root") {
      const value = argv[++index]
      if (value === undefined) throw new ScannerArgumentError("--root requires a path")
      result.root = path.resolve(value)
    } else if (argument === "--files-json") {
      const value = argv[++index]
      if (value === undefined) throw new ScannerArgumentError("--files-json requires a path")
      const parsed = JSON.parse(fs.readFileSync(value, "utf8"))
      if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
        throw new ScannerArgumentError("--files-json must contain an array of paths")
      }
      result.files = parsed
    } else {
      throw new ScannerArgumentError(`unknown argument: ${argument}`)
    }
  }
  return result
}
