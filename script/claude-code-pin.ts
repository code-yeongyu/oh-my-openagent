// The Claude Code platform package a release target downloads on first use instead of embedding
// it (the executable alone exceeds the binary size budget). The version is the one the engine's
// claude-agent-sdk pins; the integrity is the lockfile's, so the binary accepts exactly the bytes
// the npm install of the same commit would have installed.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { resolvePackageDir } from "./engine-sidecar-sources"

export const CLAUDE_CODE_PIN_REL_PATH = "claude-code-pin.json"

const PLATFORM_PACKAGES: Record<string, string> = {
  "darwin-arm64": "darwin-arm64",
  "darwin-x64": "darwin-x64",
  "linux-x64": "linux-x64",
  "linux-arm64": "linux-arm64",
  "linux-x64-musl": "linux-x64-musl",
  "linux-arm64-musl": "linux-arm64-musl",
  "windows-x64": "win32-x64",
  "windows-arm64": "win32-arm64",
}

export function claudeCodePackageFor(target: string): string | undefined {
  const suffix = PLATFORM_PACKAGES[target.replace(/-baseline$/, "")]
  return suffix === undefined ? undefined : `@anthropic-ai/claude-agent-sdk-${suffix}`
}

export function lockfileIntegrity(lockText: string, name: string, version: string): string | undefined {
  const lock = Bun.JSONC.parse(lockText) as { packages?: Record<string, unknown[]> }
  const entry = lock.packages?.[name]
  if (!Array.isArray(entry) || entry[0] !== `${name}@${version}`) return undefined
  const integrity = entry.at(-1)
  return typeof integrity === "string" && integrity.startsWith("sha512-") ? integrity : undefined
}

export function claudeCodePinFor(target: string, repoRoot: string): string | undefined {
  const name = claudeCodePackageFor(target)
  if (name === undefined) return undefined
  const sdkDir = resolvePackageDir("@anthropic-ai/claude-agent-sdk")
  if (sdkDir === undefined) throw new Error("@anthropic-ai/claude-agent-sdk is not resolvable from the engine")
  const sdk = JSON.parse(readFileSync(join(sdkDir, "package.json"), "utf8")) as { optionalDependencies?: Record<string, string>; claudeCodeVersion?: string }
  const version = sdk.optionalDependencies?.[name]
  if (version === undefined) throw new Error(`the engine's claude-agent-sdk pins no ${name}`)
  const integrity = lockfileIntegrity(readFileSync(join(repoRoot, "bun.lock"), "utf8"), name, version)
  if (integrity === undefined) throw new Error(`bun.lock has no sha512 integrity for ${name}@${version}`)
  return `${JSON.stringify({ name, version, integrity, claudeCodeVersion: sdk.claudeCodeVersion }, null, 2)}\n`
}

