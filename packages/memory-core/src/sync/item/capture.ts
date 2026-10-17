// captureItem (sync-design §5): the working tree is diffed against the item's state at
// an explicit baseline frontier, on a throwaway fork at that frontier, so a stale writer's
// diff can only touch text it actually saw. That diff is merged into a throwaway copy of
// the CURRENT document and the result is transplanted onto the current document under the
// doc's own peer (review r3): every op this device ever exports carries its one stable
// peer, so the version vector stays one entry per device, and the ops continue that peer's
// counters instead of colliding with its later ops at the stale baseline (review r1 #1).
// Returns null when nothing changed. Replay safety lives one level up, in captureOnDevice
// (device-capture.ts), which is the only exported capture entry point.

import type { LoroDoc } from "../../crdt/loro-runtime"

import type { ItemFrontier } from "./document"
import type { FmValue } from "./frontmatter"
import { splitItem } from "./frontmatter"
import { analyzeHistory } from "./history"
import { applyKey, clearKey } from "./key-writers"
import { renderDocContent } from "./render"
import { transplantContent } from "./transplant"

export class CaptureBaselineError extends Error {
  override readonly name = "CaptureBaselineError"
}

export function captureItem(
  doc: LoroDoc,
  baseText: string,
  baseFrontier: ItemFrontier,
  workingText: string,
  commitMessage?: string,
): Uint8Array | null {
  const current = isCurrentFrontier(doc, baseFrontier)
  const merged = current ? null : mergeOntoCurrent(doc, baseText, baseFrontier, workingText)
  if (!current && merged === null) return null
  const target = doc.fork()
  try {
    target.setPeerId(doc.peerId)
    target.setRecordTimestamp(false)
    if (merged === null) {
      // Baseline is the current state: the diff applies directly, no rebase needed.
      if (renderDocContent(target) !== baseText) {
        throw new CaptureBaselineError("captureItem: baseText is not the item's render at baseFrontier")
      }
      applyWorkingText(target, workingText)
    } else {
      transplantContent(target, merged)
    }
    target.commit(commitMessage === undefined ? undefined : { message: commitMessage })
    const from = doc.oplogVersion()
    if (target.oplogVersion().compare(from) === 0) return null
    return target.export({ mode: "update", from })
  } finally {
    target.free()
    merged?.free()
  }
}

function isCurrentFrontier(doc: LoroDoc, frontier: ItemFrontier): boolean {
  const now = doc.frontiers()
  if (now.length !== frontier.length) return false
  return now.every((id) => frontier.some((f) => f.peer === id.peer && f.counter === id.counter))
}

/** The current document with the user's baseline-to-working diff merged in, under throwaway peers; null when the diff is empty. */
function mergeOntoCurrent(
  doc: LoroDoc,
  baseText: string,
  baseFrontier: ItemFrontier,
  workingText: string,
): LoroDoc | null {
  const scratch = doc.forkAt(baseFrontier)
  try {
    scratch.setRecordTimestamp(false)
    if (renderDocContent(scratch) !== baseText) {
      throw new CaptureBaselineError("captureItem: baseText is not the item's render at baseFrontier")
    }
    applyWorkingText(scratch, workingText)
    scratch.commit()
    const from = scratch.frontiersToVV(baseFrontier)
    if (scratch.oplogVersion().compare(from) === 0) return null
    const merged = doc.fork()
    merged.setRecordTimestamp(false)
    merged.import(scratch.export({ mode: "update", from }))
    return merged
  } finally {
    scratch.free()
  }
}

const NONE: ReadonlySet<string> = new Set()

// The fork is the user's own view (their baseline), so every tag in it is seen: nothing is unseen.
function applyWorkingText(fork: LoroDoc, workingText: string): void {
  const parsed = splitItem(workingText)
  const history = analyzeHistory(fork)
  const wanted = new Map<string, FmValue>()
  if (parsed.fm !== null) for (const entry of parsed.fm) wanted.set(entry.key, entry.value)
  for (const key of history.keys.keys()) {
    const value = wanted.get(key)
    if (value === undefined || value.kind === "remove") clearKey(fork, key, NONE)
  }
  if (parsed.fm !== null) {
    for (const { key, value } of parsed.fm) {
      if (value.kind !== "remove") applyKey(fork, key, value, history, NONE)
    }
  }
  // The body never carries the BOM, frontmatter or not: it is an encoding marker (review d58391c9b3).
  const bodyTarget = parsed.body
  const bodyCurrent = fork.hasContainer("cid:root-body:Text") ? fork.getText("body").toString() : ""
  if (bodyCurrent !== bodyTarget) fork.getText("body").update(bodyTarget)
}
