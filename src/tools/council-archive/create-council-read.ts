import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { extractCouncilResponse } from "./council-response-extractor"

export function createCouncilRead(basePath?: string): ToolDefinition {
  return tool({
    description:
      "Read a council archive file and extract the council member response. Use this to access full results for truncated members or for follow-up/cross-check analysis.",
    args: {
      file_path: tool.schema.string().describe("Path to the archive file (must be within .sisyphus/)"),
    },
    async execute(args: { file_path: string }) {
      if (!args.file_path.startsWith(".sisyphus/")) {
        return JSON.stringify({ error: "Access denied: path must be within .sisyphus/" }, null, 2)
      }

      try {
        const base = basePath ?? process.cwd()
        const absPath = join(base, args.file_path)
        const content = await readFile(absPath, "utf-8")
        const extraction = extractCouncilResponse(content)
        return JSON.stringify(extraction, null, 2)
      } catch {
        return JSON.stringify({ has_response: false, error: `File not found: ${args.file_path}` }, null, 2)
      }
    },
  })
}
