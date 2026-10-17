import { parse, parseDocument } from "yaml"

import type { LoroDoc } from "../../crdt/loro-runtime"
import { splitItem, type FmValue } from "../item/frontmatter"
import { withRegisterValues } from "../item/adopt-values"
import { captureItem } from "../item/capture"
import { itemFrontier } from "../item/index"
import type { AdoptionPlan } from "./adopt"

/**
 * Commit a plan as ONE update (capture + extra register values) on a plain doc, for the property
 * tests. The engine's path is captureOnDevice(..., plan.extraRegisterValues); adopt-replay.test.ts
 * covers its replay safety, which this helper deliberately does not have.
 */
export function applyPlan(doc: LoroDoc, base: string, plan: AdoptionPlan): void {
  if (plan.action !== "capture") return
  const update = withRegisterValues(doc, captureItem(doc, base, itemFrontier(doc), plan.workingText), plan.extraRegisterValues)
  if (update !== null) doc.import(update)
}

/** Build a T2 marker block byte-exactly the way the Mini hub's md-merge-driver emits it. */
export function t2Block(day: string, forPath: string, fmText: string): string {
  const kept = fmText.replace(/-->/g, "-- >")
  return `\n<!-- memory-sync ${day}: the other machine had different frontmatter for ${forPath}; kept here so no fact is lost:\n${kept}-->\n`
}

/** Index parsed frontmatter entries by key for value-level assertions. */
export function fmValuesByKey(entries: readonly { key: string; value: FmValue }[]): Map<string, FmValue> {
  const map = new Map<string, FmValue>()
  for (const entry of entries) map.set(entry.key, entry.value)
  return map
}

/**
 * The register components a doc captured once from `text` holds: one whole value per register key.
 * For tests whose space is plain text rather than a doc (a real caller passes activeRegisters(doc)).
 */
export function soleRegisters(text: string | null): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const { key, value } of splitItem((text ?? "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n")).fm ?? []) {
    if (value.kind === "reg") out.set(key, [value.value])
  }
  return out
}

export interface RenderedFact {
  readonly set: boolean
  readonly values: readonly unknown[]
}

/**
 * The oracle's reading of a rendered item, independent of the planner: the header is parsed with
 * `yaml` directly, a sequence is a set, and a register rendered as several values (sync-design
 * #454 §2: one double-quoted string of canonical sources joined with " / ") is split into its
 * components. Generated values never contain " / ", so the split is unambiguous here.
 */
export function renderedFacts(text: string): Map<string, RenderedFact> {
  const out = new Map<string, RenderedFact>()
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text)
  if (match === null) return out
  const doc = parseDocument(match[1] ?? "", { schema: "core", merge: true })
  if (doc.errors.length > 0) return out
  const header: unknown = doc.toJS()
  if (typeof header !== "object" || header === null || Array.isArray(header)) return out
  for (const [key, value] of Object.entries(header)) {
    if (Array.isArray(value)) out.set(key, { set: true, values: value })
    else if (typeof value === "string" && value.includes(" / ")) {
      out.set(key, { set: false, values: value.split(" / ").map((part) => parse(part, { schema: "core" })) })
    } else out.set(key, { set: false, values: [value] })
  }
  return out
}

/** A source value is held when it is a whole register component, a set element, or (a sequence) a subset of the set. */
export function holdsValue(facts: ReadonlyMap<string, RenderedFact>, key: string, wanted: unknown): boolean {
  if (Array.isArray(wanted) && wanted.length === 0) return true
  const fact = facts.get(key)
  if (fact === undefined) return false
  if (fact.set && Array.isArray(wanted)) return wanted.every((element) => fact.values.some((held) => Bun.deepEquals(held, element)))
  return fact.values.some((held) => Bun.deepEquals(held, wanted))
}

/** A parsed source value as plain data, for holdsValue. */
export function plainValue(value: FmValue): unknown {
  switch (value.kind) {
    case "set":
      return value.elements.map((element) => parse(element, { schema: "core" }))
    case "reg":
      return parse(value.value, { schema: "core" })
    case "remove":
      return null
  }
}

/** Run git in a fixture repository; returns stdout, throws on failure. */
export function git(dir: string, args: readonly string[]): string {
  const r = Bun.spawnSync(["git", "-C", dir, ...args])
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr.toString()}`)
  return r.stdout.toString()
}
