import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { randomUUID } from "node:crypto"
import { writeFile, unlink, mkdir, readdir, stat } from "node:fs/promises"
import { join } from "node:path"
import { log } from "../../shared/logger"
import { COUNCIL_SOLO_ADDENDUM, COUNCIL_DELEGATION_ADDENDUM, COUNCIL_INTENT_ADDENDUMS, getValidCouncilIntents, resolveCouncilIntent, type CouncilIntent, COUNCIL_DEFAULTS } from "../../agents/athena"

const CLEANUP_DELAY_MS = COUNCIL_DEFAULTS.CLEANUP_DELAY_MS
const COUNCIL_TMP_DIR = ".sisyphus/tmp"

const COUNCIL_FILE_PREFIX = "athena-council-"

async function cleanupStaleTempFiles(directory: string): Promise<void> {
  const tmpDir = join(directory, COUNCIL_TMP_DIR)
  try {
    const files = await readdir(tmpDir)
    const now = Date.now()
    for (const file of files) {
      if (!file.startsWith(COUNCIL_FILE_PREFIX) || !file.endsWith(".md")) continue
      const filePath = join(tmpDir, file)
      try {
        const fileStat = await stat(filePath)
        if (now - fileStat.mtimeMs > CLEANUP_DELAY_MS) {
          await unlink(filePath)
          log("[prepare-council-prompt] Cleaned up stale temp file", { filePath })
        }
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code
        if (code !== "ENOENT") {
          log("[prepare-council-prompt] Unexpected error during temp file cleanup", { filePath, error: String(err), code })
        }
      }
    }
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== "ENOENT") {
      log("[prepare-council-prompt] Unexpected error reading temp directory", { directory: tmpDir, error: String(err), code })
    }
  }
}

export function createPrepareCouncilPromptTool(directory: string): ToolDefinition {
  const description = `Save a council analysis prompt to a temp file so council members can read it.

Athena-only tool. Saves the prompt once, then each council member task() call uses a short
"Read <path>" instruction instead of repeating the full question. This keeps task() calls
fast and small.

The "mode" parameter controls whether council members can delegate exploration to subagents:
- "solo" (default): Members do all exploration themselves. More thorough but uses more tokens.
- "delegation": Members can delegate to explore/librarian agents. Faster, lighter context.

The "intent" parameter controls the analysis framework injected into the prompt:
- "DIAGNOSE": Trace a specific problem to its root cause through systematic investigation.
- "AUDIT": Find issues, risks, violations with severity ratings (broad sweep).
- "PLAN": Define current state, target state, phased path.
- "EVALUATE": Compare options against criteria, surface tradeoffs.
- "EXPLAIN": Build understanding of mechanisms and relationships.
- "CREATE": Produce a deliverable directly (code, prose, design, spec).
- "PERSPECTIVES": Surface genuine viewpoints, argue each at its strongest, take a position.
- "FREEFORM": No analytical framework imposed — respond naturally.

If no intent is specified, no analysis framework is injected.

Returns the file path to reference in subsequent task() calls.`

  cleanupStaleTempFiles(directory).catch((err) => {
    log("[prepare-council-prompt] Startup cleanup failed", { error: String(err) })
  })

  return tool({
    description,
    args: {
      prompt: tool.schema.string().describe("The full analysis prompt/question for council members"),
      mode: tool.schema.string().optional().describe('Analysis mode: "solo" (default) or "delegation"'),
      intent: tool.schema.string().optional().describe('Question intent: "DIAGNOSE", "AUDIT", "PLAN", "EVALUATE", "EXPLAIN", "CREATE", "PERSPECTIVES", "FREEFORM"'),
    },
    async execute(args: { prompt: string; mode?: string; intent?: string }) {
      if (!args.prompt?.trim()) {
        return "Prompt cannot be empty."
      }

      if (args.mode !== undefined && args.mode !== "solo" && args.mode !== "delegation") {
        return `Invalid mode: "${args.mode}". Valid modes: "solo", "delegation".`
      }

      let resolvedIntent: CouncilIntent | undefined
      if (args.intent !== undefined) {
        const resolved = resolveCouncilIntent(args.intent)
        if (!resolved) {
          const validIntents = getValidCouncilIntents()
          return `Invalid intent: "${args.intent}". Valid intents: ${validIntents.map((i) => `"${i}"`).join(", ")}.`
        }
        resolvedIntent = resolved
      }

      const mode = args.mode === "delegation" ? "delegation" : "solo"

      try {
        const tmpDir = join(directory, COUNCIL_TMP_DIR)
        await mkdir(tmpDir, { recursive: true })

        const filename = `athena-council-${randomUUID().slice(0, 8)}.md`
        const filePath = join(tmpDir, filename)

        const modeAddendum = mode === "delegation" ? COUNCIL_DELEGATION_ADDENDUM : COUNCIL_SOLO_ADDENDUM
        const intentAddendum = resolvedIntent ? (COUNCIL_INTENT_ADDENDUMS[resolvedIntent as CouncilIntent] ?? "") : ""
        const content = intentAddendum
          ? `${modeAddendum}\n\n${intentAddendum}\n\n## Analysis Question\n\n${args.prompt}`
          : `${modeAddendum}\n\n## Analysis Question\n\n${args.prompt}`

        await writeFile(filePath, content, "utf-8")

        setTimeout(() => {
          unlink(filePath).catch((err) => {
            const code = (err as NodeJS.ErrnoException).code
            if (code !== "ENOENT") {
              log("[prepare-council-prompt] Failed to clean up temp file", { filePath, error: String(err) })
            }
          })
        }, CLEANUP_DELAY_MS)

        log("[prepare-council-prompt] Saved prompt", { filePath, length: args.prompt.length, mode })

        return `Council prompt saved to: ${filePath} (mode: ${mode}, intent: ${resolvedIntent ?? "none"})

Use this path in each council member's task() call:
- prompt: "Read ${filePath} for your instructions."

The file auto-deletes after 30 minutes.`
      } catch (err) {
        return `Error saving council prompt: ${String(err)}`
      }
    },
  })
}
