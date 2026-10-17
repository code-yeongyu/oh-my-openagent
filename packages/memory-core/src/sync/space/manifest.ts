// The per-space manifest (sync-design §3): a small Loro document holding an add-wins set
// of binding keys and a display name. Other devices find a space through any of its
// binding keys, and a joined space carries an `absorbed_into` tombstone so a device that
// later sees it never adopts again. Binding keys never leave the document, so a removed
// alias is not expressible; renames add the new key.

import type { LoroDoc, PeerID } from "../../crdt/loro-runtime"

import { loadLoroRuntime } from "../../crdt/loro-runtime"

const BINDINGS_NAME = "bindings"
const NAME_NAME = "name"
const ABSORBED_NAME = "absorbed_into"

export async function createManifestDoc(peer: PeerID): Promise<LoroDoc> {
  const { LoroDoc } = await loadLoroRuntime()
  const doc = new LoroDoc()
  doc.setPeerId(peer)
  doc.setRecordTimestamp(false)
  return doc
}

export function manifestAddBinding(doc: LoroDoc, key: string): boolean {
  const map = doc.getMap(BINDINGS_NAME)
  if (map.get(key) !== undefined) return false
  map.set(key, true)
  doc.commit()
  return true
}

export function manifestHasBinding(doc: LoroDoc, key: string): boolean {
  return doc.getMap(BINDINGS_NAME).get(key) !== undefined
}

export function manifestBindings(doc: LoroDoc): string[] {
  return doc.getMap(BINDINGS_NAME).keys().sort()
}

export function manifestDisplayName(doc: LoroDoc): string | null {
  const text = doc.getText(NAME_NAME).toString()
  return text === "" ? null : text
}

export function manifestSetDisplayName(doc: LoroDoc, name: string): void {
  const text = doc.getText(NAME_NAME)
  if (text.toString() === name) return
  text.update(name)
  doc.commit()
}

export function manifestAbsorbedInto(doc: LoroDoc): string | null {
  const value = doc.getMovableList(ABSORBED_NAME).toArray()
  const first = value[0]
  return typeof first === "string" ? first : null
}

export function manifestMarkAbsorbed(doc: LoroDoc, targetSpaceId: string): void {
  if (manifestAbsorbedInto(doc) !== null) return
  doc.getMovableList(ABSORBED_NAME).push(targetSpaceId)
  doc.commit()
}

export function manifestExport(doc: LoroDoc): Uint8Array {
  return doc.export({ mode: "update" })
}
