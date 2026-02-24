import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { randomUUID } from "node:crypto"
import { writeFile, unlink, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { log } from "../../shared/logger"
import { COUNCIL_MEMBER_PROMPT, COUNCIL_DELEGATION_ADDENDUM } from "../../agents/athena"

const CLEANUP_DELAY_MS = 30 * 60 * 1000
const COUNCIL_TMP_DIR = ".sisyphus/tmp"

export function createPrepareCouncilPromptTool(directory: string): ToolDefinition {
  const description = `Save a council analysis prompt to a temp file so council members can read it.

Athena-only tool. Saves the prompt once, then each council member task() call uses a short
"Read <path>" instruction instead of repeating the full question. This keeps task() calls
fast and small.

The "mode" parameter controls whether council members can delegate exploration to subagents:
- "solo" (default): Members do all exploration themselves. More thorough but uses more tokens.
- "delegation": Members can delegate to explore/librarian agents. Faster, lighter context.

Returns the file path to reference in subsequent task() calls.`

  return tool({
    description,
    args: {
      prompt: tool.schema.string().describe("The full analysis prompt/question for council members"),
      mode: tool.schema.string().optional().describe('Analysis mode: "solo" (default) or "delegation"'),
    },
    async execute(args: { prompt: string; mode?: string }) {
      if (!args.prompt?.trim()) {
        return "Prompt cannot be empty."
      }

      const mode = args.mode === "delegation" ? "delegation" : "solo"
      const tmpDir = join(directory, COUNCIL_TMP_DIR)
      await mkdir(tmpDir, { recursive: true })

      const filename = `athena-council-${randomUUID().slice(0, 8)}.md`
      const filePath = join(tmpDir, filename)

      const delegationSection = mode === "delegation" ? `\n${COUNCIL_DELEGATION_ADDENDUM}` : ""
      const content = `${COUNCIL_MEMBER_PROMPT}${delegationSection}

## Analysis Question

${args.prompt}`

      await writeFile(filePath, content, "utf-8")

      setTimeout(() => {
        unlink(filePath).catch((err) => {
          log("[prepare-council-prompt] Failed to clean up temp file", { filePath, error: String(err) })
        })
      }, CLEANUP_DELAY_MS)

      log("[prepare-council-prompt] Saved prompt", { filePath, length: args.prompt.length, mode })

      return `Council prompt saved to: ${filePath} (mode: ${mode})

Use this path in each council member's task() call:
- prompt: "Read ${filePath} for your instructions."

The file auto-deletes after 30 minutes.`
    },
  })
}
