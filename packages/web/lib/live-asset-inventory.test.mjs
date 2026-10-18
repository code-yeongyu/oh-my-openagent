import { expect, test } from "bun:test"
import { liveAssetInventory } from "./live-asset-inventory.mjs"

async function live({ advertised = false, broken = false } = {}, verify) {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname
      if (path === "/en") return Response.redirect(new URL("/", server.url), 307)
      if (path === "/sitemap.xml")
        return new Response(
          `<urlset><url><loc>https://omo.dev/ko/manifesto</loc></url><url><loc>https://omo.dev/en</loc></url></urlset>`,
        )
      if (path === "/" || path === "/ko/manifesto")
        return new Response(
          `<html${advertised ? ' data-dpl-id="new"' : ""}><link href="/_next/static/chunks/a.css?dpl=old"><script src="/_next/static/chunks/a.js"></script></html>`,
          {
            headers: {
              "content-type": "text/html",
              "cache-control": "s-maxage=3600, stale-while-revalidate=3600",
            },
          },
        )
      if (path.endsWith("a.css"))
        return new Response(
          'body{src:url(../media/font.woff2);background:url("../media/background.avif")}',
          {
            headers: { "content-type": "text/css" },
          },
        )
      if (path.endsWith("a.js"))
        return new Response('"static/chunks/lazy.js"; "not-an-asset.js"', {
          headers: { "content-type": "application/javascript" },
        })
      if (broken) return new Response("unavailable", { status: 503 })
      return new Response("font-or-lazy-code")
    },
  })
  try {
    await verify(server.url.origin)
  } finally {
    server.stop(true)
  }
}

test("bootstrap follows current document CSS, fonts and lazy chunks rather than only one stylesheet", async () => {
  // Given: bilingual live documents share CSS and refer to a lazy bundle and a font.
  await live({}, async (origin) => {
    // When: the migration gathers the live resource graph.
    const inventory = await liveAssetInventory(origin)
    // Then: every needed resource is usable from that inventory, including transitive assets.
    const responses = await Promise.all(inventory.paths.map((path) => fetch(new URL(path, origin))))
    expect(responses.every((response) => response.ok)).toBe(true)
    expect(inventory.paths.some((path) => path.endsWith("font.woff2"))).toBe(true)
    expect(inventory.paths.some((path) => path.endsWith("lazy.js"))).toBe(true)
    expect(inventory.paths.some((path) => path.endsWith("background.avif"))).toBe(true)
  })
})

test("an advertised deployment cannot be mistaken for a new first migration after history loss", async () => {
  // Given: history lookup failed but the live HTML identifies a newer deployment.
  await live({ advertised: true }, async (origin) => {
    // When: bootstrap tries to reset its inventory.
    // Then: it blocks instead of discarding the predecessor's lifetime.
    await expect(liveAssetInventory(origin)).rejects.toThrow()
  })
})

test("an unavailable transitive asset blocks migration rather than publishing an incomplete graph", async () => {
  // Given: a font/lazy bundle is referenced but no longer downloadable.
  await live({ broken: true }, async (origin) => {
    // When: collection reaches that resource.
    // Then: deployment fails before publishing an incomplete inventory.
    await expect(liveAssetInventory(origin)).rejects.toThrow()
  })
})

test("an operator reason waives only the identified-deployment refusal: the inventory is still built and verified", async () => {
  // Given: the live deployment was made outside the retention pipeline (no history) and identifies itself.
  await live({ advertised: true }, async (origin) => {
    // When: an operator acknowledges the missing history with a reason.
    const inventory = await liveAssetInventory(origin, {
      acceptMissingHistory: "first deploy after the account move",
    })
    // Then: the full graph is collected and every recorded asset downloads.
    const responses = await Promise.all(inventory.paths.map((path) => fetch(new URL(path, origin))))
    expect(responses.every((response) => response.ok)).toBe(true)
    expect(inventory.paths.some((path) => path.endsWith("lazy.js"))).toBe(true)
  })
})

test("a blank reason does not waive the refusal", async () => {
  await live({ advertised: true }, async (origin) => {
    await expect(liveAssetInventory(origin, { acceptMissingHistory: "   " })).rejects.toThrow(
      "asset history is missing",
    )
  })
})

test("the waiver never hides an unavailable asset", async () => {
  await live({ advertised: true, broken: true }, async (origin) => {
    await expect(
      liveAssetInventory(origin, { acceptMissingHistory: "first deploy after the account move" }),
    ).rejects.toThrow()
  })
})
