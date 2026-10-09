import { AssetRetentionError } from "./asset-retention.ts"

export async function liveAssetInventory(origin) {
  const base = new URL(origin)
  const paths = new Set()
  const documents = new Set(["/"])
  let htmlLifetimeSeconds = 0
  async function get(path, document = false) {
    let url = new URL(path, base)
    for (let hop = 0; hop < 5; hop++) {
      const response = await fetch(url, {
        headers: { "cache-control": "no-cache" },
        redirect: "manual",
        signal: AbortSignal.timeout(30000),
      })
      if (document && [301, 302, 307, 308].includes(response.status)) {
        const target = response.headers.get("location")
        if (!target) throw new AssetRetentionError("Document redirect has no target")
        url = new URL(target, url)
        if (url.origin !== base.origin)
          throw new AssetRetentionError("Document redirects outside origin")
        continue
      }
      if (!response.ok) throw new AssetRetentionError(`Live inventory fetch failed: ${path}`)
      return response
    }
    throw new AssetRetentionError("Document redirect loop")
  }
  function resource(value, parent) {
    if (value.startsWith("static/")) value = `/_next/${value}`
    const url = new URL(value, new URL(parent, base))
    if (url.origin === base.origin && url.pathname.startsWith("/_next/static/")) {
      paths.add(url.pathname)
    }
  }
  const sitemap = await (await get("/sitemap.xml")).text()
  for (const match of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const url = new URL(match[1])
    documents.add(url.pathname)
  }
  for (const path of documents) {
    const response = await get(path, true)
    if (!response.headers.get("content-type")?.startsWith("text/html")) {
      throw new AssetRetentionError("Sitemap inventory contains a non-HTML document")
    }
    const control = response.headers.get("cache-control") ?? ""
    const maxAge =
      control.match(/(?:^|,)\s*s-maxage=(\d+)/)?.[1] ??
      control.match(/(?:^|,)\s*max-age=(\d+)/)?.[1]
    const stale = control.match(/(?:^|,)\s*stale-while-revalidate=(\d+)/)?.[1] ?? "0"
    if (!maxAge) throw new AssetRetentionError("Live document has no measured cache lifetime")
    htmlLifetimeSeconds = Math.max(htmlLifetimeSeconds, Number(maxAge) + Number(stale))
    let advertisedHistory = false
    const reader = new HTMLRewriter()
      .on("html", {
        element(e) {
          advertisedHistory ||= e.hasAttribute("data-dpl-id")
        },
      })
      .on("link[href]", {
        element(e) {
          resource(e.getAttribute("href"), path)
        },
      })
      .on("script[src]", {
        element(e) {
          resource(e.getAttribute("src"), path)
        },
      })
    await reader.transform(response).text()
    if (advertisedHistory) {
      throw new AssetRetentionError("Deployment identified itself but its asset history is missing")
    }
  }
  for (const path of paths) {
    const response = await get(path)
    const mime = response.headers.get("content-type")?.split(";")[0]
    if (mime === "text/html" || (path.endsWith(".css") && mime !== "text/css")) {
      throw new AssetRetentionError(`Live static resource has incorrect MIME: ${path}`)
    }
    if (!/\.(?:css|js)$/.test(path)) continue
    const text = await response.text()
    for (const match of text.matchAll(
      /["']([^"'\s]+\.(?:js|css|woff2?|png|svg|jpe?g|webp|avif|gif)(?:\?[^"'\s]*)?)["']/g,
    )) {
      if (path.endsWith(".js") && !/^(?:\/_next\/static\/|static\/|\.{1,2}\/)/.test(match[1]))
        continue
      resource(match[1], path)
    }
    if (path.endsWith(".css")) {
      for (const match of text.matchAll(/url\(\s*(?:["']([^"']+)["']|([^"'()\s][^()\s]*))\s*\)/g))
        resource(match[1] ?? match[2], path)
    }
  }
  if (!paths.size || htmlLifetimeSeconds <= 0) {
    throw new AssetRetentionError(
      "Current live inventory is empty or has no bounded cache lifetime",
    )
  }
  return { paths: [...paths], htmlLifetimeSeconds }
}
