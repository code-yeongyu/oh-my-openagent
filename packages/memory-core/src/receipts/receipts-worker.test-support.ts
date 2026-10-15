import { appendMemoryReceipt, appendMemoryReceiptOnce } from "./index"

const [runtimeDir, mode, countText, runId] = process.argv.slice(2)
if (runtimeDir === undefined || (mode !== "append" && mode !== "once") || countText === undefined || runId === undefined) {
  throw new Error("usage: receipts-worker <runtimeDir> <append|once> <count> <runId>")
}
const appends: Promise<unknown>[] = []
for (let index = 0; index < Number(countText); index++) {
  const pending = mode === "append"
    ? appendMemoryReceipt(runtimeDir, { kind: "dream", runId: `${runId}-${process.pid}-${index}`, trigger: "idle", event: "launched", generation: "g1" })
    : appendMemoryReceiptOnce(runtimeDir, { kind: "dream", runId, trigger: "idle", event: "merged", generation: "g1" })
  // One append writer per Windows child; keep the deduplication race and other platforms unchanged.
  if (process.platform === "win32" && mode === "append") await pending
  else appends.push(pending)
}
await Promise.all(appends)
