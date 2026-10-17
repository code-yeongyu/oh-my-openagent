// Deterministic item rendering (sync-design §2, §5; spec #454): frontmatter keys in first-write
// (Lamport, peer) order, each key's value built as a YAML node from the merged typed model and
// emitted as ONE document, then the body exactly as stored. A dead item (isLive false) is absent
// from disk and renders null.

import type { LoroDoc } from "../../crdt/loro-runtime"
import type { Node } from "yaml"

import { isLive } from "./document"
import { emitFrontmatter, valueNode } from "./frontmatter"
import type { Stamp } from "./history"
import { analyzeHistory } from "./history"
import { assertNever } from "./key-writers"
import { BODY_NAME, cidRoot, combineKey, readKeyState } from "./state"

export interface FrontmatterEntry {
  readonly key: string
  readonly node: Node
}

export function renderItem(doc: LoroDoc): string | null {
  if (!isLive(doc)) return null
  return renderDocContent(doc)
}

/** Content render regardless of liveness; capture's baseline check uses this. */
export function renderDocContent(doc: LoroDoc): string {
  const entries = frontmatterEntries(doc)
  const body = bodyOf(doc)
  if (entries.length === 0) return body
  return `---\n${emitFrontmatter(entries)}\n---\n${body}`
}

export function frontmatterEntries(doc: LoroDoc): FrontmatterEntry[] {
  const history = analyzeHistory(doc)
  const entries: FrontmatterEntry[] = []
  const keys = [...history.keys.entries()].sort((a, b) => stampCompare(a[1].first, b[1].first))
  for (const [key, kh] of keys) {
    const combined = combineKey(readKeyState(doc, key), key, kh, history)
    if (combined === null) continue
    switch (combined.kind) {
      case "set":
        entries.push({ key, node: valueNode(combined.elements, false) })
        break
      case "reg":
        entries.push({ key, node: valueNode(combined.text, combined.verbatim) })
        break
      default:
        assertNever(combined)
    }
  }
  return entries
}

export function bodyOf(doc: LoroDoc): string {
  return doc.hasContainer(cidRoot(BODY_NAME, "Text")) ? doc.getText(BODY_NAME).toString() : ""
}

function stampCompare(a: Stamp, b: Stamp): number {
  if (a.lamport !== b.lamport) return a.lamport - b.lamport
  const pa = BigInt(a.peer)
  const pb = BigInt(b.peer)
  return pa < pb ? -1 : pa > pb ? 1 : 0
}
