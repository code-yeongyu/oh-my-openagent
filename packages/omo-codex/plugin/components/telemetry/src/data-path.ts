import { accessSync, constants, mkdirSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import { CACHE_DIR_NAME } from "./product-identity.js"

type OsProvider = Pick<typeof os, "homedir" | "tmpdir">

let osProviderOverride: OsProvider | null = null

export function getOsProvider(): OsProvider {
  return osProviderOverride ?? os
}

/** @internal test-only */
export function __setOsProviderForTesting(provider: OsProvider): void {
  osProviderOverride = provider
}

/** @internal test-only */
export function __resetOsProviderForTesting(): void {
  osProviderOverride = null
}

function resolveWritableDirectory(preferredDir: string, fallbackSuffix: string): string {
  try {
    mkdirSync(preferredDir, { recursive: true })
    accessSync(preferredDir, constants.W_OK)
    return preferredDir
  } catch {
    const fallbackDir = path.join(getOsProvider().tmpdir(), fallbackSuffix)
    mkdirSync(fallbackDir, { recursive: true })
    return fallbackDir
  }
}

export function getDataDir(): string {
  const preferredDataDir =
    process.env["XDG_DATA_HOME"] ?? path.join(getOsProvider().homedir(), ".local", "share")
  return resolveWritableDirectory(preferredDataDir, "omo-codex-data")
}

export function getActivityStateDir(): string {
  return path.join(getDataDir(), CACHE_DIR_NAME)
}
