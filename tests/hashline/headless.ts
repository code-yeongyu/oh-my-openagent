#!/usr/bin/env bun
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { join, dirname } from "node:path"
import { stepCountIs, streamText, type CoreMessage } from "ai"
import { tool } from "ai"
import { createFriendli } from "@friendliai/ai-provider"
import { z } from "zod"
import { formatHashLines } from "../src/tools/hashline-edit/hash-computation"
import { normalizeHashlineEdits } from "../src/tools/hashline-edit/normalize-edits"
import { applyHashlineEditsWithReport } from "../src/tools/hashline-edit/edit-operations"
import { canonicalizeFileText, restoreFileText } from "../src/tools/hashline-edit/file-text-canonicalization"

const DEFAULT_MODEL = "MiniMaxAI/MiniMax-M2.5"
const MAX_STEPS = 50
const sessionId = `bench-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const emit = (event: Record<string, unknown>) =>
  console.log(JSON.stringify({ sessionId, timestamp: new Date().toISOString(), ...event }))

// ── CLI ──────────────────────────────────────────────────────
function parseArgs(): { prompt: string; modelId: string } {
  const args = process.argv.slice(2)
  let prompt = ""
  let modelId = DEFAULT_MODEL
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "-p" || args[i] === "--prompt") && args[i + 1]) {
      prompt = args[++i]
    } else if ((args[i] === "-m" || args[i] === "--model") && args[i + 1]) {
      modelId = args[++i]
    } else if (args[i] === "--reasoning-mode" && args[i + 1]) {
      i++ // consume
    }
    // --no-translate, --think consumed silently
  }
  if (!prompt) {
    console.error("Usage: bun run benchmarks/headless.ts -p <prompt> [-m <model>]")
    process.exit(1)
  }
  return { prompt, modelId }
}

// ── Tools ────────────────────────────────────────────────────
const readFileTool = tool({
  description: "Read a file with hashline-tagged content (LINE#ID format)",
  inputSchema: z.object({ path: z.string().describe("File path") }),
  execute: async ({ path }) => {
    const fullPath = join(process.cwd(), path)
    try {
      const content = await readFile(fullPath, "utf-8")
      const lines = content.split("\n")
      const tagged = formatHashLines(content)
      return `OK - read file\npath: ${path}\nlines: ${lines.length}\n\n${tagged}`
    } catch {
      return `Error: File not found: ${path}`
    }
  },
})

const editFileTool = tool({
  description: "Edit a file using hashline anchors (LINE#ID format)",
  inputSchema: z.object({
    path: z.string(),
    edits: z.array(
      z.object({
        op: z.enum(["replace", "append", "prepend"]),
        pos: z.string().optional(),
        end: z.string().optional(),
        lines: z.union([z.array(z.string()), z.string(), z.null()]),
      })
    ).min(1),
  }),
  execute: async ({ path, edits }) => {
    const fullPath = join(process.cwd(), path)
    try {
      let rawContent = ""
      let exists = true
      try {
        rawContent = await readFile(fullPath, "utf-8")
      } catch {
        exists = false
      }

      const normalized = normalizeHashlineEdits(edits)

      if (!exists) {
        const canCreate = normalized.every(
          (e) => (e.op === "append" || e.op === "prepend") && !e.pos
        )
        if (!canCreate) return `Error: File not found: ${path}`
      }

      const envelope = canonicalizeFileText(rawContent)
      const result = applyHashlineEditsWithReport(envelope.content, normalized)

      if (result.content === envelope.content) {
        return `Error: No changes made to ${path}. The edits produced identical content.`
      }

      const writeContent = restoreFileText(result.content, envelope)
      await mkdir(dirname(fullPath), { recursive: true })
      await writeFile(fullPath, writeContent, "utf-8")

      const oldLineCount = rawContent.split("\n").length
      const newLineCount = writeContent.split("\n").length
      const delta = newLineCount - oldLineCount
      const sign = delta > 0 ? "+" : ""
      const action = exists ? "Updated" : "Created"
      return `${action} ${path}\n${edits.length} edit(s) applied, ${sign}${delta} line(s)`
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`
    }
  },
})

// ── Agent Loop ───────────────────────────────────────────────
async function run() {
  const { prompt, modelId } = parseArgs()

  const friendli = createFriendli({ apiKey: process.env.FRIENDLI_TOKEN! })
  const model = friendli(modelId)
  const tools = { read_file: readFileTool, edit_file: editFileTool }

  emit({ type: "user", content: prompt })

  const messages: CoreMessage[] = [{ role: "user", content: prompt }]
  const system =
    "You are a code editing assistant. Use read_file to read files and edit_file to edit them. " +
    "Always read a file before editing it to get fresh LINE#ID anchors."

  for (let step = 0; step < MAX_STEPS; step++) {
    const stream = streamText({
      model,
      tools,
      messages,
      system,
      stopWhen: stepCountIs(1),
    })

    let currentText = ""
    for await (const part of stream.fullStream) {
      switch (part.type) {
        case "text-delta":
          currentText += part.text
          break
        case "tool-call":
          emit({
            type: "tool_call",
            tool_call_id: part.toolCallId,
            tool_name: part.toolName,
            tool_input: part.args,
            model: modelId,
          })
          break
        case "tool-result": {
          const output = typeof part.result === "string" ? part.result : JSON.stringify(part.result)
          const isError = typeof output === "string" && output.startsWith("Error:")
          emit({
            type: "tool_result",
            tool_call_id: part.toolCallId,
            output,
            ...(isError ? { error: output } : {}),
          })
          break
      }
    }

    const response = await stream.response
    messages.push(...response.messages)

    const finishReason = await stream.finishReason
    if (finishReason !== "tool-calls") {
      if (currentText.trim()) {
        emit({ type: "assistant", content: currentText, model: modelId })
      }
      break
    }
  }
}

// ── Signal + Startup ─────────────────────────────────────────
process.once("SIGINT", () => process.exit(0))
process.once("SIGTERM", () => process.exit(143))

const startTime = Date.now()
run()
  .catch((error) => {
    emit({ type: "error", error: error instanceof Error ? error.message : String(error) })
    process.exit(1)
  })
  .then(() => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)
    console.error(`[headless] Completed in ${elapsed}s`)
  })
