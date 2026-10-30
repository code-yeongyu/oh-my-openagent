import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join } from "node:path"

import { run } from "./git-helpers"

function resolveExcludePath(root: string): string | null {
  try {
    const relative = run(root, ["rev-parse", "--git-path", "info/exclude"]).trim()
    return isAbsolute(relative) ? relative : join(root, relative)
  } catch {
    return null
  }
}

function readExcludeContent(excludePath: string): string {
  try {
    return readFileSync(excludePath, "utf8")
  } catch {
    return ""
  }
}

export function addLocalExcludePaths(root: string, paths: readonly string[]): void {
  const excludePath = resolveExcludePath(root)
  if (excludePath === null) return

  const content = readExcludeContent(excludePath)
  const lines = content.split("\n")

  const newLines = [...lines]
  for (const path of paths) {
    if (!newLines.includes(path)) {
      if (newLines.length > 0 && newLines[newLines.length - 1] !== "") {
        newLines.push("")
      }
      newLines.push(path)
    }
  }

  if (newLines.join("\n") === content) return

  mkdirSync(dirname(excludePath), { recursive: true })
  writeFileSync(excludePath, newLines.join("\n"))
}

export function removeLocalExcludePaths(root: string, paths: readonly string[]): void {
  const excludePath = resolveExcludePath(root)
  if (excludePath === null) return

  const content = readExcludeContent(excludePath)
  if (content === "") return

  const pathSet = new Set(paths)
  const filtered = content
    .split("\n")
    .filter((line) => !pathSet.has(line))
    .join("\n")

  if (filtered === content) return

  mkdirSync(dirname(excludePath), { recursive: true })
  writeFileSync(excludePath, filtered)
}

export function isExcluded(root: string, path: string): boolean {
  const excludePath = resolveExcludePath(root)
  if (excludePath === null) return false

  const content = readExcludeContent(excludePath)
  if (content === "") return false

  return content
    .split("\n")
    .some((line) => line.trim() === path)
}
