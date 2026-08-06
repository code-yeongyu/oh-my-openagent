import { homedir } from "node:os"
import { join, resolve } from "node:path"

export function resolveCodexInstallerBinDir(input: {
  readonly binDir?: string
  readonly codexHome: string
  readonly env?: { readonly [key: string]: string | undefined }
  readonly homeDir?: string
}): string {
  const explicitBinDir = input.binDir ?? input.env?.CODEX_LOCAL_BIN_DIR
  if (explicitBinDir !== undefined && explicitBinDir.trim().length > 0) return resolve(explicitBinDir.trim())

  const homeDir = input.homeDir ?? homedir()
  const defaultCodexHome = resolve(homeDir, ".codex")
  const resolvedCodexHome = resolve(input.codexHome)
  if (resolvedCodexHome !== defaultCodexHome) return join(resolvedCodexHome, "bin")
  return resolve(homeDir, ".local", "bin")
}
