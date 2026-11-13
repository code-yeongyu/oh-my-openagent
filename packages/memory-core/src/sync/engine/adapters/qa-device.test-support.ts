// One device for the two-process QA: a real process running the production engine
// (openDeviceSync: git SyncRepo, Loro item store, HTTP transport) against the wire server in
// another process. The crypto is the deterministic fake (todo 13 brings the real verifier).
//
//   bun qa-device.test-support.ts <server-url> <device> <base-dir> write <key> <text>
//   bun qa-device.test-support.ts <server-url> <device> <base-dir> cycle
//   bun qa-device.test-support.ts <server-url> <device> <base-dir> crash-after-upload <key> <text>
//   bun qa-device.test-support.ts <server-url> <device> <base-dir> read <key>
//
// Each command prints one JSON line. `crash-after-upload` writes, then exits the process with
// SIGKILL at the journal's `uploaded` marker: the object is on the server, the append is not.

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

import { ensureQaRepo } from "./qa-repo.test-support"
import { FakeSealer, FakeVerifier } from "../fake-crypto.test-support"
import { openDeviceSync } from "../open"
import { createHttpTransport } from "./http-transport"

const [url, device, base, command, key, text] = process.argv.slice(2)
if (url === undefined || device === undefined || base === undefined || command === undefined) {
  throw new Error("usage: qa-device.test-support.ts <url> <device> <base> <command> [key] [text]")
}
const repoDir = join(base, "repo")

await ensureQaRepo(repoDir)
if (command === "read") {
  const value = await readFile(join(repoDir, key ?? ""), "utf8").catch(() => null)
  console.log(JSON.stringify({ device, key, value }))
  process.exit(0)
}
const sync = await openDeviceSync({
  repoDir,
  stateDir: join(base, "state"),
  locksDir: join(base, "locks"),
  machineId: `qa-${device}`,
  session: {
    transport: createHttpTransport({ baseUrl: url, token: () => `qa.${device}` }),
    verifier: new FakeVerifier("qa-account"),
    sealer: new FakeSealer("qa-account"),
  },
})
if (sync === null) throw new Error("another process holds this device's sync lease")
if (command === "write" || command === "crash-after-upload") {
  const path = join(repoDir, key ?? "")
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text ?? "")
}
if (command === "crash-after-upload") {
  const engine = sync.engine as unknown as { deps: { fault?: (at: string) => void } }
  engine.deps.fault = (at) => {
    if (at === "uploaded") process.kill(process.pid, "SIGKILL")
  }
}
const report = await sync.engine.runCycle()
console.log(JSON.stringify({ device, report, status: await sync.status(), pid: process.pid }))
await sync.close()
process.exit(0)
