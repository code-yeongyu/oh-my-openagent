import { normalizeName } from "./name"
import { ID_PREFIX_SHAPE } from "./parse"

/** What the thread-part ladder reads of one candidate thread. */
export type LadderView = {
  /** The thread id; empty when the row publishes none. */
  readonly id: string
  /** Session ids that also name it: a host routing id (`rpc-N`) or a device's listing key. */
  readonly keys?: readonly string[]
  /** Account aliases it holds. */
  readonly aliases?: readonly string[]
  /** Its own name; empty when it has none (a fallback name is never an address). */
  readonly name: string
}

/** The ladder steps, in order: exact id > session id > alias > name > unique 8+ hex id prefix. */
export type LadderStep = "id" | "session_id" | "alias" | "name" | "id_prefix"

export type LadderMatch<E> =
  | { readonly kind: "one"; readonly step: LadderStep; readonly entry: E }
  | { readonly kind: "many"; readonly step: LadderStep; readonly entries: readonly E[] }
  | { readonly kind: "none" }

export type LadderOptions<E> = {
  readonly view: (entry: E) => LadderView
  /** The entries a name may match (the caller's scope); every entry when absent. Ids, keys and aliases are not scoped. */
  readonly named?: (entry: E) => boolean
  /** The id prefix step: off with false; `exclude` leaves that thread id out of its candidates. Default on. */
  readonly idPrefix?: boolean | { readonly exclude: string }
}

const found = <E>(step: LadderStep, entries: readonly E[]): LadderMatch<E> | undefined => {
  const [only] = entries
  if (only === undefined) return undefined
  return entries.length === 1 ? { kind: "one", step, entry: only } : { kind: "many", step, entries }
}

/**
 * The one thread-part ladder (design section 3) every resolver runs over its candidates: the first step that matches
 * answers, one entry or many. An exact id and a session id may be held by several entries (one thread listed on two
 * devices); the caller decides what many holders mean. An alias names one thread: its first holder answers. A prefix
 * counts each thread id once.
 */
export function matchThread<E>(entries: readonly E[], text: string, opts: LadderOptions<E>): LadderMatch<E> {
  const views = entries.map((entry) => ({ entry, view: opts.view(entry) }))
  const pick = (step: LadderStep, test: (view: LadderView) => boolean, among = views) =>
    found(
      step,
      among.filter((item) => test(item.view)).map((item) => item.entry),
    )
  const byId = text === "" ? undefined : pick("id", (view) => view.id === text)
  if (byId !== undefined) return byId
  const byKey = pick("session_id", (view) => view.keys?.includes(text) === true)
  if (byKey !== undefined) return byKey
  const wanted = normalizeName(text)
  if (wanted === "") return { kind: "none" }
  const aliased = views.find((item) => item.view.aliases?.some((alias) => normalizeName(alias) === wanted) === true)
  if (aliased !== undefined) return { kind: "one", step: "alias", entry: aliased.entry }
  const named = opts.named
  const byName = pick(
    "name",
    (view) => view.name !== "" && normalizeName(view.name) === wanted,
    named === undefined ? views : views.filter((item) => named(item.entry)),
  )
  if (byName !== undefined) return byName
  if (opts.idPrefix === false || !ID_PREFIX_SHAPE.test(text)) return { kind: "none" }
  const prefix = text.toLowerCase()
  const excluded = typeof opts.idPrefix === "object" ? opts.idPrefix.exclude : undefined
  const byThread = new Map<string, E>()
  for (const { entry, view } of views)
    if (view.id !== excluded && view.id.toLowerCase().startsWith(prefix) && !byThread.has(view.id))
      byThread.set(view.id, entry)
  return found("id_prefix", [...byThread.values()]) ?? { kind: "none" }
}
