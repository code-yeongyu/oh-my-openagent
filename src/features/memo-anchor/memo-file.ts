import fs from "node:fs"
import path from "node:path"

export function getMemoFileAbsolutePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".sisyphus", "memo.md")
}

export function ensureMemoFileExists(workspaceRoot: string): {
  created: boolean
  absolutePath: string
  relativePath: string
} {
  const absolutePath = getMemoFileAbsolutePath(workspaceRoot)
  const relativePath = ".sisyphus/memo.md"

  if (fs.existsSync(absolutePath)) {
    return { created: false, absolutePath, relativePath }
  }

  fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
  fs.writeFileSync(
    absolutePath,
    [
      "# .sisyphus/memo.md",
      "",
      "> Created automatically by Oh My OpenCode (OmO) because `mono` was enabled.",
      "> Use this file as durable external memory for this project.",
      "",
    ].join("\n"),
    "utf8",
  )

  return { created: true, absolutePath, relativePath }
}

