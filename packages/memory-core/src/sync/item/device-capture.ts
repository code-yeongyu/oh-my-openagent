// The capture entry point (reviews r4-r6): every capture runs on a device doc and keys its
// idempotency on (device peer, item, baseline frontier), never on the working text.
// - Working text equal to the current render is not an edit: no ops, and the render is
//   receipted for the baseline with everything in the doc marked seen.
// - A baseline with no landed receipt is captured from the baseline (captureItem).
// - A baseline whose receipt landed is a drift: only the fields the user changed between the
//   receipted text and the working text are written, by field kind (field-delta.ts), directly
//   on the current document under the device peer. The edit already applied under the identity
//   is never applied twice, and no register value is ever merged as text.
// - A receipt is written before the update is returned and is trusted only when the doc holds
//   its ops (capture-receipts.ts), so a crash before import leaves the baseline diff in force.
// - Adoption (sync-design §3) passes the extra register values it plans: they are added (entries
//   superseding nothing) in the SAME update and receipt as the capture, so a replay from the same
//   baseline finds the landed receipt and applies neither half twice.
// recordMaterialized is the engine's half: it receipts the text it writes to disk before the
// write, so a crash between writing the file and saving the baseline cannot re-apply synced text.
// Captures of one item run one at a time in this process; the engine must not run two
// processes against one state dir (receipts are a read-modify-write).

import { randomBytes } from "node:crypto"

import type { LoroDoc } from "../../crdt/loro-runtime"

import type { RegisterValue } from "./adopt-values"
import { registerValuesWritten, withRegisterValues } from "./adopt-values"
import { captureItem } from "./capture"
import type { CaptureReceipt, OpSpan } from "./capture-receipts"
import { captureMessage, readReceipts, receiptLanded, sameFrontier, stampsOf, writeReceipts } from "./capture-receipts"
import type { ItemDevice } from "./device"
import { assertDeviceDoc } from "./device"
import type { ItemFrontier } from "./document"
import { isLive } from "./document"
import { applyUserDelta } from "./field-delta"
import { renderDocContent } from "./render"
import { BODY_NAME } from "./state"

export async function captureOnDevice(
  device: ItemDevice,
  itemKey: string,
  doc: LoroDoc,
  baseText: string,
  baseFrontier: ItemFrontier,
  workingText: string,
  registerValues: readonly RegisterValue[] = [],
): Promise<Uint8Array | null> {
  assertDeviceDoc(device, doc)
  return serialized(`${device.stateDir}\0${itemKey}`, async () => {
    const receipts = await readReceipts(device.stateDir, itemKey)
    const unchanged = isLive(doc) && workingText === renderDocContent(doc)
    if (unchanged && registerValuesWritten(doc, registerValues)) {
      await receipt(device, itemKey, receipts, { base: baseFrontier, text: workingText, landed: doc, seen: mapTags(doc), span: null })
      return null
    }
    const prior = receipts.find((r) => sameFrontier(r.base, baseFrontier) && receiptLanded(doc, r))
    const captureId = randomBytes(12).toString("hex")
    const message = captureMessage(captureId)
    const captured = unchanged
      ? null
      : prior === undefined
        ? captureItem(doc, baseText, baseFrontier, workingText, message)
        : await captureDrift(doc, prior, workingText, message)
    const update = withRegisterValues(doc, captured, registerValues, message)
    if (update === null) return null
    const seenBefore = unchanged ? mapTags(doc) : prior === undefined ? viewTags(doc, baseFrontier) : new Set(prior.seen)
    const before = mapTags(doc)
    const start = doc.oplogVersion().get(doc.peerIdStr) ?? 0
    const after = doc.fork()
    try {
      after.import(update)
      const own = [...mapTags(after)].filter((tag) => !before.has(tag))
      const end = after.oplogVersion().get(doc.peerIdStr) ?? 0
      const span: OpSpan = { peer: doc.peerIdStr, start, end, captureId }
      const seen = new Set([...seenBefore, ...own])
      await receipt(device, itemKey, receipts, { base: baseFrontier, text: workingText, landed: after, seen, span })
    } finally {
      after.free()
    }
    return update
  })
}

export async function recordMaterialized(
  device: ItemDevice,
  itemKey: string,
  doc: LoroDoc,
  baseFrontier: ItemFrontier,
  writtenText: string,
): Promise<void> {
  assertDeviceDoc(device, doc)
  await serialized(`${device.stateDir}\0${itemKey}`, async () => {
    const receipts = await readReceipts(device.stateDir, itemKey)
    await receipt(device, itemKey, receipts, { base: baseFrontier, text: writtenText, landed: doc, seen: mapTags(doc), span: null })
  })
}

async function captureDrift(doc: LoroDoc, prior: CaptureReceipt, workingText: string, message: string): Promise<Uint8Array | null> {
  const target = doc.fork()
  try {
    target.setPeerId(doc.peerId)
    target.setRecordTimestamp(false)
    const seen = new Set(prior.seen)
    const unseen = new Set([...mapTags(target)].filter((tag) => !seen.has(tag)))
    await applyUserDelta(target, prior.text, workingText, unseen)
    target.commit({ message })
    const from = doc.oplogVersion()
    if (target.oplogVersion().compare(from) === 0) return null
    return target.export({ mode: "update", from })
  } finally {
    target.free()
  }
}

function mapTags(doc: LoroDoc): Set<string> {
  const tags = new Set<string>()
  for (const name of Object.keys(doc.getShallowValue())) {
    if (name === BODY_NAME || !name.startsWith("fm\x1f")) continue
    if (!name.endsWith("\x1freg") && !name.endsWith("\x1fset")) continue
    for (const tag of doc.getMap(name).keys()) tags.add(tag)
  }
  return tags
}

function viewTags(doc: LoroDoc, frontier: ItemFrontier): Set<string> {
  const view = doc.forkAt(frontier)
  try {
    return mapTags(view)
  } finally {
    view.free()
  }
}

interface ReceiptInput {
  readonly base: ItemFrontier
  readonly text: string
  readonly landed: LoroDoc
  readonly seen: ReadonlySet<string>
  readonly span: OpSpan | null
}

function receipt(device: ItemDevice, itemKey: string, receipts: readonly CaptureReceipt[], input: ReceiptInput): Promise<void> {
  const kept = receipts.filter((r) => !sameFrontier(r.base, input.base))
  const at = input.landed.frontiers()
  const next: CaptureReceipt = { base: input.base, text: input.text, at, stamps: stampsOf(input.landed, at), seen: [...input.seen], span: input.span }
  return writeReceipts(device.stateDir, itemKey, [...kept, next])
}

const queues = new Map<string, Promise<unknown>>()

async function serialized<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve()
  const next = previous.then(run, run)
  const settled = next.then(
    () => undefined,
    () => undefined,
  )
  queues.set(key, settled)
  try {
    return await next
  } finally {
    if (queues.get(key) === settled) queues.delete(key)
  }
}
