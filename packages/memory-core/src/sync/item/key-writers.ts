// Frontmatter key writers (sync-design §2). A key's kind is register or set, fixed by its first
// write; a value of the other kind is a whole-value replacement converted into the key's kind.
// `unseen` holds the register and set map tags the user never saw (concurrent writes that reached
// the doc after the user's view): a writer never supersedes or deletes them, so a concurrent value
// stays and renders as a conflict instead of being lost.

import type { LoroDoc } from "../../crdt/loro-runtime"

import type { FmValue } from "./frontmatter"
import type { ItemHistory } from "./history"
import type { KeyState } from "./state"
import { activeReg, combineKey, fmName, orderedSetElements, readKeyState, regText } from "./state"
import { newTag } from "./tag"

export type FieldValue = Exclude<FmValue, { kind: "remove" }>

export function applyKey(fork: LoroDoc, key: string, value: FieldValue, history: ItemHistory, unseen: ReadonlySet<string>): void {
  const kh = history.keys.get(key)
  if (kh === undefined) {
    writeNatural(fork, key, value)
    return
  }
  const state = readKeyState(fork, key)
  const combined = combineKey(state, key, kh, history)
  switch (kh.kind) {
    case "set": {
      const target = toElements(value)
      const current = combined?.kind === "set" ? combined.elements : orderedSetElements(state, key, history)
      if (sameList(current, target)) return
      syncSet(fork, key, state, target, unseen)
      supersedeRegister(fork, key, state, unseen)
      return
    }
    case "reg": {
      const target = toRegister(value)
      // Canonical sources compare exactly, so retyping 3 as '3' is a real write (review r6 M2). Only
      // a multi-value join, rendered as one quoted string, compares by the string it holds.
      if (combined?.kind === "reg" && (combined.text === target || (!combined.verbatim && combined.text === regText(target)))) return
      const active = activeReg(state.reg)
      // A no-op only when every active entry already holds the target. Otherwise the user is
      // writing over what they saw (a hand resolution, r2 HIGH-2): supersede the seen entries.
      if (active.length > 0 && active.every((e) => e.value === target)) return
      const entry = { v: target, s: active.filter((e) => !unseen.has(e.tag)).map((e) => e.tag) }
      fork.getMap(fmName(key, "reg")).set(newTag(fork, target), entry)
      deleteSeenElements(fork, key, state, unseen)
      return
    }
    default:
      return assertNever(kh.kind)
  }
}

export function writeNatural(fork: LoroDoc, key: string, value: FieldValue): void {
  switch (value.kind) {
    case "set": {
      const map = fork.getMap(fmName(key, "set"))
      value.elements.forEach((element, slot) => map.set(newTag(fork, element, slot), element))
      return
    }
    case "reg":
      fork.getMap(fmName(key, "reg")).set(newTag(fork, value.value), { v: value.value, s: [] })
      return
    default:
      return assertNever(value)
  }
}

/**
 * Insert-only adoption (sync-design §3): one more register entry that supersedes nothing, so the
 * value shows beside every active one. A value ANY entry ever held, active or superseded, adds
 * nothing: this is the WRITE rule, shared with registerValuesWritten (adopt-values.ts). The deletion
 * gate's READ rule is active entries only (space/read-back.ts); the two differ on purpose.
 */
export function addRegisterValue(fork: LoroDoc, key: string, value: string, slot = 0): void {
  // Any entry that ever held this value, active or superseded, means it was written already. A
  // superseded one was replaced by a writer who saw it, so re-adding it (a replay, a stale copy)
  // would let an older write come back above a newer one (review r9 LOW 1).
  if (readKeyState(fork, key).reg.some((entry) => entry.value === value)) return
  fork.getMap(fmName(key, "reg")).set(newTag(fork, value, slot), { v: value, s: [] })
}

export function clearKey(fork: LoroDoc, key: string, unseen: ReadonlySet<string>): void {
  const state = readKeyState(fork, key)
  deleteSeenElements(fork, key, state, unseen)
  supersedeRegister(fork, key, state, unseen)
}

/** Element-wise set edit: delete the seen tags of `removed`, add `added` elements not present. */
export function editSet(fork: LoroDoc, key: string, removed: ReadonlySet<string>, added: readonly string[], unseen: ReadonlySet<string>): void {
  const state = readKeyState(fork, key)
  const map = fork.getMap(fmName(key, "set"))
  for (const { tag, element } of state.set) if (removed.has(element) && !unseen.has(tag)) map.delete(tag)
  const present = new Set(state.set.filter((e) => !removed.has(e.element)).map((e) => e.element))
  added.forEach((element, slot) => {
    if (!present.has(element)) map.set(newTag(fork, element, slot), element)
  })
}

function deleteSeenElements(fork: LoroDoc, key: string, state: KeyState, unseen: ReadonlySet<string>): void {
  if (state.set.length === 0) return
  const map = fork.getMap(fmName(key, "set"))
  for (const { tag } of state.set) if (!unseen.has(tag)) map.delete(tag)
}

function supersedeRegister(fork: LoroDoc, key: string, state: KeyState, unseen: ReadonlySet<string>): void {
  const active = activeReg(state.reg).filter((e) => !unseen.has(e.tag))
  if (active.length === 0) return
  fork.getMap(fmName(key, "reg")).set(newTag(fork, "null"), { v: null, s: active.map((e) => e.tag) })
}

function syncSet(fork: LoroDoc, key: string, state: KeyState, target: readonly string[], unseen: ReadonlySet<string>): void {
  const wanted = new Set(target)
  const present = new Set(state.set.map((e) => e.element))
  const map = fork.getMap(fmName(key, "set"))
  for (const { tag, element } of state.set) if (!wanted.has(element) && !unseen.has(tag)) map.delete(tag)
  target.forEach((element, slot) => {
    if (!present.has(element)) map.set(newTag(fork, element, slot), element)
  })
}

function toElements(value: FieldValue): readonly string[] {
  switch (value.kind) {
    case "set":
      return value.elements
    case "reg":
      return [value.value]
    default:
      return assertNever(value)
  }
}

function toRegister(value: FieldValue): string {
  switch (value.kind) {
    case "reg":
      return value.value
    case "set":
      return value.flow
    default:
      return assertNever(value)
  }
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

export function assertNever(value: never): never {
  throw new Error(`unhandled field kind: ${JSON.stringify(value)}`)
}
