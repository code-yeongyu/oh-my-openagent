import { caseFold, loadLoroRuntime } from "@oh-my-opencode/memory-core/sync-engine"

export {
  deviceKeyringFromMaterial,
  GitSpaceConfig,
  isDeviceSyncOff,
  listRemotes,
  loadTrustAnchor,
  openAccountSession,
  openDeviceSync,
  repoHasCommit,
  resolveSpace,
} from "@oh-my-opencode/memory-core/sync-engine"
export {
  acknowledgePhraseVoid,
  disableSync,
  enableSync,
  joinAccount,
  approveDevice,
  phraseNoticeStatus,
  readServiceFloor,
  verifiedPhraseNoticeStatus,
} from "@oh-my-opencode/memory-core/sync-engine"
// A freeze status exists only while the engine runs, so its words ship with the engine, not the eager bundle.
export { causeNote, failureRpcSync, freezeFailure } from "./sync-status-copy"

/** Proves the packaged sidecar's file assets load: the Loro wasm and the case-fold table beside it. */
export async function checkSyncRuntime(): Promise<void> {
  const { LoroDoc } = await loadLoroRuntime()
  const doc = new LoroDoc()
  try {
    doc.getText("t").insert(0, "hi")
    doc.commit()
  } finally {
    doc.free()
  }
  if (caseFold("Straße") !== "strasse") throw new Error("memory sync: the case-fold table did not load")
}
