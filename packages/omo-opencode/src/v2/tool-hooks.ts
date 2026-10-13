import path from "node:path"
import type { Hooks } from "@opencode-ai/plugin"
import type { V2PluginContext, V2Registration, V2ToolContentPart } from "./context-types"
import { toV1ToolName } from "./tool-names"

/** 2.x file tools take `path`; the 1.x hooks read `filePath` (and most also accept `path`). */
const FILE_TOOLS: ReadonlySet<string> = new Set(["read", "write", "edit"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function toV1Args(tool: string, input: unknown): Record<string, unknown> {
  const args: Record<string, unknown> = isRecord(input) ? { ...input } : {}
  if (FILE_TOOLS.has(tool) && typeof args.path === "string" && args.filePath === undefined) args.filePath = args.path
  return args
}

/** Copies the hook's edits back into the 2.x input and removes the `filePath` alias this bridge added. */
function toV2Input(tool: string, original: unknown, args: Record<string, unknown>): Record<string, unknown> {
  const next = { ...args }
  if (FILE_TOOLS.has(tool)) {
    const originalRecord = isRecord(original) ? original : {}
    if (typeof next.filePath === "string" && next.filePath !== originalRecord.path && originalRecord.filePath === undefined) {
      next.path = next.filePath
    }
    if (originalRecord.filePath === undefined) delete next.filePath
  }
  return next
}

/**
 * 1.x file tools titled their result with the file path relative to the worktree, and path-based
 * after-hooks (README and AGENTS.md injection, for one) read it from there. Other tools had no
 * useful title.
 */
function resultTitle(tool: string, args: Record<string, unknown>, worktree: string): string {
  if (!FILE_TOOLS.has(tool)) return ""
  const file = typeof args.filePath === "string" ? args.filePath : typeof args.path === "string" ? args.path : undefined
  if (file === undefined) return ""
  if (!path.isAbsolute(file)) return file
  const relative = path.relative(worktree, file)
  return relative.startsWith("..") || path.isAbsolute(relative) ? file : relative
}

function joinText(content: ReadonlyArray<V2ToolContentPart>): string {
  return content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n")
}

/**
 * Runs the plugin's 1.x `tool.execute.before` and `tool.execute.after` hooks around 2.x tool calls.
 *
 * Before: the hook gets the 1.x tool name and a 1.x-shaped args object; whatever it leaves in `args`
 * becomes the call's input, and a thrown error blocks the call (2.x reports it as the tool's error).
 * After: only for calls that completed, as on 1.x; the hook gets the joined text as `output` and may
 * rewrite it and the metadata.
 */
export async function installToolHooks(context: V2PluginContext, hooks: Hooks): Promise<() => Promise<void>> {
  const registrations: V2Registration[] = []
  const before = hooks["tool.execute.before"]
  const after = hooks["tool.execute.after"]

  if (before !== undefined) {
    registrations.push(
      await context.tool.hook("execute.before", async (event) => {
        const output = { args: toV1Args(event.tool, event.input) as Record<string, unknown> }
        await before({ tool: toV1ToolName(event.tool), sessionID: event.sessionID, callID: event.id }, output)
        event.input = toV2Input(event.tool, event.input, output.args)
      }),
    )
  }

  if (after !== undefined) {
    registrations.push(
      await context.tool.hook("execute.after", async (event) => {
        if (event.status !== "completed" || event.result === undefined) return
        const content = event.result.content ?? []
        const text = joinText(content)
        const metadata = { ...(event.result.metadata ?? {}) }
        const args = toV1Args(event.tool, event.input)
        const output = {
          title: resultTitle(event.tool, args, context.location.project.canonical),
          output: text,
          metadata,
        }
        await after({ tool: toV1ToolName(event.tool), sessionID: event.sessionID, callID: event.id, args }, output)
        if (output.output !== text) {
          event.result.content = [{ type: "text", text: output.output }, ...content.filter((part) => part.type !== "text")]
        }
        event.result.metadata = output.metadata as Record<string, unknown>
      }),
    )
  }

  let disposed = false
  return async () => {
    if (disposed) return
    disposed = true
    for (const registration of registrations.reverse()) await registration.dispose()
  }
}
