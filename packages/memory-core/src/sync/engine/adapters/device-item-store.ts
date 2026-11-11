// ItemStore over the #10203 item device. One Loro doc per item, created on the device peer; the
// docs (Loro snapshots) and each item's last materialised text with its frontier live in
// `<repo>/.git/omo-sync/crdt/` (sync-design §5: plaintext stays inside the repository's git dir),
// written by temp file + rename. Capture is the device API's captureOnDevice against that
// baseline; a deleted working file captures as the item's tombstone; render is renderForDisk, so
// a file whose model did not change keeps its own frontmatter style byte for byte. The recovery
// operations (revive, rewind, adoptJournaled) live in device-item-recovery.ts over the same state.

import { createHash } from "node:crypto"
import { join } from "node:path"

import { loadLoroRuntime, type LoroDoc } from "../../../crdt/loro-runtime"
import { readdir, readFile } from "../../../fs/resilient"
import {
  captureOnDevice,
  createDeviceItemDoc,
  deleteItem,
  type ItemDevice,
  isLive,
  isSyncItemKey,
  itemFrontier,
  openItemDevice,
  renderForDisk,
  renderItem,
} from "../../item"
import { readJson, writeAtomic, writeJson } from "../atomic"
import type { BatchPayload, ItemStore } from "../ports"
import { type Baseline, createItemRecovery } from "./device-item-recovery"

export interface DeviceItemStoreOptions {
  /** The device's private state dir (peer + receipts), outside the synced memory root. */
  readonly stateDir: string
  readonly memoryRoot: string
  /** `<repo>/.git/omo-sync`: item docs and baselines go under `crdt/`. */
  readonly syncDir: string
  readonly machineId?: string
  readonly log?: (line: string) => void
}

const fileOf = (key: string): string => createHash("sha256").update(key).digest("hex")

// docs.json and baselines.json written by an older build may hold keys the grammar refuses
// (#12147); they are dropped on load and never written back, so no such key reaches a capture.
const syncable = (key: string): boolean => isSyncItemKey(key) === null

export function createDeviceItemStore(options: DeviceItemStoreOptions): ItemStore {
  const crdt = join(options.syncDir, "crdt")
  const docs = new Map<string, LoroDoc>()
  const baselines = new Map<string, Baseline>()
  const dirty = new Set<string>()
  let device: ItemDevice | null = null
  const theDevice = (): ItemDevice => {
    if (device === null) throw new Error("the item store is used before load()")
    return device
  }
  const docOf = async (key: string): Promise<LoroDoc> => {
    const known = docs.get(key)
    if (known !== undefined) return known
    const doc = await createDeviceItemDoc(theDevice())
    docs.set(key, doc)
    return doc
  }
  const recovery = createItemRecovery({
    docs,
    baselines,
    dirty,
    device: theDevice,
    docOf,
    ...(options.log === undefined ? {} : { log: options.log }),
  })
  return {
    async load() {
      device = await openItemDevice({
        stateDir: options.stateDir,
        memoryRoot: options.memoryRoot,
        ...(options.machineId === undefined ? {} : { machineId: options.machineId }),
      })
      const index = await readJson<Record<string, Baseline>>(join(crdt, "baselines.json"), {})
      baselines.clear()
      for (const [key, baseline] of Object.entries(index)) if (syncable(key)) baselines.set(key, baseline)
      // Every persisted doc's key, materialised or not: an item applied from a verified batch has
      // CRDT state before it has a baseline, and a crash in between must not drop that state.
      const docKeys = (await readJson<string[]>(join(crdt, "docs.json"), [])).filter(syncable)
      docs.clear()
      const names = await readdir(join(crdt, "docs")).catch(() => [] as string[])
      const { LoroDoc } = await loadLoroRuntime()
      const byFile = new Map([...new Set([...baselines.keys(), ...docKeys])].map((k) => [fileOf(k), k]))
      for (const name of names) {
        const key = byFile.get(name.replace(/\.loro$/, ""))
        if (key === undefined) continue
        const doc = new LoroDoc()
        doc.setPeerId(theDevice().peer)
        doc.setRecordTimestamp(false)
        doc.import(new Uint8Array(await readFile(join(crdt, "docs", name))))
        docs.set(key, doc)
      }
    },
    peer: () => theDevice().peer,
    keys: () => [...new Set([...docs.keys(), ...baselines.keys()])].sort(),
    async capture(key, workingText) {
      const doc = await docOf(key)
      const base = baselines.get(key) ?? { text: null, frontier: [] }
      if (workingText === base.text) return null
      if (workingText === null) {
        if (!isLive(doc)) return null
        const from = doc.oplogVersion()
        deleteItem(doc)
        dirty.add(key)
        return doc.export({ mode: "update", from })
      }
      if (!isLive(doc) && doc.oplogVersion().toJSON().size > 0) return recovery.revive(key, doc, workingText)
      return captureOnDevice(theDevice(), key, doc, base.text ?? "", base.frontier, workingText)
    },
    async apply(key, ops) {
      const doc = await docOf(key)
      doc.import(ops)
      dirty.add(key)
    },
    render(key, diskText) {
      const doc = docs.get(key)
      if (doc === undefined || !isLive(doc)) return null
      return diskText === null ? renderItem(doc) : renderForDisk(doc, diskText)
    },
    async version(key) {
      const frontier = itemFrontier(await docOf(key))
        .map((id) => `${id.peer}:${id.counter}`)
        .sort()
      return frontier.join(",")
    },
    markMaterialized: recovery.materialize,
    adoptJournaled: recovery.adoptJournaled,
    rewind: recovery.rewind,
    async applySnapshot(payload: BatchPayload) {
      for (const item of payload.items) {
        if (!syncable(item.key)) continue
        const doc = await docOf(item.key)
        doc.import(item.ops)
        dirty.add(item.key)
      }
    },
    async persist() {
      for (const key of dirty) {
        const doc = docs.get(key)
        if (doc !== undefined && syncable(key))
          await writeAtomic(join(crdt, "docs", `${fileOf(key)}.loro`), doc.export({ mode: "snapshot" }))
      }
      dirty.clear()
      await writeJson(join(crdt, "docs.json"), [...docs.keys()].filter(syncable).sort())
      await writeJson(join(crdt, "baselines.json"), Object.fromEntries([...baselines].filter(([key]) => syncable(key))))
    },
  }
}
