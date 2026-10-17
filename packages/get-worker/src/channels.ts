import { isQaInstall, recordDownload, requestCountry } from "./datapoint"
import type { RequestContext } from "./env"
import { type Channel, channelPointerKey, isReleaseVersion, releaseVersionOfNpmVersion } from "./release-names"

const POINTER_TTL_SECONDS = 60
const NPM_DIST_TAGS = "https://registry.npmjs.org/-/package/omo-ai/dist-tags"

type Resolved = { readonly version: string; readonly source: "r2" | "npm" }

async function fromR2(ctx: RequestContext, channel: Channel): Promise<string | null> {
  try {
    const object = await ctx.env.RELEASES.get(channelPointerKey(channel))
    if (object === null) return null
    const version = (await object.text()).trim()
    return isReleaseVersion(version) ? version : null
  } catch (error) {
    if (error instanceof Error) return null
    throw error
  }
}

// The R2 pointer only moves after a verified mirror; before the first mirror it is absent, so the
// channel falls back to the npm dist-tag, which carries the same latest/beta meaning.
async function fromNpm(channel: Channel): Promise<string | null> {
  const response = await fetch(NPM_DIST_TAGS, { headers: { Accept: "application/json" } })
  if (!response.ok) return null
  const tags: unknown = await response.json()
  const npmVersion = typeof tags === "object" && tags !== null ? Reflect.get(tags, channel) : undefined
  if (typeof npmVersion !== "string") return null
  const version = releaseVersionOfNpmVersion(npmVersion)
  return isReleaseVersion(version) ? version : null
}

async function resolveChannel(ctx: RequestContext, channel: Channel): Promise<Resolved | null> {
  const mirrored = await fromR2(ctx, channel)
  if (mirrored !== null) return { version: mirrored, source: "r2" }
  const npm = await fromNpm(channel)
  return npm === null ? null : { version: npm, source: "npm" }
}

export async function serveChannel(request: Request, ctx: RequestContext, channel: Channel): Promise<Response> {
  const cacheKey = new Request(`https://get.omo.dev/channels/${channel}`, { method: "GET" })
  const cached = await ctx.cache.match(cacheKey)
  const response =
    cached ??
    (await (async () => {
      const resolved = await resolveChannel(ctx, channel)
      if (resolved === null) {
        return new Response("channel unavailable\n", { status: 503, headers: { "Cache-Control": "no-store" } })
      }
      const fresh = new Response(`${resolved.version}\n`, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": `public, max-age=${POINTER_TTL_SECONDS}`,
          "X-Omo-Source": resolved.source,
        },
      })
      ctx.waitUntil(ctx.cache.put(cacheKey, fresh.clone()))
      return fresh
    })())
  if (request.method === "GET" && response.ok) {
    const version = (await response.clone().text()).trim()
    recordDownload(ctx.env, { kind: "channel", source: "worker", version, asset: channel, country: requestCountry(request), qa: isQaInstall(request) })
  }
  return response
}
