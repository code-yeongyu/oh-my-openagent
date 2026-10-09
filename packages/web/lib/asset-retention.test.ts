/// <reference types="bun" />
import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ASSET_HISTORY_PATH, AssetRetentionError, retainStaticAssets } from "./asset-retention"

const oldPath = "/_next/static/chunks/old.css"
const oldCss = "body { font-family: sans-serif; color: #eee }"
const newCss = "body { color: #ddd }"
const oldHash = createHash("sha256").update(oldCss).digest("hex")
const now = 1_800_000_000_000

async function exercise(
  history: unknown,
  action: (directory: string, origin: string) => Promise<void>,
  reply: () => Response = () => new Response(oldCss, { headers: { "content-type": "text/css" } }),
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "web-retention-"))
  await mkdir(join(directory, "_next/static/chunks"), { recursive: true })
  await writeFile(join(directory, "_next/static/chunks/new.css"), newCss)
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname === ASSET_HISTORY_PATH) {
        return history === undefined ? new Response(null, { status: 404 }) : Response.json(history)
      }
      return reply()
    },
  })
  try {
    await action(directory, server.url.origin)
  } finally {
    server.stop(true)
    await rm(directory, { recursive: true, force: true })
  }
}

function previous(active = true, retainUntil = 0, path = oldPath) {
  return {
    version: 1,
    htmlLifetimeSeconds: 3_600,
    assets: [{ path, sha256: oldHash, active, retainUntil }],
  }
}

function carry(directory: string, origin: string, clock = now, paths: readonly string[] = []) {
  return retainStaticAssets({
    directory,
    origin,
    now: clock,
    htmlLifetimeSeconds: 3_600,
    deploymentOverlapSeconds: 1_800,
    bootstrap: { paths, htmlLifetimeSeconds: 31_536_000 },
  })
}

test("a new build keeps the stylesheet needed by a cached previous page", async () => {
  // Given: previous HTML still refers to old.css.
  await exercise(previous(), async (directory, origin) => {
    // When: the new build carries its predecessor's inventory.
    await carry(directory, origin)
    // Then: the stylesheet bytes used to render the old page remain available.
    expect(await readFile(join(directory, oldPath.slice(1)), "utf8")).toBe(oldCss)
    expect(await readFile(join(directory, "_next/static/chunks/new.css"), "utf8")).toBe(newCss)
  })
})

test("legacy bootstrap retains a no-dpl stylesheet without a prior inventory", async () => {
  // Given: the currently served legacy page has no archive yet.
  await exercise(undefined, async (directory, origin) => {
    // When: its explicit stylesheet inventory is imported.
    await carry(directory, origin, now, [oldPath])
    // Then: the old resource remains usable after this deployment.
    expect(await readFile(join(directory, oldPath.slice(1)), "utf8")).toBe(oldCss)
  })
})

test("an inactive stylesheet remains available during deployment overlap", async () => {
  // Given: retirement covers the previous HTML lifetime plus propagation overlap.
  await exercise(previous(false, now + 5_400_000), async (directory, origin) => {
    // When: another build lands after the HTML freshness hour but before overlap ends.
    await carry(directory, origin, now + 4_000_000)
    // Then: an eligible delayed document still has its stylesheet.
    expect(await readFile(join(directory, oldPath.slice(1)), "utf8")).toBe(oldCss)
  })
})

test("an expired inactive stylesheet is not downloaded into another build", async () => {
  // Given: no supported document can still refer to this retired stylesheet.
  let downloads = 0
  await exercise(
    previous(false, now - 1),
    async (directory, origin) => {
      // When: the next build is assembled.
      await carry(directory, origin)
      // Then: expired bytes are omitted, rather than growing the archive forever.
      expect(await Bun.file(join(directory, oldPath.slice(1))).exists()).toBe(false)
      expect(downloads).toBe(0)
    },
    () => {
      downloads++
      return new Response(oldCss, { headers: { "content-type": "text/css" } })
    },
  )
})

test("a reused stylesheet keeps an older document's longer deadline across later builds", async () => {
  // Given: a year-lived page refers to a stylesheet also present in a newer build.
  await exercise(previous(true, now + 31_536_000_000), async (b, origin) => {
    await writeFile(join(b, oldPath.slice(1)), oldCss)
    await carry(b, origin)
    const bHistory: unknown = JSON.parse(
      await readFile(join(b, ASSET_HISTORY_PATH.slice(1)), "utf8"),
    )
    // When: subsequent builds retire it and assemble another build three days later.
    await exercise(bHistory, async (c, cOrigin) => {
      await carry(c, cOrigin, now + 86_400_000)
      const cHistory: unknown = JSON.parse(
        await readFile(join(c, ASSET_HISTORY_PATH.slice(1)), "utf8"),
      )
      await exercise(cHistory, async (d, dOrigin) => {
        await carry(d, dOrigin, now + 259_200_000)
        // Then: the original page's stylesheet is still downloadable.
        expect(await readFile(join(d, oldPath.slice(1)), "utf8")).toBe(oldCss)
      })
    })
  })
})

test("losing history without explicit legacy inventory blocks deployment", async () => {
  // Given: no predecessor inventory or bootstrap asset list is available.
  await exercise(undefined, async (directory, origin) => {
    // When: deployment attempts carry-forward.
    await expect(carry(directory, origin)).rejects.toBeInstanceOf(AssetRetentionError)
    // Then: it cannot publish an empty archive that silently drops cached-page resources.
    expect(await Bun.file(join(directory, ASSET_HISTORY_PATH.slice(1))).exists()).toBe(false)
  })
})

for (const [name, reply] of [
  ["unavailable", () => new Response(null, { status: 503 })],
  [
    "HTML masquerading as CSS",
    () => new Response("<html>error</html>", { headers: { "content-type": "text/html" } }),
  ],
  ["corrupted bytes", () => new Response("body{}", { headers: { "content-type": "text/css" } })],
] as const) {
  test(`a ${name} stylesheet blocks publishing replacement history`, async () => {
    // Given: the predecessor's stylesheet cannot be faithfully retained.
    await exercise(
      previous(),
      async (directory, origin) => {
        // When: carry-forward encounters the failed download.
        await expect(carry(directory, origin)).rejects.toBeInstanceOf(AssetRetentionError)
        // Then: no new inventory can falsely advertise a successful deployment.
        expect(await Bun.file(join(directory, ASSET_HISTORY_PATH.slice(1))).exists()).toBe(false)
      },
      reply,
    )
  })
}

test("a traversal path in history cannot write outside the static asset tree", async () => {
  // Given: the external inventory contains a parent-directory traversal.
  await exercise(
    previous(true, 0, "/_next/static/../../outside.css"),
    async (directory, origin) => {
      // When: it crosses the history parsing boundary.
      await expect(carry(directory, origin)).rejects.toBeInstanceOf(AssetRetentionError)
      // Then: the deployment has no published history or escaped output.
      expect(await Bun.file(join(directory, "outside.css")).exists()).toBe(false)
      expect(await Bun.file(join(directory, ASSET_HISTORY_PATH.slice(1))).exists()).toBe(false)
    },
  )
})
