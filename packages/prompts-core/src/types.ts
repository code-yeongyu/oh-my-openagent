export type ModelVariant =
  | "default"
  | "gpt"
  | "gemini"
  | "kimi"
  | "glm"
  | "planner"
  | "codex"
  | "opus-4-7"
  | "minimax"

export type FilesystemPromptSource = {
  readonly kind?: "filesystem"
  readonly baseDir: string
}

export type BundledPromptSource = {
  readonly kind: "bundled"
  readonly content: string
  readonly filePath: string
}

export type PromptSource = FilesystemPromptSource | BundledPromptSource

export type RuntimeInjection = {
  readonly placeholder: string
  readonly resolver: () => string | Promise<string>
}

export type SyncRuntimeInjection = {
  readonly placeholder: string
  readonly resolver: () => string
}

export type LoadFilesystemPromptInput = {
  readonly source: FilesystemPromptSource
  readonly name: string
  readonly variant: string
  readonly inject?: readonly RuntimeInjection[]
}

export type LoadBundledPromptInput = {
  readonly source: BundledPromptSource
  readonly name: string
  readonly variant: string
  readonly inject?: readonly SyncRuntimeInjection[]
}

export type LoadPromptInput = LoadFilesystemPromptInput | LoadBundledPromptInput

export type LoadedPrompt<TFrontmatter = Record<string, unknown>> = {
  readonly frontmatter: TFrontmatter
  readonly body: string
  readonly hadFrontmatter: boolean
  readonly parseError: boolean
  readonly filePath: string
}

export type VariantTable = Readonly<Record<string, PromptSource>>
