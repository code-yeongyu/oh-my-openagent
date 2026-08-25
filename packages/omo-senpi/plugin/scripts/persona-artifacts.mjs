import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

export function runtimePersonaSources(repoRoot) {
  return [
    ["reflection-persona.md", join(repoRoot, "packages", "memory-core", "src", "reflection", "assets", "reflection-persona.md")],
    ["dream-persona.md", join(repoRoot, "packages", "memory-core", "src", "reflection", "assets", "dream-persona.md")],
    ["facts-persona.md", join(repoRoot, "packages", "memory-core", "src", "facts", "assets", "facts-persona.md")],
  ]
}

export async function stageRuntimePersonas(repoRoot, outputDir) {
  await Promise.all(runtimePersonaSources(repoRoot).map(async ([name, source]) =>
    writeFile(join(outputDir, name), await readFile(source, "utf8"))))
}

export async function findStaleRuntimePersona(expectedDir, currentDir, repoRoot) {
  for (const [name] of runtimePersonaSources(repoRoot)) {
    const expected = await readFile(join(expectedDir, name), "utf8")
    const current = await readFile(join(currentDir, name), "utf8").catch(() => undefined)
    if (current !== expected) return join(currentDir, name)
  }
  return undefined
}
