// Port of letta src/cli/helpers/skill-name-frontmatter-repair.ts: SKILL.md files
// must carry a `name:` frontmatter key; missing or empty values are repaired from
// the skill directory name. Used by `/doctor` and `/memfs repair`.

import { readdir, readFile, stat, writeFile } from "@oh-my-opencode/memory-core/fs"
import { basename, dirname, join, relative } from "node:path"

export interface SkillNameFrontmatterRepairSkippedFile {
  readonly path: string
  readonly reason: string
}

export interface SkillNameFrontmatterRepairResult {
  scanned: number
  readonly repaired: string[]
  readonly skipped: SkillNameFrontmatterRepairSkippedFile[]
}

interface SkillNameFrontmatterContentRepairResult {
  readonly content: string
  readonly changed: boolean
  readonly reason?: string
}

const FRONTMATTER_REGEX = /^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function findSkillMarkdownFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue
    const fullPath = join(root, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      files.push(...(await findSkillMarkdownFiles(fullPath)))
    } else if (entry.isFile() && entry.name === "SKILL.md") {
      files.push(fullPath)
    }
  }
  return files
}

function formatYamlScalar(value: string): string {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : JSON.stringify(value)
}

function isNonEmptyNameLine(line: string): boolean {
  const match = line.match(/^\s*name\s*:\s*(.*?)\s*$/)
  return Boolean(match?.[1]?.trim())
}

export function repairSkillNameFrontmatterContent(
  content: string,
  skillName: string,
): SkillNameFrontmatterContentRepairResult {
  if (!skillName.trim()) {
    return { content, changed: false, reason: "skill directory name is empty" }
  }

  const match = content.match(FRONTMATTER_REGEX)
  if (!match) {
    return { content, changed: false, reason: "missing YAML frontmatter" }
  }

  const opening = match[1] ?? ""
  const frontmatter = match[2] ?? ""
  const closing = match[3] ?? ""
  const newline = opening.includes("\r\n") ? "\r\n" : "\n"
  const lines = frontmatter.replace(/\r\n/g, "\n").split("\n")
  const nameLineIndex = lines.findIndex((line) => /^\s*name\s*:/.test(line))

  if (nameLineIndex >= 0 && isNonEmptyNameLine(lines[nameLineIndex] ?? "")) {
    return { content, changed: false }
  }

  const nameLine = `name: ${formatYamlScalar(skillName.trim())}`
  if (nameLineIndex >= 0) {
    lines[nameLineIndex] = nameLine
  } else {
    lines.unshift(nameLine)
  }

  const nextContent = `${opening}${lines.join(newline)}${closing}${content.slice(match[0].length)}`
  return { content: nextContent, changed: true }
}

export async function repairMissingSkillNameFrontmatter(
  memoryDir: string | undefined,
): Promise<SkillNameFrontmatterRepairResult> {
  const result: SkillNameFrontmatterRepairResult = { scanned: 0, repaired: [], skipped: [] }
  if (!memoryDir) return result

  const skillsDir = join(memoryDir, "skills")
  if (!(await pathExists(skillsDir))) return result

  let skillFiles: string[]
  try {
    skillFiles = await findSkillMarkdownFiles(skillsDir)
  } catch (error) {
    result.skipped.push({
      path: "skills/",
      reason: `failed to scan skills directory: ${error instanceof Error ? error.message : String(error)}`,
    })
    return result
  }

  for (const skillFile of skillFiles.sort()) {
    const displayPath = relative(memoryDir, skillFile).replace(/\\/g, "/")
    result.scanned += 1
    try {
      const content = await readFile(skillFile, "utf8")
      const repair = repairSkillNameFrontmatterContent(content, basename(dirname(skillFile)))
      if (repair.reason !== undefined) {
        result.skipped.push({ path: displayPath, reason: repair.reason })
        continue
      }
      if (!repair.changed) continue
      await writeFile(skillFile, repair.content, "utf8")
      result.repaired.push(displayPath)
    } catch (error) {
      result.skipped.push({
        path: displayPath,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return result
}

export function formatSkillNameFrontmatterRepairReport(result: SkillNameFrontmatterRepairResult): string {
  const sections: string[] = []
  if (result.repaired.length > 0) {
    sections.push(
      `added missing \`name:\` frontmatter to ${result.repaired.length} skill${result.repaired.length === 1 ? "" : "s"}: ${result.repaired.map((path) => `\`${path}\``).join(", ")}`,
    )
  }
  if (result.skipped.length > 0) {
    sections.push(
      `could not repair ${result.skipped.length} skill${result.skipped.length === 1 ? "" : "s"}: ${result.skipped.map((item) => `\`${item.path}\` (${item.reason})`).join(", ")}`,
    )
  }
  return sections.join("\n")
}
