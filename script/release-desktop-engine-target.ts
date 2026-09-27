import { chmodSync, copyFileSync, mkdirSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { z } from "zod"
import { desktopEngineReleaseAssetName } from "../packages/senpi-desktop-engine/src/release-assets"
import fixture from "./release-desktop-engine-fixture.json"

const TARGETS = [
  "darwin-arm64", "darwin-x64", "darwin-x64-baseline",
  "linux-x64", "linux-x64-baseline", "linux-arm64",
  "linux-x64-musl", "linux-x64-musl-baseline", "linux-arm64-musl",
  "windows-x64", "windows-x64-baseline", "windows-arm64",
] as const

const HOST_TARGETS = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-x64": "x86_64-unknown-linux-gnu",
  "win32-x64": "x86_64-pc-windows-msvc",
} as const
const hostSchema = z.enum(["darwin-arm64", "darwin-x64", "linux-x64", "win32-x64"])

const fixtureSchema = z.object({
  targets: z.record(z.string(), z.object({
    available: z.boolean(),
    host: z.string().nullable(),
  })),
})

export type DesktopEngineTarget = {
  readonly target: string
  readonly available: boolean
  readonly host: string | null
  readonly asset: string | null
  readonly source: string | null
  readonly payload: string | null
}

export function loadDesktopEngineTargets(input: unknown): readonly DesktopEngineTarget[] {
  const entries = fixtureSchema.parse(input).targets
  const unexpected = Object.keys(entries).filter((target) => !TARGETS.some((expected) => expected === target))
  if (unexpected.length > 0) throw new Error(`unexpected desktop engine target: ${unexpected.join(", ")}`)
  return TARGETS.map((target) => {
    const entry = entries[target]
    if (entry === undefined) throw new Error(`missing desktop engine target: ${target}`)
    if (!entry.available) {
      if (entry.host !== null) throw new Error(`unavailable desktop engine ${target} has a host`)
      return { target, available: false, host: null, asset: null, source: null, payload: null }
    }
    const host = entry.host
    if (host === null || !(host in HOST_TARGETS)) {
      throw new Error(`available desktop engine ${target} has no supported host`)
    }
    const expectedHost = target.startsWith("windows-") ? "win32-x64" : target.replace(/-baseline$/, "")
    if (host !== expectedHost) throw new Error(`desktop engine ${target} cannot use ${host}; expected ${expectedHost}`)
    const asset = desktopEngineReleaseAssetName(host)
    if (asset === null) throw new Error(`missing desktop engine release asset for ${host}`)
    const rustTarget = HOST_TARGETS[hostSchema.parse(host)]
    const binary = host.startsWith("win32-") ? "senpi-desktop-engine.exe" : "senpi-desktop-engine"
    return {
      target, available: true, host, asset,
      source: `target/${rustTarget}/release/${binary}`,
      payload: `native/prebuilds/${host}/${binary}`,
    }
  })
}

export const DESKTOP_ENGINE_TARGETS = loadDesktopEngineTargets(fixture)

export function desktopEngineTarget(target: string): DesktopEngineTarget {
  const entry = DESKTOP_ENGINE_TARGETS.find((candidate) => candidate.target === target)
  if (entry === undefined) throw new Error(`unknown desktop engine target: ${target}`)
  return entry
}

/** Only the exact Rust target output is eligible; no host release fallback. */
export function stageCompiledDesktopEngine(
  target: string,
  stageDir: string,
  sourceRoot: string = resolve(dirname(import.meta.dir)),
): string | null {
  const entry = desktopEngineTarget(target)
  if (entry.source === null || entry.payload === null) return null
  const source = join(sourceRoot, entry.source)
  let stats
  try {
    stats = statSync(source)
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(`missing required desktop engine for ${target}: ${source}`)
    }
    throw error
  }
  if (!stats.isFile()) throw new Error(`missing required desktop engine for ${target}: ${source}`)
  const destination = join(stageDir, entry.payload)
  mkdirSync(dirname(destination), { recursive: true })
  copyFileSync(source, destination)
  chmodSync(destination, 0o755)
  return entry.payload
}

if (import.meta.main) {
  const [flag, target, extra] = process.argv.slice(2)
  if (flag !== "--target" || target === undefined || extra !== undefined) {
    console.error("usage: bun script/release-desktop-engine-target.ts --target <platform>")
    process.exitCode = 2
  } else {
    try {
      console.log(JSON.stringify(desktopEngineTarget(target)))
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    }
  }
}
