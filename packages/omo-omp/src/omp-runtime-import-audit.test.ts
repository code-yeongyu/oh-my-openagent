import { expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { relative, resolve } from "node:path"

const srcDir = resolve(import.meta.dir)

function typescriptFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name)
    if (entry.isDirectory()) return typescriptFiles(path)
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : []
  })
}

test("#given omo-omp source #when imports are audited #then the OMP harness entry is type-only or absent", () => {
  const violations = typescriptFiles(srcDir).flatMap((path) => {
    return readFileSync(path, "utf8")
      .split("\n")
      .map((line, index) => ({ line, lineNumber: index + 1 }))
      .filter(({ line }) => /^\s*import\s+(?!type\b).+\s+from\s+["']@oh-my-pi\/[^"']+["']/.test(line))
      .map(({ line, lineNumber }) => `${relative(srcDir, path)}:${lineNumber}:${line.trim()}`)
  })

  expect(violations).toEqual([])
})
