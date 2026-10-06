import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const cli = fileURLToPath(new URL("../scripts/retain-static-assets.mjs", import.meta.url))
const oldPath = "/_next/static/chunks/old.css"
const css = "body { color: #eee; font-family: sans-serif }"

async function deployment({ bootstrap = false, history = false, routeLifetime = 3600 } = {}) {
  const root = await mkdtemp(join(tmpdir(), "web-retention-cli-"))
  const assets = join(root, "assets")
  await mkdir(join(assets, "_next/static/chunks"), { recursive: true })
  await mkdir(join(root, ".next"))
  await writeFile(join(assets, "_next/static/chunks/new.css"), "body { color: #ddd }")
  await writeFile(
    join(root, ".next/required-server-files.json"),
    JSON.stringify({
      config: { expireTime: 3600 },
    }),
  )
  await writeFile(
    join(root, ".next/prerender-manifest.json"),
    JSON.stringify({
      routes: {
        "/ko/manifesto": { initialRevalidateSeconds: routeLifetime },
        "/sitemap.xml": {
          initialRevalidateSeconds: false,
          initialHeaders: { "content-type": "application/xml" },
        },
      },
    }),
  )
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname
      if (path === "/sitemap.xml") return new Response("<urlset/>")
      if (path === "/")
        return new Response(`<html><link href="${oldPath}"></html>`, {
          headers: { "content-type": "text/html", "cache-control": "s-maxage=3600" },
        })
      if (path === "/__asset-history.json") {
        if (!history) return new Response(null, { status: 404 })
        return Response.json({
          version: 1,
          htmlLifetimeSeconds: 3600,
          assets: [
            {
              path: oldPath,
              sha256: createHash("sha256").update(css).digest("hex"),
              active: true,
              retainUntil: 0,
            },
          ],
        })
      }
      return new Response(css, { headers: { "content-type": "text/css" } })
    },
  })
  try {
    const args = [process.execPath, cli, assets, server.url.origin, "1800"]
    if (bootstrap === "current") args.push("--bootstrap-current")
    else if (bootstrap) {
      const inventory = join(root, "legacy.json")
      await writeFile(
        inventory,
        JSON.stringify({
          paths: [oldPath],
          htmlLifetimeSeconds: 31536000,
        }),
      )
      args.push(inventory)
    }
    const child = Bun.spawn(args, { cwd: root, stdout: "pipe", stderr: "pipe" })
    const [exit, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    const exists = await Bun.file(join(assets, oldPath.slice(1))).exists()
    return {
      exit,
      stdout,
      stderr,
      retainedCss: exists ? await readFile(join(assets, oldPath.slice(1)), "utf8") : null,
      historyPublished: await Bun.file(join(assets, "__asset-history.json")).exists(),
    }
  } finally {
    server.stop(true)
    await rm(root, { recursive: true, force: true })
  }
}

test("the deployment CLI imports a deliberately supplied legacy stylesheet inventory", async () => {
  // Given: an old no-dpl page and its explicit legacy resource list.
  // When: the real CLI assembles the new asset upload.
  const result = await deployment({ bootstrap: true })
  // Then: its cached page still has exactly the predecessor's CSS bytes.
  expect(result.exit).toBe(0)
  expect(result.retainedCss).toBe(css)
  expect(result.historyPublished).toBe(true)
})

test("later deployments carry the published predecessor history without bootstrap", async () => {
  // Given: the prior deployment has an advertised inventory.
  // When: the CLI runs without a first-migration file.
  const result = await deployment({ history: true })
  // Then: the old resource survives without silently reinitializing history.
  expect(result.exit).toBe(0)
  expect(result.retainedCss).toBe(css)
})

test("deployment bootstrap flag gathers the live resources and preserves their actual bytes", async () => {
  // Given: the first deployment has live HTML but no published inventory.
  // When: the production CLI bootstrap flag gathers that page's resources.
  const result = await deployment({ bootstrap: "current" })
  // Then: the cached HTML keeps its original usable stylesheet.
  expect(result.exit).toBe(0)
  expect(result.retainedCss).toBe(css)
  expect(result.historyPublished).toBe(true)
})

test("a missing history cannot silently turn the CLI into an empty first migration", async () => {
  // Given: neither published history nor explicit legacy inventory exists.
  // When: deployment attempts carry-forward.
  const result = await deployment()
  // Then: the failed step cannot publish a replacement archive.
  expect(result.exit).not.toBe(0)
  expect(result.historyPublished).toBe(false)
})

test("the CLI refuses a document that outlives its compiled retention budget", async () => {
  // Given: a page revalidates later than the bounded expiry recorded by the build.
  // When: deployment tries to advertise the shorter window.
  const result = await deployment({ history: true, routeLifetime: 86400 })
  // Then: it fails before publishing an under-retained asset inventory.
  expect(result.exit).not.toBe(0)
  expect(result.historyPublished).toBe(false)
})
