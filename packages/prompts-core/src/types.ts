export interface VariantTest {
  test: (input: { modelID?: string; agentName?: string }) => boolean
}

export interface VariantFallback {
  fallback: true
}

export type VariantDefinition = VariantTest | VariantFallback

export interface VariantTable {
  [variantKey: string]: VariantDefinition
}

export interface ResolveVariantInput {
  modelID?: string
  agentName?: string
  variants: VariantTable
}

export interface RuntimeInjection {
  placeholder: string
  resolver: () => string
}

export interface LoadPromptInput {
  source: string
  name: string
  variant: string
  inject?: readonly RuntimeInjection[]
}

export interface LoadedPrompt {
  body: string
  frontmatter: Record<string, unknown>
  resolvedPath: string
}

export class PromptNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PromptNotFoundError"
  }
}

export class NoMatchingVariantError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "NoMatchingVariantError"
  }
}
