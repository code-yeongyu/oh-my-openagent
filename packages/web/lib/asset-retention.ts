import { createHash } from "node:crypto"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

export const ASSET_HISTORY_PATH = "/__asset-history.json"

type Asset = {
  readonly path: string
  readonly sha256: string
  readonly active: boolean
  readonly retainUntil: number
}

type History = {
  readonly htmlLifetimeSeconds: number
  readonly assets: readonly Asset[]
}

type Options = {
  readonly directory: string
  readonly origin: string
  readonly now: number
  readonly htmlLifetimeSeconds: number
  readonly deploymentOverlapSeconds: number
  readonly bootstrap: {
    readonly paths: readonly string[]
    readonly htmlLifetimeSeconds: number
  }
}

export class AssetRetentionError extends Error {
  override name = "AssetRetentionError"
}

function assetPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\/_next\/static\/[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(value) ||
    value
      .slice(1)
      .split("/")
      .some((part) => part === "." || part === "..")
  ) {
    throw new AssetRetentionError("Invalid static asset path")
  }
  return value
}

function seconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new AssetRetentionError("Invalid HTML lifetime")
  }
  return value
}

function history(value: unknown): History {
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    value.version !== 1 ||
    !("htmlLifetimeSeconds" in value) ||
    !("assets" in value) ||
    !Array.isArray(value.assets)
  ) {
    throw new AssetRetentionError("Invalid asset history")
  }
  const assets = value.assets.map((entry: unknown): Asset => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("path" in entry) ||
      !("sha256" in entry) ||
      typeof entry.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      !("active" in entry) ||
      typeof entry.active !== "boolean" ||
      !("retainUntil" in entry) ||
      typeof entry.retainUntil !== "number" ||
      !Number.isFinite(entry.retainUntil) ||
      entry.retainUntil < 0
    ) {
      throw new AssetRetentionError("Invalid asset history entry")
    }
    return {
      path: assetPath(entry.path),
      sha256: entry.sha256,
      active: entry.active,
      retainUntil: entry.retainUntil,
    }
  })
  if (new Set(assets.map((entry) => entry.path)).size !== assets.length) {
    throw new AssetRetentionError("Duplicate asset history paths")
  }
  return { htmlLifetimeSeconds: seconds(value.htmlLifetimeSeconds), assets }
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

async function request(origin: string, path: string): Promise<Response> {
  const response = await fetch(new URL(path, origin), {
    headers: { "cache-control": "no-cache" },
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  })
  return response
}

async function download(origin: string, path: string): Promise<Uint8Array> {
  const response = await request(origin, path)
  const mime = response.headers.get("content-type")?.split(";")[0]
  if (!response.ok || mime === "text/html" || (path.endsWith(".css") && mime !== "text/css")) {
    throw new AssetRetentionError(`Asset download refused: ${path} (${response.status})`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (!bytes.byteLength) throw new AssetRetentionError(`Empty asset: ${path}`)
  return bytes
}

async function inventory(directory: string, relative = "_next/static"): Promise<readonly Asset[]> {
  const entries = await readdir(join(directory, relative), { withFileTypes: true })
  const result: Asset[] = []
  for (const entry of entries) {
    const path = `${relative}/${entry.name}`
    if (entry.isDirectory()) result.push(...(await inventory(directory, path)))
    else if (entry.isFile()) {
      result.push({
        path: assetPath(`/${path}`),
        sha256: digest(await readFile(join(directory, path))),
        active: true,
        retainUntil: 0,
      })
    } else throw new AssetRetentionError("Static asset inventory contains a special file")
  }
  return result
}

export async function retainStaticAssets(options: Options): Promise<void> {
  seconds(options.htmlLifetimeSeconds)
  seconds(options.deploymentOverlapSeconds)
  const current = new Map((await inventory(options.directory)).map((entry) => [entry.path, entry]))
  const response = await request(options.origin, ASSET_HISTORY_PATH)
  let previous: History
  if (response.status === 404) {
    if (!options.bootstrap.paths.length) {
      throw new AssetRetentionError("Missing history requires explicit legacy bootstrap inventory")
    }
    const assets: Asset[] = []
    for (const input of options.bootstrap.paths) {
      const path = assetPath(input)
      const bytes = await download(options.origin, path)
      assets.push({ path, sha256: digest(bytes), active: true, retainUntil: 0 })
    }
    previous = {
      htmlLifetimeSeconds: seconds(options.bootstrap.htmlLifetimeSeconds),
      assets,
    }
  } else {
    if (!response.ok) throw new AssetRetentionError(`History fetch failed (${response.status})`)
    const value: unknown = await response.json()
    previous = history(value)
  }
  const retirement =
    options.now + (previous.htmlLifetimeSeconds + options.deploymentOverlapSeconds) * 1_000
  for (const entry of previous.assets) {
    const retainUntil = entry.active ? Math.max(entry.retainUntil, retirement) : entry.retainUntil
    const existing = current.get(entry.path)
    if (existing) {
      if (existing.sha256 !== entry.sha256) {
        throw new AssetRetentionError(`Content-addressed asset changed bytes: ${entry.path}`)
      }
      current.set(entry.path, {
        ...existing,
        retainUntil: Math.max(retainUntil, existing.retainUntil),
      })
    } else if (retainUntil > options.now) {
      const bytes = await download(options.origin, entry.path)
      if (digest(bytes) !== entry.sha256) {
        throw new AssetRetentionError(`Asset checksum mismatch: ${entry.path}`)
      }
      const output = join(options.directory, entry.path.slice(1))
      await mkdir(dirname(output), { recursive: true })
      await writeFile(output, bytes)
      current.set(entry.path, { ...entry, active: false, retainUntil })
    }
  }
  await writeFile(
    join(options.directory, ASSET_HISTORY_PATH.slice(1)),
    JSON.stringify({
      version: 1,
      htmlLifetimeSeconds: options.htmlLifetimeSeconds,
      assets: [...current.values()],
    }),
  )
}
