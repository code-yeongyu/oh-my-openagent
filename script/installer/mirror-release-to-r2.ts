#!/usr/bin/env bun
// Mirror one published GitHub release into the omo-releases R2 bucket, then move its installer channel.
// Order: download the published bytes -> verify against SHA256SUMS and GitHub digests -> signed upload
// (R2 re-hashes on receipt) -> read every object back and re-hash -> write the .complete marker -> move the
// channel pointer -> prune old betas. Any failure stops before the pointer moves, so installs keep using
// the previous version (the release itself is untouched). --dry-run does the same under a scratch prefix,
// never touches a channel or prunes, and deletes the scratch prefix before exiting.
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseArgs } from "node:util"
import { betasToPrune, MirrorPlanError, parseSha256Sums, planMirrorAssets, shouldMoveChannel, VERSION_PATTERN } from "./mirror-plan"
import { putVerified, type R2Credentials } from "./r2-signed-put"
import { createR2Store, type R2Store } from "./r2-store"

const REPO = "code-yeongyu/oh-my-openagent"
const CHANNELS = new Set(["latest", "beta", "none"])
const UPLOAD_CONCURRENCY = 3
const ATTEMPTS = 3

async function withRetry<T>(what: string, action: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await action()
    } catch (error) {
      if (attempt >= ATTEMPTS || error instanceof MirrorPlanError) throw error
      console.log(`[mirror] ${what} failed (attempt ${attempt}/${ATTEMPTS}): ${String(error).split("\n")[0]}; retrying`)
      await Bun.sleep(attempt * 5_000)
    }
  }
}

// Metadata comes from the REST API (token when present, anonymous when the token is rate limited);
// bytes come from the public release download URLs, which the REST rate limit does not cover.
async function readRelease(tag: string): Promise<{ readonly assets?: unknown }> {
  const url = `https://api.github.com/repos/${REPO}/releases/tags/${tag}`
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN
  const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }
  let response = await fetch(url, { headers: token ? { ...headers, Authorization: `Bearer ${token}` } : headers })
  if (token && (response.status === 403 || response.status === 429)) response = await fetch(url, { headers })
  if (!response.ok) throw new Error(`GitHub release ${tag}: HTTP ${response.status}`)
  return (await response.json()) as { readonly assets?: unknown }
}

async function downloadAsset(tag: string, name: string, path: string): Promise<void> {
  const response = await fetch(`https://github.com/${REPO}/releases/download/${tag}/${name}`)
  if (!response.ok) throw new Error(`download ${name}: HTTP ${response.status}`)
  await Bun.write(path, response)
}

async function inBatches<T>(items: readonly T[], width: number, run: (item: T) => Promise<void>): Promise<void> {
  for (let start = 0; start < items.length; start += width) await Promise.all(items.slice(start, start + width).map(run))
}

const { values } = parseArgs({
  options: {
    tag: { type: "string" },
    channel: { type: "string", default: "none" },
    "dry-run": { type: "boolean", default: false },
    "force-channel": { type: "boolean", default: false },
  },
})

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new MirrorPlanError(`${name} is not set`)
  return value
}

async function sha256File(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256")
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk)
  return hasher.digest("hex")
}

async function sha256Object(store: R2Store, key: string): Promise<{ readonly sha256: string; readonly size: number }> {
  const hasher = new Bun.CryptoHasher("sha256")
  let size = 0
  for await (const chunk of store.stream(key)) {
    hasher.update(chunk)
    size += chunk.byteLength
  }
  return { sha256: hasher.digest("hex"), size }
}

async function main(): Promise<void> {
  const tag = values.tag ?? ""
  const version = tag.replace(/^v/, "")
  const channel = values.channel ?? "none"
  const dryRun = values["dry-run"] === true
  if (!VERSION_PATTERN.test(version)) throw new MirrorPlanError(`--tag must be vX.Y.Z[-pre], got ${tag}`)
  if (!CHANNELS.has(channel)) throw new MirrorPlanError(`--channel must be latest, beta or none, got ${channel}`)

  const credentials: R2Credentials = {
    accountId: required("R2_ACCOUNT_ID"),
    accessKeyId: required("R2_ACCESS_KEY_ID"),
    secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
    bucket: process.env.R2_BUCKET ?? "omo-releases",
  }
  const prefix = dryRun ? `dry-run/${process.env.GITHUB_RUN_ID ?? Date.now()}/` : ""
  const store = createR2Store(credentials, prefix)
  const live = createR2Store(credentials, "")
  const work = await mkdtemp(join(tmpdir(), "omo-r2-mirror-"))
  const log = (line: string) => console.log(`[mirror ${tag}${dryRun ? " dry-run" : ""}] ${line}`)
  try {
    const release = await withRetry(`read release ${tag}`, () => readRelease(tag))
    const assets = (Array.isArray(release.assets) ? release.assets : []).map((asset: Record<string, unknown>) => ({
      name: String(asset.name),
      size: Number(asset.size),
      digest: typeof asset.digest === "string" ? asset.digest : null,
    }))
    await withRetry("download SHA256SUMS", () => downloadAsset(tag, "SHA256SUMS", join(work, "SHA256SUMS")))
    const plan = planMirrorAssets(assets, parseSha256Sums(await Bun.file(join(work, "SHA256SUMS")).text()))
    await inBatches(plan, UPLOAD_CONCURRENCY, (asset) => withRetry(`download ${asset.name}`, () => downloadAsset(tag, asset.name, join(work, asset.name))))
    log(`plan: ${plan.length} assets, ${(plan.reduce((sum, asset) => sum + asset.size, 0) / 1e9).toFixed(2)} GB`)
    for (const asset of plan) {
      const local = await sha256File(join(work, asset.name))
      if (local !== asset.sha256) throw new MirrorPlanError(`${asset.name}: downloaded sha256 ${local} != published ${asset.sha256}`)
    }
    log(`verified all ${plan.length} downloads against SHA256SUMS and the GitHub digests`)

    await inBatches(plan, UPLOAD_CONCURRENCY, async (asset) => {
      const key = `releases/v${version}/${asset.name}`
      if (await store.exists(key)) {
        const stored = await sha256Object(store, key)
        if (stored.sha256 !== asset.sha256) throw new MirrorPlanError(`${key} already holds different bytes (${stored.sha256}); refusing to overwrite an immutable object`)
        log(`kept ${asset.name} (already mirrored, sha256 matches)`)
        return
      }
      await withRetry(`upload ${asset.name}`, () =>
        putVerified(credentials, `${prefix}${key}`, Bun.file(join(work, asset.name)), asset.sha256, {
          "cache-control": "public, max-age=31536000, immutable",
          "content-type": "application/octet-stream",
          "x-amz-meta-sha256": asset.sha256,
        }),
      )
      log(`uploaded ${asset.name} (${asset.size} B)`)
    })

    for (const asset of plan) {
      const stored = await sha256Object(store, `releases/v${version}/${asset.name}`)
      if (stored.sha256 !== asset.sha256 || stored.size !== asset.size) {
        throw new MirrorPlanError(`read-back mismatch for ${asset.name}: ${stored.sha256}/${stored.size}`)
      }
    }
    log(`read back and re-hashed all ${plan.length} objects from R2`)

    const marker = JSON.stringify({ version, assets: Object.fromEntries(plan.map((a) => [a.name, a.sha256])), mirroredAt: new Date().toISOString(), run: process.env.GITHUB_RUN_ID ?? null })
    await store.write(`releases/v${version}/.complete`, marker, "application/json")
    log("wrote completion marker")

    if (channel !== "none") {
      const pointerKey = `channels/${channel}`
      const current = (await live.readText(pointerKey))?.trim() ?? null
      if (dryRun) log(`dry run: would move ${pointerKey} from ${current ?? "(unset)"} to ${version}`)
      else if (shouldMoveChannel(current, version, values["force-channel"] === true)) {
        await live.write(pointerKey, `${version}\n`, "text/plain")
        log(`moved ${pointerKey}: ${current ?? "(unset)"} -> ${version}`)
      } else log(`kept ${pointerKey} at ${current}; ${version} is older`)
    }

    if (!dryRun) {
      const versions = await live.listReleaseVersions()
      const pinned = new Set<string>([version])
      for (const name of ["latest", "beta"]) {
        const pointed = (await live.readText(`channels/${name}`))?.trim()
        if (pointed) pinned.add(pointed)
      }
      for (const old of betasToPrune(versions, pinned)) {
        await live.deletePrefix(`releases/v${old}/`)
        log(`pruned beta ${old}`)
      }
    }
    log("done")
  } finally {
    await rm(work, { recursive: true, force: true })
    if (dryRun) {
      await store.deletePrefix("")
      const left = await store.countObjects("")
      log(`dry run cleanup: removed scratch prefix ${prefix} (${left} objects left)`)
      if (left !== 0) process.exitCode = 1
    }
  }
}

await main()
