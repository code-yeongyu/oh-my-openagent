// Transplant (review r3): capture computes the user's edit on a throwaway fork and merges
// it into a throwaway copy of the CURRENT document, so Loro decides what a stale diff means
// on top of everything newer. Those throwaway ops never leave capture. This module replays
// the merged result onto the device's own fork as fresh ops under the device's stable peer:
// text containers are updated to the merged text, map containers (set elements, register
// entries) gain the merged doc's new entries under new device tags and drop the entries the
// merge removed. Supersede lists are rewritten through the same tag renames.

import type { LoroDoc } from "../../crdt/loro-runtime"

import { BODY_NAME, cidRoot } from "./state"
import { newTag } from "./tag"

const FM_PREFIX = "fm\x1f"

export function transplantContent(target: LoroDoc, merged: LoroDoc): void {
  for (const [name, cid] of Object.entries(merged.getShallowValue())) {
    if (name !== BODY_NAME && !name.startsWith(FM_PREFIX)) continue
    if (typeof cid !== "string") continue
    if (cid.endsWith(":Text")) transplantText(target, merged, name)
    else if (cid.endsWith(":Map")) transplantMap(target, merged, name)
  }
}

function transplantText(target: LoroDoc, merged: LoroDoc, name: string): void {
  const want = merged.getText(name).toString()
  const have = target.hasContainer(cidRoot(name, "Text")) ? target.getText(name).toString() : ""
  if (want !== have) target.getText(name).update(want)
}

function transplantMap(target: LoroDoc, merged: LoroDoc, name: string): void {
  const want = new Map(merged.getMap(name).entries())
  const have = target.hasContainer(cidRoot(name, "Map")) ? new Map(target.getMap(name).entries()) : new Map()
  const added = [...want.keys()].filter((tag) => !have.has(tag))
  const removed = [...have.keys()].filter((tag) => !want.has(tag))
  if (added.length === 0 && removed.length === 0) return
  const renames = new Map<string, string>()
  added.forEach((tag, index) => renames.set(tag, newTag(target, JSON.stringify(want.get(tag)), index + 1)))
  const map = target.getMap(name)
  for (const tag of removed) map.delete(tag)
  for (const tag of added) {
    const renamed = renames.get(tag)
    if (renamed !== undefined) map.set(renamed, retarget(want.get(tag), renames))
  }
}

function retarget(value: unknown, renames: ReadonlyMap<string, string>): unknown {
  if (typeof value !== "object" || value === null || !("v" in value) || !("s" in value)) return value
  const supersedes = value.s
  if (!Array.isArray(supersedes)) return value
  return { v: value.v, s: supersedes.map((tag) => (typeof tag === "string" ? (renames.get(tag) ?? tag) : tag)) }
}
