import { readFileSync, writeFileSync } from "node:fs"
import { withLock } from "../../../locks/acquire.ts"
import { createLockRecord } from "../../../locks/lock-record.ts"

const path = process.argv[2]
const mode = process.argv[3]
if (path === undefined || mode === undefined) throw new Error("missing writer fixture arguments")
const release = Promise.withResolvers<void>()
process.on("message", (message) => { if (message === "write") release.resolve() })
process.send?.("trying")
await withLock(`${path}.lock`, await createLockRecord("credential-test-writer"), async () => {
  process.send?.("locked")
  await release.promise
  const state = JSON.parse(readFileSync(path, "utf8")) as { identity: string; generation: number; token: number }
  if (mode !== "refresh") {
    writeFileSync(path, JSON.stringify({ ...state, identity: "B", generation: 2 }))
    writeFileSync(path, JSON.stringify({ ...state, identity: mode === "aba" ? "A" : "B", generation: 3 }))
  } else {
    writeFileSync(path, JSON.stringify({ ...state, token: 2 }))
  }
}, { waitTimeoutMs: 10_000 })
process.send?.("written")
process.disconnect?.()
