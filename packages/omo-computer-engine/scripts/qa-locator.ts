/**
 * QA driver for row 38: stages a real engine binary the way a release ships it (prebuild +
 * checksums file), then launches it through the `launch` factory.
 *
 *   bun packages/omo-computer-engine/scripts/qa-locator.ts --binary target/debug/omo-computer-engine [--tamper]
 *
 * Without --tamper it prints the resolved host, the sha256 it verified, the engine's own
 * `--version` line and LOCATOR_OK. With --tamper one byte of the staged copy is flipped after the
 * checksum was recorded: it prints the refusal and exits 1, and no engine process was spawned.
 */
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { once } from "node:events"
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import {
  createLaunch,
  ENGINE_CHECKSUMS_ASSET,
  EngineLaunchRefused,
  engineHost,
  releaseAssetName,
} from "../src/index.ts"

const args = process.argv.slice(2)
const binaryIndex = args.indexOf("--binary")
const binary = binaryIndex === -1 ? undefined : args[binaryIndex + 1]
if (binary === undefined) {
  console.error("usage: qa-locator.ts --binary <engine> [--tamper]")
  process.exit(2)
}
const tamper = args.includes("--tamper")
const host = engineHost()
const asset = releaseAssetName(host)
if (asset === null) {
  console.error(`no release asset for ${host}`)
  process.exit(2)
}

const root = mkdtempSync(join(tmpdir(), "omo-qa-locator-"))
const prebuilds = join(root, "package", "native", "prebuilds")
const staged = join(prebuilds, host, "omo-computer-engine")
mkdirSync(join(prebuilds, host), { recursive: true })
copyFileSync(resolve(binary), staged)
chmodSync(staged, 0o755)
const shipped = createHash("sha256").update(readFileSync(staged)).digest("hex")
writeFileSync(join(prebuilds, ENGINE_CHECKSUMS_ASSET), `${shipped}  ${asset}\n`)
if (tamper) {
  const bytes = readFileSync(staged)
  const last = bytes.length - 1
  bytes.writeUInt8((bytes.readUInt8(last) ^ 0xff) & 0xff, last)
  writeFileSync(staged, bytes)
}

let spawns = 0
const launch = createLaunch({
  locator: {
    runtimeDir: "",
    execDir: join(root, "bin"),
    packageDir: join(root, "package"),
    repoRoot: join(root, "repo"),
  },
  stableDir: join(root, "stable"),
  spawnEngine: (path, engineArgs) => {
    spawns += 1
    return spawn(path, [...engineArgs], { stdio: ["ignore", "pipe", "pipe"] })
  },
})

try {
  const launched = await launch(["--version"], { env: {} })
  let version = ""
  launched.child.stdout.on("data", (chunk: Buffer) => {
    version += chunk.toString()
  })
  const [code]: unknown[] = await once(launched.child, "close")
  version = version.trim()
  console.log(`host ${launched.host}`)
  console.log(`sha256 ${launched.sha256} (checksums file ${shipped === launched.sha256 ? "matches" : "DIFFERS"})`)
  console.log(`stable path ${launched.path}`)
  console.log(`engine --version: ${version} (exit ${code})`)
  console.log(code === 0 && shipped === launched.sha256 ? "LOCATOR_OK" : "LOCATOR_FAILED")
  process.exitCode = code === 0 && shipped === launched.sha256 ? 0 : 1
} catch (error) {
  if (!(error instanceof EngineLaunchRefused)) throw error
  console.log(`refused ${error.reason} on ${error.host}: ${error.detail}`)
  console.log(`engine processes spawned: ${spawns}`)
  process.exitCode = 1
} finally {
  rmSync(root, { recursive: true, force: true })
}
