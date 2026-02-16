import { promises as fs } from "fs"
import { dirname, extname, isAbsolute, join, relative } from "path"
import picomatch from "picomatch"
import type { SkillsConfig } from "../../config/schema"
import { normalizeSkillsConfig } from "./merger/skills-config-normalizer"
import { deduplicateSkillsByName } from "./skill-deduplication"
import { loadSkillsFromDir } from "./skill-directory-loader"
import { inferSkillNameFromFileName, loadSkillFromPath } from "./loaded-skill-from-path"
import type { LoadedSkill } from "./types"

const MAX_RECURSIVE_DEPTH = 10

function isHttpUrl(path: string): boolean {
  return path.startsWith("http://") || path.startsWith("https://")
}

function toAbsolutePath(path: string, configDir: string): string {
  if (isAbsolute(path)) {
    return path
  }
  return join(configDir, path)
}

function isMarkdownPath(path: string): boolean {
  return extname(path).toLowerCase() === ".md"
}

export function normalizePathForGlob(path: string): string {
  return path.split("\\").join("/")
}

function filterByGlob(skills: LoadedSkill[], sourceBaseDir: string, globPattern?: string): LoadedSkill[] {
  if (!globPattern) return skills

  return skills.filter((skill) => {
    if (!skill.path) return false
    const rel = normalizePathForGlob(relative(sourceBaseDir, skill.path))
    return picomatch.isMatch(rel, globPattern, { dot: true, bash: true })
  })
}

async function loadSourcePath(options: {
  sourcePath: string
  recursive: boolean
  globPattern?: string
  configDir: string
}): Promise<LoadedSkill[]> {
  if (isHttpUrl(options.sourcePath)) {
    return []
  }

  const absolutePath = toAbsolutePath(options.sourcePath, options.configDir)
  const stat = await fs.stat(absolutePath).catch(() => null)
  if (!stat) return []

  if (stat.isFile()) {
    if (!isMarkdownPath(absolutePath)) return []
    const loaded = await loadSkillFromPath({
      skillPath: absolutePath,
      resolvedPath: dirname(absolutePath),
      defaultName: inferSkillNameFromFileName(absolutePath),
      scope: "config",
    })
    if (!loaded) return []
    return filterByGlob([loaded], dirname(absolutePath), options.globPattern)
  }

  if (!stat.isDirectory()) return []

  const directorySkills = await loadSkillsFromDir({
    skillsDir: absolutePath,
    scope: "config",
    maxDepth: options.recursive ? MAX_RECURSIVE_DEPTH : 0,
  })
  return filterByGlob(directorySkills, absolutePath, options.globPattern)
}

export async function discoverConfigSourceSkills(options: {
  config: SkillsConfig | undefined
  configDir: string
}): Promise<LoadedSkill[]> {
  const normalized = normalizeSkillsConfig(options.config)
  if (normalized.sources.length === 0) return []

  const loadedBySource = await Promise.all(
    normalized.sources.map((source) => {
      if (typeof source === "string") {
        return loadSourcePath({
          sourcePath: source,
          recursive: false,
          configDir: options.configDir,
        })
      }

      return loadSourcePath({
        sourcePath: source.path,
        recursive: source.recursive ?? false,
        globPattern: source.glob,
        configDir: options.configDir,
      })
    }),
  )

  return deduplicateSkillsByName(loadedBySource.flat())
}
