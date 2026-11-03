// Types for setup-opencode-models.js, which omo-senpi's config-startup imports across the package
// boundary: omo-ai ships this module as plain JS, so it is the single source of the mapping.

export type ModelRegistry = {
  readonly models: ReadonlyMap<string, ReadonlySet<string>>
  readonly dynamic: ReadonlySet<string>
}

export type EditionRouting = {
  readonly agents: Readonly<Record<string, unknown>>
  readonly categories: Readonly<Record<string, unknown>>
  readonly notices: readonly string[]
}

export type ConvertedChoice = {
  readonly name: string
  readonly entry: Readonly<Record<string, unknown>>
  readonly from: string
}

export const NATIVE_AGENT_NAMES: readonly string[]

export function readEditionRouting(options: { home: string; env: Readonly<Record<string, string | undefined>> }): EditionRouting

export function readModelChoices(options: {
  home: string
  env: Readonly<Record<string, string | undefined>>
  opencodeBlock: unknown
}): Record<string, unknown>

export function hasModelChoices(raw: unknown): boolean

export function translateModelRef(
  raw: unknown,
  context: { registry?: ModelRegistry; oauthProviders: ReadonlySet<string> },
): { ref?: string; provider?: string; modelId?: string; reason?: string }

export function convertModelChoices(
  raw: unknown,
  registry: ModelRegistry,
  oauthProviders?: ReadonlySet<string>,
): {
  defaultModel?: { source: string; provider: string; modelId: string; ref: string }
  categories: readonly ConvertedChoice[]
  agents: readonly ConvertedChoice[]
  dropped: readonly string[]
}

export function nativeRoutingLine(section: string, name: string, value: Readonly<Record<string, unknown>>): string

export function openCodeRoutingGap(document: unknown, edition: EditionRouting): readonly string[]

export function openCodeRoutingNotice(lines: readonly string[]): string
