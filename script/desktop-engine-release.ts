import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  DESKTOP_ENGINE_CHECKSUMS_ASSET,
  DESKTOP_ENGINE_RELEASE_HOSTS,
  desktopEngineReleaseAssetName,
} from "../packages/senpi-desktop-engine/src/release-assets"

export function stageDesktopEngineReleaseAsset(
  host: string,
  source: string,
  outDir: string,
  sign?: (filePath: string) => void,
): string {
  const name = desktopEngineReleaseAssetName(host)
  if (name === null) throw new Error(`unsupported desktop engine release host: ${host}`)
  if (!existsSync(source) || !statSync(source).isFile()) {
    throw new Error(`missing desktop engine build for ${host}: ${source}`)
  }
  mkdirSync(outDir, { recursive: true })
  const destination = join(outDir, name)
  copyFileSync(source, destination)
  chmodSync(destination, 0o755)
  if (host.startsWith("darwin-")) {
    if (sign !== undefined) {
      sign(destination)
    } else {
      const signed = spawnSync("codesign", ["-s", "-", destination], { encoding: "utf8" })
      if (signed.error !== undefined) throw signed.error
      if (signed.status !== 0) throw new Error(`codesign failed for ${host}: ${signed.stderr}`)
    }
  }
  return destination
}

/** Fails closed if any of the four promised release assets is missing. */
export function writeDesktopEngineChecksums(outDir: string): string {
  const lines = DESKTOP_ENGINE_RELEASE_HOSTS.map((host) => {
    const name = desktopEngineReleaseAssetName(host)
    if (name === null) throw new Error(`missing asset name for ${host}`)
    const path = join(outDir, name)
    if (!existsSync(path) || !statSync(path).isFile()) {
      throw new Error(`missing required desktop engine release asset: ${name}`)
    }
    const digest = createHash("sha256").update(readFileSync(path)).digest("hex")
    return `${digest}  ${name}`
  })
  const checksums = join(outDir, DESKTOP_ENGINE_CHECKSUMS_ASSET)
  writeFileSync(checksums, `${lines.join("\n")}\n`)
  return checksums
}

if (import.meta.main) {
  const [operation, hostOrDir, source, outDir] = process.argv.slice(2)
  if (operation === "stage" && hostOrDir !== undefined && source !== undefined && outDir !== undefined) {
    console.log(stageDesktopEngineReleaseAsset(hostOrDir, source, outDir))
  } else if (operation === "checksums" && hostOrDir !== undefined) {
    console.log(writeDesktopEngineChecksums(hostOrDir))
  } else {
    console.error("usage: bun script/desktop-engine-release.ts stage <host> <binary> <out-dir> | checksums <out-dir>")
    process.exitCode = 2
  }
}
