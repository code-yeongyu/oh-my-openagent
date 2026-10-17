import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { materializeProvisionedExecutable, runningExecutablePath } from "../../../compile-runtime"
import { handOffToProvisionedRuntime, planProvisionedLaunch } from "../../../provisioned-handoff"

// Compiled by provisioned-handoff.test.ts. It runs compile-entry.ts main()'s launch sequence with a
// stand-in payload, then reads package.json beside process.execPath the way the engine's pi-pty
// loader does (#7485).
const runningExecutable = runningExecutablePath()
const expected = join(homedir(), ".omo", "binary-runtime", "handoff-fixture", process.platform === "win32" ? "omo.exe" : "omo")
const launch = planProvisionedLaunch(runningExecutable, expected)
if (launch.provision) {
  mkdirSync(dirname(expected), { recursive: true })
  writeFileSync(join(dirname(expected), "package.json"), JSON.stringify({ version: "0.0.0-handoff-fixture" }))
  materializeProvisionedExecutable(runningExecutable, expected)
}
if (launch.handOff) {
  await handOffToProvisionedRuntime(expected)
} else {
  const { version } = JSON.parse(readFileSync(join(dirname(process.execPath), "package.json"), "utf8")) as { version: string }
  console.log(JSON.stringify({ version, execPath: process.execPath, args: process.argv.slice(2), launch }))
  process.exitCode = Number(process.argv[2] ?? 0)
}
