import { createHash } from "node:crypto"
import { z } from "zod"

export const NativePromptContext = z.object({
  model: z.string(),
  tools: z.array(z.string()),
  toolSnippets: z.record(z.string(), z.string()).optional(),
  toolPermissions: z.array(z.object({
    pattern: z.string(),
    permission: z.enum(["allow", "ask", "deny"]),
    scope: z.string().optional(),
  })).optional(),
  restriction: z.literal("hephaestus").optional(),
  useTaskSystem: z.boolean().optional(),
})

export type NativePromptContext = z.infer<typeof NativePromptContext>

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
  render: (context: NativePromptContext) => string | undefined,
  refreshTools = false,
): void {
  for (const [index, part] of system.entries()) {
    system[index] = part.replace(
      /<omo-model-core ref="([0-9a-f]{16})">\n[\s\S]*?<\/omo-model-core>/g,
      (frame, ref: string) => {
        const context = recall(ref)
        if (!context || (!refreshTools && context.model === model)) return frame
        return render({ ...context, model: model ?? context.model }) ?? frame
      },
    )
  }
}
