import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { dirname, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import type { EngineRuntimeFacts } from "../../omo-senpi/src/components/memory/desktop-sync/bootGate"
import { claimsMemorySyncAtBoot } from "../../omo-senpi/src/components/memory/desktop-sync/bootGate"
import { launchClaimsMemorySyncAtBoot } from "../bin/lib/memory-sync-boot.js"

// The boot claim captures the private-descriptor table. Only the engine may do that: `host ensure` and its supervisor
// must forward the descriptor to the next hop untouched, so a wrong yes here would strand the desktop's channel.
const RPC_HOST = ["--extension", "/plugin", "--mode", "rpc", "--multi-session", "--listen", "unix:///tmp/h.sock"]
const DECLARED = { SENPI_PRIVATE_FDS: '{"memory-sync":5}' }
// The runtime senpi's CLI runs in: by default Bun with no exec arguments, which loads the agent in this process.
const BUN: EngineRuntimeFacts = { execArgv: [], versions: { bun: "1.4.4" } }
const WITH_EXEC_ARGS: EngineRuntimeFacts = { execArgv: ["--max-old-space-size=4096"], versions: { bun: "1.4.4" } }
const NODE: EngineRuntimeFacts = { execArgv: [], versions: {} }

const CASES = [
  ["an rpc engine whose table names memory-sync", RPC_HOST, DECLARED, true, BUN],
  ["an rpc engine whose table names memory-sync without a usable descriptor", RPC_HOST, { SENPI_PRIVATE_FDS: '{"memory-sync":null}' }, true, BUN],
  ["a launch without a table", RPC_HOST, {}, false, BUN],
  ["a table without a memory-sync entry", RPC_HOST, { SENPI_PRIVATE_FDS: '{"other":5}' }, false, BUN],
  ["a table that does not parse", RPC_HOST, { SENPI_PRIVATE_FDS: '{"memory-sync":5' }, false, BUN],
  ["a table that is not an object", RPC_HOST, { SENPI_PRIVATE_FDS: '["memory-sync"]' }, false, BUN],
  ["`host ensure`, which hands the descriptor to its supervisor", ["host", "ensure", "--socket", "/tmp/s", "--mode", "rpc"], DECLARED, false, BUN],
  ["the lifecycle supervisor, which hands it to the engine", ["--internal-rpc-host-supervisor", "--socket", "/tmp/s", "--mode", "rpc"], DECLARED, false, BUN],
  ["an interactive launch", ["--extension", "/plugin"], DECLARED, false, BUN],
  ["a json-mode launch", ["--mode", "json", "-p", "hi"], DECLARED, false, BUN],
  ["`--mode rpc` only as message text after --", ["--extension", "/plugin", "--", "--mode", "rpc"], DECLARED, false, BUN],
  ["a one-shot engine command, which omo's own check excludes", ["host", "status", "--mode", "rpc"], DECLARED, false, BUN],
  ["senpi's CLI re-runs itself for exec arguments (requiresIsolatedProcess)", RPC_HOST, DECLARED, false, WITH_EXEC_ARGS],
  ["senpi's CLI re-runs itself for an inherited inspector option", RPC_HOST, { ...DECLARED, NODE_OPTIONS: "--inspect=9229" }, false, BUN],
  ["the isolated child senpi's CLI marked, which loads the agent itself", RPC_HOST, { ...DECLARED, SENPI_CLI_ISOLATED_CHILD: "1" }, true, WITH_EXEC_ARGS],
  ["a Node runtime, which senpi's CLI may re-run under Bun", RPC_HOST, DECLARED, false, NODE],
] as const

describe("launchClaimsMemorySyncAtBoot", () => {
  test.each(CASES)("%s", (_name, args, env, expected, runtime) => {
    expect(launchClaimsMemorySyncAtBoot([...args], env, claimsMemorySyncAtBoot, runtime)).toBe(expected)
  })
})

// The desktop's entry imports the built sidecar, not omo-native: its gate and claim must be the exports omo's own
// entries call, and importing the sidecar must capture nothing (the gate reads the table the capture would remove).
const SIDECAR = resolve(import.meta.dir, "..", "..", "omo-senpi", "plugin", "extensions", "omo-device-account.js")

describe("the built device-account sidecar", () => {
  // A fresh process: this test process may already hold senpi's captured table, which the sidecar's copy would reuse.
  test("exports the boot gate and claim, and importing it leaves the private-descriptor table in the environment", () => {
    const table = '{"memory-sync":5}'
    const probe = `const sidecar = await import(${JSON.stringify(pathToFileURL(SIDECAR).href)})
console.log(JSON.stringify({
  gate: typeof sidecar.claimsMemorySyncAtBoot, gateArity: sidecar.claimsMemorySyncAtBoot.length, claim: typeof sidecar.claimMemorySyncAtBoot, claimArity: sidecar.claimMemorySyncAtBoot.length,
  table: process.env.SENPI_PRIVATE_FDS ?? null, captured: Reflect.has(globalThis, Symbol.for("senpi.private-fds.v3")),
}))`
    const result = spawnSync(process.execPath, ["-e", probe], {
      cwd: dirname(SIDECAR), encoding: "utf8", env: { PATH: process.env.PATH ?? "", SENPI_PRIVATE_FDS: table },
    })
    expect(result.stderr).toBe("")
    expect(JSON.parse(result.stdout)).toEqual({ gate: "function", gateArity: 1, claim: "function", claimArity: 1, table, captured: false })
  })

  test.each(CASES)("answers like omo-native's gate: %s", async (_name, args, env, expected, runtime) => {
    const { claimsMemorySyncAtBoot: built } = await import(pathToFileURL(SIDECAR).href) as { claimsMemorySyncAtBoot: typeof claimsMemorySyncAtBoot }
    expect(launchClaimsMemorySyncAtBoot([...args], env, built, runtime)).toBe(expected)
    expect(built([...args], env, runtime)).toBe(claimsMemorySyncAtBoot([...args], env, runtime))
  })
})
