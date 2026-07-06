import { readdirSync, type Dirent } from "node:fs"
import { extname, join } from "node:path"

type ResolveAgentPathsOptions = {
  readonly homeDir: string
  readonly projectDir: string
}

const AGENT_SUBDIRECTORIES = ["agent", "agents"] as const

export function resolveAgentDefinitionLocations(options: ResolveAgentPathsOptions): readonly string[] {
  return [
    join(options.homeDir, ".pi", "agent"),
    join(options.homeDir, ".senpi", "agent"),
    join(options.homeDir, ".senpi", "agents"),
    join(options.projectDir, ".pi"),
    join(options.projectDir, ".senpi"),
    join(options.projectDir, ".senpi", "agents"),
  ]
}

export function listMarkdownAgentFiles(location: string): readonly string[] {
  return AGENT_SUBDIRECTORIES.flatMap((subdir) => listMarkdownFiles(join(location, subdir)))
}

function listMarkdownFiles(dir: string): readonly string[] {
  let entries: readonly Dirent<string>[]
  try {
    entries = readdirSync(dir, { withFileTypes: true, encoding: "utf8" })
  } catch (error) {
    if (error instanceof Error) return []
    throw error
  }

  const files: string[] = []
  for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...listMarkdownFiles(path))
    else if (entry.isFile() && extname(entry.name) === ".md") files.push(path)
  }
  return files
}
