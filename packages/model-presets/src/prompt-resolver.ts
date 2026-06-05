import type { PromptKey } from "./registry"

export type PromptLoader = (key: PromptKey) => string | undefined

export function createPromptResolver(prompts: Record<string, string>): PromptLoader {
  return (key: PromptKey): string | undefined => prompts[key]
}
