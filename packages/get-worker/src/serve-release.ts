import { isQaInstall, recordDownload, requestCountry } from "./datapoint"
import type { RequestContext } from "./env"
import {
  assetKind,
  completionMarkerKey,
  githubAssetUrl,
  isReleaseVersion,
  releaseObjectKey,
} from "./release-names"

export const IMMUTABLE = "public, max-age=31536000, immutable"

function notFound(message: string): Response {
  return new Response(`${message}\n`, { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } })
}

function githubRedirect(version: string, asset: string, reason: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: githubAssetUrl(version, asset),
      "Cache-Control": "no-store",
      "X-Omo-Source": "github",
      "X-Omo-Fallback-Reason": reason,
    },
  })
}

function objectResponse(object: R2ObjectBody, asset: string, source: "r2" | "cache"): Response {
  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set("ETag", object.httpEtag)
  headers.set("Content-Length", String(object.size))
  headers.set("Content-Type", "application/octet-stream")
  headers.set("Content-Disposition", `attachment; filename="${asset}"`)
  headers.set("Cache-Control", IMMUTABLE)
  headers.set("X-Omo-Source", source)
  return new Response(object.body, { headers })
}

type R2Outcome = { readonly kind: "served"; readonly response: Response } | { readonly kind: "fallback"; readonly reason: string }

async function readFromR2(ctx: RequestContext, version: string, asset: string): Promise<R2Outcome> {
  try {
    const marker = await ctx.env.RELEASES.head(completionMarkerKey(version))
    if (marker === null) return { kind: "fallback", reason: "version-not-mirrored" }
    const object = await ctx.env.RELEASES.get(releaseObjectKey(version, asset))
    if (object === null) return { kind: "fallback", reason: "object-missing" }
    return { kind: "served", response: objectResponse(object, asset, "r2") }
  } catch (error) {
    if (error instanceof Error) return { kind: "fallback", reason: "r2-error" }
    throw error
  }
}

export async function serveReleaseAsset(
  request: Request,
  ctx: RequestContext,
  version: string,
  asset: string,
): Promise<Response> {
  const kind = assetKind(asset)
  if (!isReleaseVersion(version) || kind === null) return notFound("unknown release asset")
  const isGet = request.method === "GET"
  const record = (source: "r2" | "cache" | "github") => {
    if (!isGet) return
    recordDownload(ctx.env, { kind, source, version, asset, country: requestCountry(request), qa: isQaInstall(request) })
  }

  const cacheKey = new Request(`https://get.omo.dev/v/${version}/${asset}`, { method: "GET" })
  const ranged = request.headers.has("Range")
  const cached = await ctx.cache.match(ranged ? new Request(cacheKey, { headers: request.headers }) : cacheKey)
  if (cached !== undefined) {
    record("cache")
    const headers = new Headers(cached.headers)
    headers.set("X-Omo-Source", "cache")
    return new Response(isGet ? cached.body : null, { status: cached.status, headers })
  }

  const outcome = await readFromR2(ctx, version, asset)
  if (outcome.kind === "fallback") {
    record("github")
    return githubRedirect(version, asset, outcome.reason)
  }
  record("r2")
  if (!isGet) return new Response(null, { headers: outcome.response.headers })
  if (!ranged) ctx.waitUntil(ctx.cache.put(cacheKey, outcome.response.clone()))
  return outcome.response
}
