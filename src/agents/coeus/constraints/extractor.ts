import { readdir, readFile, stat } from "fs/promises"
import { join, relative } from "path"
import {
  formatTypes,
  formatConventions,
  formatDependencies,
  type ExtractedTypes,
  type PackageDeps,
} from "./formatter"

const ZOD_SCHEMA_PATTERN = /export\s+const\s+(\w+Schema)\s*=/g
const ZOD_INFER_PATTERN = /export\s+type\s+(\w+)\s*=\s*z\.infer</g
const INTERFACE_PATTERN = /export\s+interface\s+(\w+)/g
const TYPE_ALIAS_PATTERN = /export\s+type\s+(\w+)\s*=/g
const MAX_DEPTH = 6
const TS_EXTENSIONS = new Set([".ts", ".tsx"])
const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", ".next", "build", "__fixtures__"])

async function collectTsFiles(dir: string, depth = 0): Promise<string[]> {
  if (depth > MAX_DEPTH) return []

  let entryNames: string[]
  try {
    entryNames = await readdir(dir)
  } catch {
    return []
  }

  const files: string[] = []

  for (const name of entryNames) {
    if (name.startsWith(".")) continue

    const fullPath = join(dir, name)
    let entryStat: Awaited<ReturnType<typeof stat>>
    try {
      entryStat = await stat(fullPath)
    } catch {
      continue
    }

    if (entryStat.isDirectory()) {
      if (IGNORED_DIRS.has(name)) continue
      const nested = await collectTsFiles(fullPath, depth + 1)
      files.push(...nested)
    } else if (entryStat.isFile()) {
      const dotIdx = name.lastIndexOf(".")
      const ext = dotIdx >= 0 ? name.slice(dotIdx) : ""
      if (TS_EXTENSIONS.has(ext) && !name.endsWith(".test.ts") && !name.endsWith(".spec.ts")) {
        files.push(fullPath)
      }
    }
  }

  return files
}

function extractMatches(content: string, pattern: RegExp): string[] {
  const names: string[] = []
  let match: RegExpExecArray | null
  const regex = new RegExp(pattern.source, pattern.flags)
  while ((match = regex.exec(content)) !== null) {
    if (match[1]) names.push(match[1])
  }
  return names
}

async function extractTypes(projectDir: string): Promise<ExtractedTypes> {
  const result: ExtractedTypes = {
    zodSchemas: [],
    zodInferred: [],
    interfaces: [],
    typeAliases: [],
  }

  const srcDir = join(projectDir, "src")
  let files: string[]
  try {
    await stat(srcDir)
    files = await collectTsFiles(srcDir)
  } catch {
    files = await collectTsFiles(projectDir)
  }

  for (const file of files) {
    let content: string
    try {
      content = await readFile(file, "utf-8")
    } catch {
      continue
    }

    const relPath = relative(projectDir, file)

    const schemas = extractMatches(content, ZOD_SCHEMA_PATTERN)
    for (const name of schemas) {
      result.zodSchemas.push({ name, file: relPath })
    }

    const inferred = extractMatches(content, ZOD_INFER_PATTERN)
    for (const name of inferred) {
      result.zodInferred.push({ name, file: relPath })
    }

    const interfaces = extractMatches(content, INTERFACE_PATTERN)
    for (const name of interfaces) {
      result.interfaces.push({ name, file: relPath })
    }

    const typeAliases = extractMatches(content, TYPE_ALIAS_PATTERN)
    for (const name of typeAliases) {
      if (!inferred.includes(name)) {
        result.typeAliases.push({ name, file: relPath })
      }
    }
  }

  return result
}

async function readAgentsMd(projectDir: string): Promise<string> {
  try {
    const content = await readFile(join(projectDir, "AGENTS.md"), "utf-8")
    const conventionsMatch = content.match(/## CONVENTIONS[\s\S]*?(?=\n## |$)/)
    const antiPatternsMatch = content.match(/## ANTI-PATTERNS[\s\S]*?(?=\n## |$)/)

    const parts: string[] = []
    if (conventionsMatch) parts.push(conventionsMatch[0].trim())
    if (antiPatternsMatch) parts.push(antiPatternsMatch[0].trim())

    return parts.length > 0 ? parts.join("\n\n") : "No AGENTS.md found"
  } catch {
    return "No AGENTS.md found"
  }
}

async function readPackageJson(projectDir: string): Promise<PackageDeps> {
  try {
    const raw = await readFile(join(projectDir, "package.json"), "utf-8")
    const pkg = JSON.parse(raw)
    return {
      name: pkg.name ?? "unknown",
      dependencies: pkg.dependencies ?? {},
      devDependencies: pkg.devDependencies ?? {},
    }
  } catch {
    return { name: "unknown", dependencies: {}, devDependencies: {} }
  }
}

export async function extractGlobalConstraints(projectDir: string): Promise<string> {
  const [types, agentsContent, pkg] = await Promise.all([
    extractTypes(projectDir),
    readAgentsMd(projectDir),
    readPackageJson(projectDir),
  ])

  const sections = [
    "# Global Constraints\n",
    formatTypes(types),
    formatConventions(agentsContent),
    formatDependencies(pkg),
  ]

  return sections.join("\n")
}
