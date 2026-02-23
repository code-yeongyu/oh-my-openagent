import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { randomUUID } from "node:crypto"
import { writeFile, unlink, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { log } from "../../shared/logger"
import { COUNCIL_MEMBER_PROMPT } from "../../agents/athena/council-member-agent"

const CLEANUP_DELAY_MS = 30 * 60 * 1000
const COUNCIL_TMP_DIR = ".sisyphus/tmp"

export function createPrepareCouncilPromptTool(directory: string): ToolDefinition {
  const description = `Save a council analysis prompt to a temp file so council members can read it.

Athena-only tool. Saves the prompt once, then each council member task() call uses a short
"Read <path>" instruction instead of repeating the full question. This keeps task() calls
fast and small.

Returns the file path to reference in subsequent task() calls.`

  return tool({
    description,
    args: {
      prompt: tool.schema.string().describe("The full analysis prompt/question for council members"),
    },
    async execute(args: { prompt: string }) {
      if (!args.prompt?.trim()) {
        return "Prompt cannot be empty."
      }

      const tmpDir = join(directory, COUNCIL_TMP_DIR)
      await mkdir(tmpDir, { recursive: true })

      const filename = `athena-council-${randomUUID().slice(0, 8)}.md`
      const filePath = join(tmpDir, filename)

      const content = `${COUNCIL_MEMBER_PROMPT}

## Analysis Question

${args.prompt}`

      await writeFile(filePath, content, "utf-8")

      setTimeout(() => {
        unlink(filePath).catch(() => {})
      }, CLEANUP_DELAY_MS)

      log("[prepare-council-prompt] Saved prompt", { filePath, length: args.prompt.length })

      return `Council prompt saved to: ${filePath}

Use this path in each council member's task() call:
- prompt: "Read ${filePath} for your instructions."

The file auto-deletes after 30 minutes.`
    },
  })
}
