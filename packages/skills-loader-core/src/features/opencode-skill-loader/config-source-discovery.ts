import * as fs from "node:fs/promises"
import { homedir } from "os"
import { dirname, extname, isAbsolute, join, relative } from "path"
import picomatch from "picomatch"
import type { SkillsConfig } from "../../types"
import { normalizeSkillsConfig } from "./merger/skills-config-normalizer"
import { deduplicateSkillsByName } from "./skill-deduplication"
import { loadSkillsFromDir } from "./skill-directory-loader"
import { inferSkillNameFromFileName, loadSkillFromPath } from "./loaded-skill-from-path"
import type { LoadedSkill } from "./types"
import { detectWorktreePath } from "../../shared/project-discovery-dirs"
import { skillProvenance, checkSkillPath, reportSkillLoadError, type SkillProvenance, type SkillDiagnosticSink } from "./skill-provenance"

const sourceOrigins = new WeakMap<object, SkillProvenance>()
export function setSkillSourceProvenance(config: SkillsConfig, provenance: SkillProvenance): void {
  sourceOrigins.set(config, provenance)
}
export function getSkillSourceProvenance(config: SkillsConfig | undefined): SkillProvenance | undefined {
  return config ? sourceOrigins.get(config) : undefined
}

const MAX_RECURSIVE_DEPTH = 10

function isHttpUrl(path: string): boolean {
  return path.startsWith("http://") || path.startsWith("https://")
}

function toAbsolutePath(path: string, configDir: string): string {
  if (path === "~") {
    return homedir()
  }

  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2))
  }

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
  provenance: SkillProvenance
  onDiagnostic?: SkillDiagnosticSink
}): Promise<LoadedSkill[]> {
  if (isHttpUrl(options.sourcePath)) {
    return []
  }

  const absolutePath = toAbsolutePath(options.sourcePath, options.configDir)
  const provenance = skillProvenance(absolutePath, "config", { ...options.provenance, selectedRoot: absolutePath })
  if (provenance.kind === "project-auto") {
    try { checkSkillPath(absolutePath, provenance, true) } catch (error) {
      reportSkillLoadError(error, absolutePath, options.onDiagnostic)
      return []
    }
  }
  const stat = await fs.stat(absolutePath).catch((error) => {
    reportSkillLoadError(error, absolutePath, options.onDiagnostic)
    return null
  })
  if (!stat) return []
  const realSourcePath = absolutePath

  if (stat.isFile()) {
    if (!isMarkdownPath(realSourcePath)) return []
    const loaded = await loadSkillFromPath({
      skillPath: realSourcePath,
      resolvedPath: dirname(realSourcePath),
      defaultName: inferSkillNameFromFileName(realSourcePath),
      scope: "config",
      provenance,
      onDiagnostic: options.onDiagnostic,
    })
    if (!loaded) return []
    return filterByGlob([loaded], dirname(realSourcePath), options.globPattern)
  }

  if (!stat.isDirectory()) return []

  const directorySkills = await loadSkillsFromDir({
    skillsDir: realSourcePath,
    scope: "config",
    maxDepth: options.recursive ? MAX_RECURSIVE_DEPTH : 0,
    provenance,
    onDiagnostic: options.onDiagnostic,
  })
  return filterByGlob(directorySkills, realSourcePath, options.globPattern)
}

export async function discoverConfigSourceSkills(options: {
  config: SkillsConfig | undefined
  configDir: string
  provenance?: SkillProvenance
  onDiagnostic?: SkillDiagnosticSink
  userSources?: readonly string[]
  projectSources?: readonly string[]
}): Promise<LoadedSkill[]> {
  const normalized = normalizeSkillsConfig(options.config)
  if (normalized.sources.length === 0) return []
  const provenance = options.provenance ?? (options.config && sourceOrigins.get(options.config)) ?? {
    kind: "project-auto", selectedRoot: options.configDir, projectRoot: detectWorktreePath(options.configDir) ?? options.configDir,
  }

  const loadedBySource = await Promise.all(
    normalized.sources.map((source) => {
      const sourcePath = typeof source === "string" ? source : source.path
      const userSelected = options.userSources?.some((path) =>
        toAbsolutePath(path, options.configDir) === toAbsolutePath(sourcePath, options.configDir))
      const projectSelected = options.projectSources?.some((path) =>
        toAbsolutePath(path, options.configDir) === toAbsolutePath(sourcePath, options.configDir))
      const sourceProvenance: SkillProvenance = userSelected
        ? { ...provenance, kind: "user" }
        : projectSelected ? { ...provenance, kind: "project-auto" } : provenance
      if (typeof source === "string") {
        return loadSourcePath({
          sourcePath: source,
          recursive: false,
          configDir: options.configDir,
          provenance: sourceProvenance,
          onDiagnostic: options.onDiagnostic,
        })
      }

      return loadSourcePath({
        sourcePath: source.path,
        recursive: source.recursive ?? false,
        globPattern: source.glob,
        configDir: options.configDir,
        provenance: sourceProvenance,
        onDiagnostic: options.onDiagnostic,
      })
    }),
  )

  return deduplicateSkillsByName(loadedBySource.flat())
}
