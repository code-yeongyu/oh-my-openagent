import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { isPlainRecord } from "../record-type-guard"
import { CODEGRAPH_PINNED_VERSION } from "./manifest"

interface ProvisionMarker {
  readonly binPath: string
  readonly version: string
}

export interface ResolvePinnedCodegraphBinOptions {
  readonly fileExists?: (filePath: string) => boolean
  readonly platform?: NodeJS.Platform
  readonly readText?: (filePath: string) => string
}

function managedBinPath(installDir: string, platform: NodeJS.Platform): string {
  return join(installDir, "bin", platform === "win32" ? "codegraph.cmd" : "codegraph")
}

export function hasCodegraphManagedInstall(
  installDir: string,
  options: Pick<ResolvePinnedCodegraphBinOptions, "fileExists" | "platform"> = {},
): boolean {
  const fileExists = options.fileExists ?? existsSync
  return fileExists(managedBinPath(installDir, options.platform ?? process.platform))
    || fileExists(join(installDir, ".provisioned"))
}

export function resolvePinnedCodegraphBin(
  installDir: string | undefined,
  options: ResolvePinnedCodegraphBinOptions = {},
): string | null {
  if (installDir === undefined) return null
  const fileExists = options.fileExists ?? existsSync
  const readText = options.readText ?? ((filePath: string) => readFileSync(filePath, "utf8"))
  const expectedBin = managedBinPath(installDir, options.platform ?? process.platform)
  const markerPath = join(
    installDir,
    ".provisioned",
    `codegraph-${CODEGRAPH_PINNED_VERSION}.json`,
  )
  if (!fileExists(expectedBin) || !fileExists(markerPath)) return null

  let markerText: string
  try {
    markerText = readText(markerPath)
  } catch {
    return null
  }
  const marker = parseProvisionMarker(markerText)
  if (marker === null || marker.version !== CODEGRAPH_PINNED_VERSION) return null
  return resolve(marker.binPath) === resolve(expectedBin) ? expectedBin : null
}

function parseProvisionMarker(text: string): ProvisionMarker | null {
  try {
    const value: unknown = JSON.parse(text)
    if (!isPlainRecord(value)) return null
    const binPath = value["binPath"]
    const version = value["version"]
    if (typeof binPath !== "string" || typeof version !== "string") return null
    return { binPath, version }
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}
