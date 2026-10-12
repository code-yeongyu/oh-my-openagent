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

export function frameNativePrompt(body: string, context: NativePromptContext): string {
  const encoded = JSON.stringify(context).replaceAll("<", "\\u003c")
  return `<omo-model-core>${encoded}\n${body}\n</omo-model-core>`
}

export function replaceNativePromptFrames(
  system: string[],
  model: string | undefined,
  render: (context: NativePromptContext) => string | undefined,
  refreshTools = false,
): void {
  for (const [index, part] of system.entries()) {
    system[index] = part.replace(
      /<omo-model-core>([^\n]+)\n[\s\S]*?<\/omo-model-core>/g,
      (frame, metadata: string) => {
        let parsed: unknown
        try {
          parsed = JSON.parse(metadata)
        } catch (error) {
          if (error instanceof SyntaxError) return frame
          throw error
        }
        const context = NativePromptContext.safeParse(parsed)
        if (!context.success || (!refreshTools && context.data.model === model)) return frame
        return render({ ...context.data, model: model ?? context.data.model }) ?? frame
      },
    )
  }
}
