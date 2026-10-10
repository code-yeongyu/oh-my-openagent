import { serveChannel } from "./channels"
import { serveDownloadStats } from "./download-stats"
import { runDownloadsRollup } from "./downloads-rollup"
import type { Env, RequestContext } from "./env"
import { isChannel } from "./release-names"
import { docsRedirect, isScriptName, scriptForRoot, serveScript } from "./scripts"
import { serveReleaseAsset } from "./serve-release"

const RELEASE_PATH = /^\/v\/([^/]+)\/([^/]+)$/
const CHANNEL_PATH = /^\/channels\/([^/]+)$/

function plain(status: number, body: string): Response {
  return new Response(`${body}\n`, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } })
}

export async function route(request: Request, ctx: RequestContext): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return plain(405, "method not allowed")
  const { pathname } = new URL(request.url)
  if (pathname === "/") {
    const script = scriptForRoot(request)
    return script === null ? docsRedirect() : serveScript(request, ctx, script)
  }
  if (pathname === "/healthz") return plain(200, "ok")
  if (pathname === "/stats/downloads") return serveDownloadStats(ctx)
  const scriptName = pathname.slice(1)
  if (isScriptName(scriptName)) return serveScript(request, ctx, scriptName)
  const channel = CHANNEL_PATH.exec(pathname)?.[1]
  if (channel !== undefined) return isChannel(channel) ? serveChannel(request, ctx, channel) : plain(404, "unknown channel")
  const release = RELEASE_PATH.exec(pathname)
  if (release?.[1] !== undefined && release[2] !== undefined) {
    return serveReleaseAsset(request, ctx, release[1], release[2])
  }
  return plain(404, "not found")
}

export default {
  fetch(request, env, executionContext) {
    return route(request, { env, cache: caches.default, waitUntil: (promise) => executionContext.waitUntil(promise) })
  },
  async scheduled(_controller, env, executionContext) {
    executionContext.waitUntil(runDownloadsRollup(env))
  },
} satisfies ExportedHandler<Env>
