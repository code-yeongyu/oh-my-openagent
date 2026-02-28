import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { readFile } from "node:fs/promises"
import { resolve, sep } from "node:path"

function normalizeInputPath(pathValue: string): string {
  return pathValue.replace(/\\/g, "/")
}

function isPathWithinDirectory(pathToCheck: string, directory: string): boolean {
  const normalizedDir = directory.endsWith(sep) ? directory : `${directory}${sep}`
  return pathToCheck === directory || pathToCheck.startsWith(normalizedDir)
}

export function createCouncilRead(basePath?: string): ToolDefinition {
  return tool({
    description:
      "Read a council archive file and return its raw member response content.",
    args: {
      file_path: tool.schema.string().describe("Path to the archive file (must be within .sisyphus/)"),
    },
    async execute(args: { file_path: string }) {
      const normalizedInputPath = normalizeInputPath(args.file_path)
      if (!normalizedInputPath.startsWith(".sisyphus/")) {
        return JSON.stringify({ error: "Access denied: path must be within .sisyphus/" }, null, 2)
      }

      try {
        const base = basePath ?? process.cwd()
        const absPath = resolve(base, normalizedInputPath)
        const absSisyphusRoot = resolve(base, ".sisyphus")
        if (!isPathWithinDirectory(absPath, absSisyphusRoot)) {
          return JSON.stringify({ error: "Access denied: path must be within .sisyphus/" }, null, 2)
        }

        const content = await readFile(absPath, "utf-8")
        return JSON.stringify({ has_response: true, response_complete: true, result: content }, null, 2)
      } catch {
        return JSON.stringify({ has_response: false, error: `File not found: ${normalizedInputPath}` }, null, 2)
      }
    },
  })
}
