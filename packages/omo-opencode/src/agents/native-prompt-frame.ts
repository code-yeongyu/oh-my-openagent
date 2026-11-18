import { createHash } from "node:crypto"
import { z } from "zod"

export const NativePromptContext = z.object({
  model: z.string(),
  tools: z.array(z.string()),
  toolSnippets: z.record(z.string(), z.string()).optional(),
  toolPermissions: z
    .array(
      z.object({
        pattern: z.string(),
        permission: z.enum(["allow", "ask", "deny"]),
        scope: z.string().optional(),
      }),
    )
    .optional(),
  restriction: z.literal("hephaestus").optional(),
  useTaskSystem: z.boolean().optional(),
  /** The agent carries the refusal rule; the frame adds it when the model core does not state it (#14186). */
  refusalRule: z.literal(true).optional(),
  /** The Hephaestus role; it follows the frame unless the preset stands alone, so a rebuild replaces both (#14186). */
  role: z.string().optional(),
  /** This frame's preset stands alone: the role was not put after it. */
  standalone: z.literal(true).optional(),
})

export type NativePromptContext = z.infer<typeof NativePromptContext>

/** A rendered agent prompt: the frame, and the role text that follows it ("" when nothing does). */
export type NativePromptParts = { readonly frame: string; readonly role: string }

// The frame is part of the system prompt the model reads, so it carries only a reference; the context
// (tool snippets, permission rules) stays in this process. OpenCode rebuilds the system prompt from the
// agent config on every request, and the config hook and the system transform run in the same process.
const MAX_CONTEXTS = 4096
const contexts = new Map<string, NativePromptContext>()

function remember(ref: string, context: NativePromptContext): void {
  contexts.delete(ref)
  contexts.set(ref, context)
  if (contexts.size > MAX_CONTEXTS) {
    const oldest = contexts.keys().next()
    if (!oldest.done) contexts.delete(oldest.value)
  }
}

function recall(ref: string): NativePromptContext | undefined {
  const context = contexts.get(ref)
  if (context) remember(ref, context)
  return context
}

export function frameNativePrompt(body: string, context: NativePromptContext): string {
  const ref = createHash("sha256").update(JSON.stringify(context)).digest("hex").slice(0, 16)
  remember(ref, context)
  return `<omo-model-core ref="${ref}">\n${body}\n</omo-model-core>`
}

export function replaceNativePromptFrames(
  system: string[],
  model: string | undefined,
  render: (context: NativePromptContext) => NativePromptParts | undefined,
  refreshTools = false,
): void {
  for (const [index, part] of system.entries()) {
    let rebuilt = ""
    let consumed = 0
    for (const match of part.matchAll(/<omo-model-core ref="([0-9a-f]{16})">\n[\s\S]*?<\/omo-model-core>/g)) {
      const context = recall(match[1] ?? "")
      if (!context || (!refreshTools && context.model === model)) continue
      const target = model ?? context.model
      const next = render({ ...context, model: target })
      if (next === undefined) continue
      const frameEnd = match.index + match[0].length
      // The role the old build put after the frame is rebuilt with it. When other text sits there, something
      // else rewrote the prompt: only the frame is swapped, so a role is never added next to an edited one.
      const appended = context.role && !context.standalone ? `\n\n${context.role}` : ""
      const ownsRole = part.startsWith(appended, frameEnd)
      rebuilt += part.slice(consumed, match.index) + next.frame + (ownsRole && next.role ? `\n\n${next.role}` : "")
      consumed = ownsRole ? frameEnd + appended.length : frameEnd
    }
    system[index] = rebuilt + part.slice(consumed)
  }
}
