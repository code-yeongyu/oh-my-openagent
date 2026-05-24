import type { LoadedPrompt, LoadPromptInput } from "./types"

export async function loadPrompt(_input: LoadPromptInput): Promise<LoadedPrompt> {
  return {
    body: "__red__",
    frontmatter: {},
    resolvedPath: "__red__",
  }
}
