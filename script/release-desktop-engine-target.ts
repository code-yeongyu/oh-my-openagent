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
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "win32-x64": "x86_64-pc-windows-msvc",
  "win32-arm64": "aarch64-pc-windows-msvc",
} as const
const hostSchema = z.enum(["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "win32-x64", "win32-arm64"])

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
    const expectedHost = target.replace(/^windows-/, "win32-").replace(/-baseline$/, "")
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

/** The Rust target triple the release workflows build a desktop engine host with. */
export function desktopEngineRustTarget(host: string): string {
  return HOST_TARGETS[hostSchema.parse(host)]
}

export function desktopEngineTarget(target: string): DesktopEngineTarget {
  const entry = DESKTOP_ENGINE_TARGETS.find((candidate) => candidate.target === target)
  if (entry === undefined) throw new Error(`unknown desktop engine target: ${target}`)
  return entry
}

const ENGINE_TRUST_HELPER = "omo-engine-trust-helper"

export type EngineTrustHelperTarget = {
  readonly target: string
  readonly available: boolean
  readonly host: string | null
  /** Path inside the downloaded desktop-engine-<host> artifact. */
  readonly asset: string | null
  readonly source: string | null
  readonly payload: string | null
}

/**
 * The engine CA importer's fact helper (omo#10762) ships beside the desktop engine on the Darwin and Windows
 * hosts; Linux reads its trust store from files and ships none. Baseline targets reuse their x64 host build.
 */
export function engineTrustHelperTarget(target: string): EngineTrustHelperTarget {
  const { host } = desktopEngineTarget(target)
  if (host === null || !(host.startsWith("darwin-") || host.startsWith("win32-"))) {
    return { target, available: false, host: null, asset: null, source: null, payload: null }
  }
  const binary = host.startsWith("win32-") ? `${ENGINE_TRUST_HELPER}.exe` : ENGINE_TRUST_HELPER
  return {
    target, available: true, host,
    asset: `engine-trust-helper-${host}/${binary}`,
    source: `target/${desktopEngineRustTarget(host)}/release/${binary}`,
    payload: `native/prebuilds/${host}/${binary}`,
  }
}

function stageCompiledExecutable(
  what: string,
  target: string,
  entry: { readonly source: string | null; readonly payload: string | null },
  stageDir: string,
  sourceRoot: string,
): string | null {
  if (entry.source === null || entry.payload === null) return null
  const source = join(sourceRoot, entry.source)
  let stats
  try {
    stats = statSync(source)
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(`missing required ${what} for ${target}: ${source}`)
    }
    throw error
  }
  if (!stats.isFile()) throw new Error(`missing required ${what} for ${target}: ${source}`)
  const destination = join(stageDir, entry.payload)
  mkdirSync(dirname(destination), { recursive: true })
  copyFileSync(source, destination)
  chmodSync(destination, 0o755)
  return entry.payload
}

/** Only the exact Rust target output is eligible; no host release fallback. */
export function stageCompiledDesktopEngine(
  target: string,
  stageDir: string,
  sourceRoot: string = resolve(dirname(import.meta.dir)),
): string | null {
  return stageCompiledExecutable("desktop engine", target, desktopEngineTarget(target), stageDir, sourceRoot)
}

/** Same contract as the engine: an available target without its exact Rust output fails closed. */
export function stageCompiledEngineTrustHelper(
  target: string,
  stageDir: string,
  sourceRoot: string = resolve(dirname(import.meta.dir)),
): string | null {
  return stageCompiledExecutable("engine trust helper", target, engineTrustHelperTarget(target), stageDir, sourceRoot)
}

if (import.meta.main) {
  const [flag, target, extra] = process.argv.slice(2)
  if ((flag !== "--target" && flag !== "--trust-helper-target") || target === undefined || extra !== undefined) {
    console.error("usage: bun script/release-desktop-engine-target.ts --target <platform> | --trust-helper-target <platform>")
    process.exitCode = 2
  } else {
    try {
      console.log(JSON.stringify(flag === "--target" ? desktopEngineTarget(target) : engineTrustHelperTarget(target)))
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    }
  }
}
