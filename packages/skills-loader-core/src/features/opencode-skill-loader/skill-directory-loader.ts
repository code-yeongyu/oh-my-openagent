import type { Dirent } from "node:fs"
import * as fs from "node:fs/promises"
import { join } from "path"
import { resolveSymlinkAsync, isMarkdownFile } from "@oh-my-opencode/utils"
import type { LoadedSkill, SkillScope } from "./types"
import { inferSkillNameFromFileName, loadSkillFromPath } from "./loaded-skill-from-path"

async function readDirectoryEntries(skillsDir: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(skillsDir, { withFileTypes: true })
  } catch (error) {
    if (error instanceof Error) {
      return []
    }
    return []
  }
}

async function canAccessFile(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch (error) {
    if (error instanceof Error) {
      return false
    }
    return false
  }
}

export async function loadSkillsFromDir(options: {
  skillsDir: string
  scope: SkillScope
  namePrefix?: string
  depth?: number
  maxDepth?: number
}): Promise<LoadedSkill[]> {
  const namePrefix = options.namePrefix ?? ""
  const depth = options.depth ?? 0
  const maxDepth = options.maxDepth ?? 2

  console.error(`[loadSkillsFromDir] Scanning: ${options.skillsDir} (depth=${depth}, scope=${options.scope})`)

  const entries = await readDirectoryEntries(options.skillsDir)
  console.error(`[loadSkillsFromDir] Found ${entries.length} entries in ${options.skillsDir}`)

  const skillMap = new Map<string, LoadedSkill>()

  const directories = entries.filter(
    (entry) => !entry.name.startsWith(".") && (entry.isDirectory() || entry.isSymbolicLink())
  )
  const files = entries.filter(
    (entry) =>
      !entry.name.startsWith(".") &&
      !entry.isDirectory() &&
      !entry.isSymbolicLink() &&
      isMarkdownFile(entry)
  )

  console.error(`[loadSkillsFromDir] ${directories.length} directories, ${files.length} markdown files`)

  for (const entry of directories) {
    const entryPath = join(options.skillsDir, entry.name)
    const resolvedPath = await resolveSymlinkAsync(entryPath)
    const dirName = entry.name

    const skillMdPath = join(resolvedPath, "SKILL.md")
    const namedSkillMdPath = join(resolvedPath, `${dirName}.md`)

    console.error(`[loadSkillsFromDir] Checking directory: ${dirName}`)
    console.error(`[loadSkillsFromDir]   SKILL.md path: ${skillMdPath}`)
    console.error(`[loadSkillsFromDir]   ${dirName}.md path: ${namedSkillMdPath}`)

    if (await canAccessFile(skillMdPath)) {
      console.error(`[loadSkillsFromDir]   Found SKILL.md, loading...`)
      const skill = await loadSkillFromPath({
        skillPath: skillMdPath,
        resolvedPath,
        defaultName: dirName,
        scope: options.scope,
        namePrefix,
      })
      if (skill && !skillMap.has(skill.name)) {
        console.error(`[loadSkillsFromDir]   ✓ Loaded skill: ${skill.name}`)
        skillMap.set(skill.name, skill)
      } else if (!skill) {
        console.error(`[loadSkillsFromDir]   ✗ loadSkillFromPath returned null for ${dirName}`)
      } else {
        console.error(`[loadSkillsFromDir]   ⊘ Skill ${skill.name} already exists in map, skipping`)
      }
      continue
    }

    if (await canAccessFile(namedSkillMdPath)) {
      console.error(`[loadSkillsFromDir]   Found ${dirName}.md, loading...`)
      const skill = await loadSkillFromPath({
        skillPath: namedSkillMdPath,
        resolvedPath,
        defaultName: dirName,
        scope: options.scope,
        namePrefix,
      })
      if (skill && !skillMap.has(skill.name)) {
        console.error(`[loadSkillsFromDir]   ✓ Loaded skill: ${skill.name}`)
        skillMap.set(skill.name, skill)
      } else if (!skill) {
        console.error(`[loadSkillsFromDir]   ✗ loadSkillFromPath returned null for ${dirName}`)
      } else {
        console.error(`[loadSkillsFromDir]   ⊘ Skill ${skill.name} already exists in map, skipping`)
      }
      continue
    }

    console.error(`[loadSkillsFromDir]   No SKILL.md or ${dirName}.md found, checking nested...`)

    if (depth < maxDepth) {
      const newPrefix = namePrefix ? `${namePrefix}/${dirName}` : dirName
      const nestedSkills = await loadSkillsFromDir({
        skillsDir: resolvedPath,
        scope: options.scope,
        namePrefix: newPrefix,
        depth: depth + 1,
        maxDepth,
      })
      console.error(`[loadSkillsFromDir]   Found ${nestedSkills.length} nested skills`)
      for (const nestedSkill of nestedSkills) {
        if (!skillMap.has(nestedSkill.name)) {
          skillMap.set(nestedSkill.name, nestedSkill)
        }
      }
    }
  }

  for (const entry of files) {
    const entryPath = join(options.skillsDir, entry.name)
    const baseName = inferSkillNameFromFileName(entryPath)
    console.error(`[loadSkillsFromDir] Loading markdown file: ${entry.name}`)
    const skill = await loadSkillFromPath({
      skillPath: entryPath,
      resolvedPath: options.skillsDir,
      defaultName: baseName,
      scope: options.scope,
      namePrefix,
    })
    if (skill && !skillMap.has(skill.name)) {
      console.error(`[loadSkillsFromDir]   ✓ Loaded skill: ${skill.name}`)
      skillMap.set(skill.name, skill)
    } else if (!skill) {
      console.error(`[loadSkillsFromDir]   ✗ loadSkillFromPath returned null for ${entry.name}`)
    }
  }

  console.error(`[loadSkillsFromDir] Completed: ${skillMap.size} skills loaded from ${options.skillsDir}`)
  return Array.from(skillMap.values())
}
