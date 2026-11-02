import { type HostCommandInfo, resolveBareSkillCommand, SKILL_COMMAND_PREFIX } from "./bare-skill-command"

export interface AutocompleteItemLike {
  readonly value: string
  readonly label: string
  readonly description?: string
  /** The command declares an argument hint: choosing the row fills `/name ` and waits for arguments. */
  readonly awaitsArguments?: boolean
}

export interface AutocompleteSuggestionsLike {
  readonly items: readonly AutocompleteItemLike[]
  readonly prefix: string
}

export interface AutocompleteProviderLike {
  getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    options: { signal: AbortSignal; force?: boolean },
  ): Promise<AutocompleteSuggestionsLike | null>
}

const LEADING_COMMAND_TOKEN = /^\/([a-z0-9-]+)$/

/**
 * Lists each bundled skill once at top level: its bare `/<name>` alias takes the place of senpi's
 * `skill:<name>` row (#9648). `/skill:` lists stay senpi's own, and a skill whose bare name a
 * same-named command shadows keeps its `skill:<name>` row, the only way left to reach it. Every other
 * provider member (applyCompletion, trigger characters, mention ranges, ...) is the wrapped
 * provider's own, so completion and rendering stay senpi's.
 */
export function wrapWithBareSkillCommands<T extends AutocompleteProviderLike>(
  current: T,
  bundledSkillNames: ReadonlySet<string>,
  hostCommands: () => readonly HostCommandInfo[] | undefined,
): T {
  const getSuggestions: AutocompleteProviderLike["getSuggestions"] = async (lines, cursorLine, cursorCol, options) => {
    const base = await current.getSuggestions(lines, cursorLine, cursorCol, options)
    if (options.force === true || cursorLine !== 0) return base
    const typed = LEADING_COMMAND_TOKEN.exec((lines[0] ?? "").slice(0, cursorCol))?.[1]
    if (typed === undefined) return base
    const items = base?.items ?? []
    const aliases = bareSkillItems(typed, bundledSkillNames, hostCommands(), items)
    if (aliases.length === 0) return base
    const merged = replaceSkillEntries(items, aliases)
    if (merged === undefined) return base
    return { prefix: base?.prefix ?? `/${typed}`, items: merged }
  }
  return new Proxy(current, {
    get(target, property) {
      if (property === "getSuggestions") return getSuggestions
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
}

function bareSkillItems(
  typed: string,
  bundledSkillNames: ReadonlySet<string>,
  commands: readonly HostCommandInfo[] | undefined,
  pageItems: readonly AutocompleteItemLike[],
): AutocompleteItemLike[] {
  return [...bundledSkillNames]
    .filter((name) => name.startsWith(typed))
    .filter((name) => resolveBareSkillCommand(`/${name}`, bundledSkillNames, commands).kind === "expand")
    .sort()
    .map((name) => {
      // The alias mirrors its own `skill:<name>` row: senpi puts the skill's argument hint in that row's
      // description and marks it `awaitsArguments`, and `getCommands()` carries no hint to read instead.
      const skillRow = pageItems.find((item) => item.value === `${SKILL_COMMAND_PREFIX}${name}`)
      const description =
        skillRow?.description ?? commands?.find((entry) => entry.name === `${SKILL_COMMAND_PREFIX}${name}`)?.description
      return {
        value: name,
        label: name,
        ...(description !== undefined && { description }),
        ...(skillRow?.awaitsArguments === true && { awaitsArguments: true }),
      }
    })
}

// Each alias takes its own `skill:<name>` row's place, so senpi's ranking of everything else is
// untouched; an alias whose skill row is absent from this page goes last. Undefined when nothing changed.
function replaceSkillEntries(
  items: readonly AutocompleteItemLike[],
  aliases: readonly AutocompleteItemLike[],
): AutocompleteItemLike[] | undefined {
  const taken = new Set(items.map((item) => item.value))
  const pending = new Map(aliases.filter((alias) => !taken.has(alias.value)).map((alias) => [alias.value, alias]))
  const unplaced = new Set(pending.keys())
  const merged = items.map((item) => {
    const alias = item.value.startsWith(SKILL_COMMAND_PREFIX)
      ? pending.get(item.value.slice(SKILL_COMMAND_PREFIX.length))
      : undefined
    if (alias === undefined) return item
    unplaced.delete(alias.value)
    return alias
  })
  if (pending.size === 0) return undefined
  const appended = [...unplaced].map((name) => pending.get(name)).filter((alias) => alias !== undefined)
  return [...merged, ...appended]
}
