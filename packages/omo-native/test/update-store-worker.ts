import { writeFile, readFile } from "node:fs/promises"
import { join } from "node:path"
import { UpdateStore, type Generation } from "../update-store"
import { createHash } from "node:crypto"

const [root, launcher, action, crash] = process.argv.slice(2)
const store = new UpdateStore(root, launcher, {
  checkpoint: async (boundary) => {
    if (boundary !== crash) return
    process.stdout.write(`${boundary}\n`)
    process.kill(process.pid, "SIGKILL")
  },
})
if (action === "launch") {
  const selection = await store.read()
  const lease = await store.lease(selection!.selected!)
  const binary = await readFile(join(lease.directory, "omo"), "utf8")
  const plugin = await readFile(join(lease.directory, "plugin.txt"), "utf8")
  if (binary.replace("payload", "plugin") !== plugin) throw new Error("mixed generation")
  await lease.release()
} else if (action === "gc") {
  await store.transaction(async (tx) => {
    await tx.gc()
  }, { waitTimeoutMs: 5000 })
} else {
  await store.transaction(async (tx) => {
    const generation: Generation = { version: "2.0.0", asset: "omo-linux-x64", digest: createHash("sha256").update("payload 2.0.0").digest("hex"), protocol: action === "bootstrap" ? 2 : 1, backwardCompatible: true }
    const staging = await store.createStaging()
    await writeFile(join(staging, "omo"), "payload 2.0.0")
    await writeFile(join(staging, "plugin.txt"), "plugin 2.0.0")
    await tx.publish(staging, generation)
    if (action === "bootstrap") await tx.maintainBootstrap(async () => {})
    else await tx.select(async () => {})
  }, { waitTimeoutMs: 5000 })
}
