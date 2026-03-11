import { readdir, readFile } from "node:fs/promises"
import { basename, extname, join } from "node:path"
import { homedir } from "node:os"
import { parseTtsrRule } from "../../features/ttsr/rule-parser"
import type { TtsrRule } from "../../features/ttsr/types"
import { log } from "../../shared/logger"

const RULE_DIRECTORIES = [
  [".claude", "rules"],
  [".sisyphus", "rules"],
] as const

interface DirentLike {
  isFile(): boolean
  name: string
}

async function readMarkdownFiles(directoryPath: string): Promise<string[]> {
  try {
    const entries = await readdir(directoryPath, { withFileTypes: true })
    return entries
      .filter((entry: DirentLike) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry: DirentLike) => join(directoryPath, entry.name))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return []
    }
    throw error
  }
}

async function parseRuleFile(filePath: string): Promise<TtsrRule | null> {
  const content = await readFile(filePath, "utf8")
  const fileName = basename(filePath, extname(filePath))
  return parseTtsrRule(fileName, content, filePath)
}

export async function discoverTtsrRules(projectRoot: string): Promise<TtsrRule[]> {
  const directories = [
    ...RULE_DIRECTORIES.map(([parent, subdir]) => join(projectRoot, parent, subdir)),
    join(homedir(), ".claude", "rules"),
  ]

  const ruleFilePaths = (await Promise.all(directories.map((directory) => readMarkdownFiles(directory))))
    .flat()

  const parsedRules = await Promise.all(ruleFilePaths.map((filePath) => parseRuleFile(filePath)))
  const rules = parsedRules.filter((rule): rule is TtsrRule => rule !== null)

  log("[ttsr] discovered rules", {
    count: rules.length,
    paths: rules.map((rule) => rule.path).filter((path): path is string => Boolean(path)),
  })

  return rules
}
