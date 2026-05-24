export type ModelVariant =
  | "default"
  | "gpt"
  | "gemini"
  | "kimi"
  | "glm"
  | "planner"
  | "opus-4-7"
  | "minimax"

export type PromptSource = {
  readonly baseDir: string
}

export type RuntimeInjection = {
  readonly placeholder: string
  readonly resolver: () => string | Promise<string>
}

export type LoadPromptInput = {
  readonly source: PromptSource
  readonly name: string
  readonly variant: string
  readonly inject?: readonly RuntimeInjection[]
}

export type LoadedPrompt<TFrontmatter = Record<string, unknown>> = {
  readonly frontmatter: TFrontmatter
  readonly body: string
  readonly hadFrontmatter: boolean
  readonly parseError: boolean
  readonly filePath: string
}

export type VariantTable = Readonly<Record<string, PromptSource>>
