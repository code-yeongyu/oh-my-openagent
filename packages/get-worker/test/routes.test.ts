import { afterEach, describe, expect, test } from "bun:test"
import { route } from "../src/index"
import { harness } from "./fakes"

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const installSh = await Bun.file(new URL("../scripts/install.sh", import.meta.url)).text()
const installPs1 = await Bun.file(new URL("../scripts/install.ps1", import.meta.url)).text()

const get = (path: string, headers: Record<string, string> = {}) => new Request(`https://get.omo.dev${path}`, { headers })

function mirror(h: ReturnType<typeof harness>, version: string, assets: Record<string, string>) {
  for (const [name, body] of Object.entries(assets)) h.bucket.put(`releases/v${version}/${name}`, body)
  h.bucket.put(`releases/v${version}/.complete`, "{}")
}

describe("install scripts", () => {
  test("serves install.sh and install.ps1 as text with a short cache", async () => {
    const h = harness()
    const sh = await route(get("/install.sh"), h.ctx)
    expect(sh.status).toBe(200)
    expect(await sh.text()).toBe(installSh)
    expect(sh.headers.get("Cache-Control")).toBe("public, max-age=300")
    const ps1 = await route(get("/install.ps1"), h.ctx)
    expect(await ps1.text()).toBe(installPs1)
    expect(h.points.map((p) => p.blobs[3])).toEqual(["install.sh", "install.ps1"])
  })

  test("root serves the script to curl and PowerShell and sends browsers to the docs", async () => {
    const h = harness()
    expect(await (await route(get("/", { "User-Agent": "curl/8.7.1" }), h.ctx)).text()).toBe(installSh)
    expect(await (await route(get("/", { "User-Agent": "Mozilla/5.0 WindowsPowerShell/5.1" }), h.ctx)).text()).toBe(installPs1)
    const browser = await route(get("/", { "User-Agent": "Mozilla/5.0 Safari/605" }), h.ctx)
    expect(browser.status).toBe(302)
    expect(browser.headers.get("Location")).toBe("https://omo.dev/docs/install")
  })
})

describe("channel pointers", () => {
  test("reads the mirrored pointer and caches it for a minute", async () => {
    const h = harness()
    h.bucket.put("channels/latest", "5.1.1\n")
    const response = await route(get("/channels/latest"), h.ctx)
    expect(await response.text()).toBe("5.1.1\n")
    expect(response.headers.get("X-Omo-Source")).toBe("r2")
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60")
    await h.settle()
    h.bucket.objects.clear()
    expect(await (await route(get("/channels/latest"), h.ctx)).text()).toBe("5.1.1\n")
  })

  test("falls back to the npm dist-tag and maps the npm pre-release form to the GitHub tag", async () => {
    const h = harness()
    globalThis.fetch = (async () => Response.json({ latest: "5.1.1", beta: "5.2.0-0.beta.3" })) as unknown as typeof fetch
    const response = await route(get("/channels/beta"), h.ctx)
    expect(await response.text()).toBe("5.2.0-beta.3\n")
    expect(response.headers.get("X-Omo-Source")).toBe("npm")
  })

  test("rejects an unknown channel", async () => {
    expect((await route(get("/channels/nightly"), harness().ctx)).status).toBe(404)
  })
})

describe("release assets", () => {
  test("serves a mirrored binary from R2 with an immutable cache and counts it", async () => {
    const h = harness()
    mirror(h, "5.1.1", { "omo-linux-x64": "binary-bytes", SHA256SUMS: "sums" })
    const response = await route(get("/v/5.1.1/omo-linux-x64"), h.ctx)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe("binary-bytes")
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable")
    expect(response.headers.get("X-Omo-Source")).toBe("r2")
    expect(h.points.at(-1)?.blobs.slice(0, 4)).toEqual(["binary", "r2", "5.1.1", "omo-linux-x64"])
  })

  test("repeat downloads are cache hits that never read R2", async () => {
    const h = harness()
    mirror(h, "5.1.1", { "omo-darwin-arm64": "arm-bytes" })
    await (await route(get("/v/5.1.1/omo-darwin-arm64"), h.ctx)).text()
    await h.settle()
    const reads = h.bucket.reads.length
    const again = await route(get("/v/5.1.1/omo-darwin-arm64"), h.ctx)
    expect(await again.text()).toBe("arm-bytes")
    expect(again.headers.get("X-Omo-Source")).toBe("cache")
    expect(h.bucket.reads.length).toBe(reads)
    expect(h.points.at(-1)?.blobs[1]).toBe("cache")
  })

  test("redirects to the GitHub asset when the version was never marked complete", async () => {
    const h = harness()
    h.bucket.put("releases/v5.1.0/omo-linux-x64", "half-mirrored")
    const response = await route(get("/v/5.1.0/omo-linux-x64"), h.ctx)
    expect(response.status).toBe(302)
    expect(response.headers.get("Location")).toBe(
      "https://github.com/code-yeongyu/oh-my-openagent/releases/download/v5.1.0/omo-linux-x64",
    )
    expect(response.headers.get("X-Omo-Fallback-Reason")).toBe("version-not-mirrored")
    expect(h.points.at(-1)?.blobs[1]).toBe("github")
  })

  test("redirects to GitHub when R2 errors", async () => {
    const h = harness()
    mirror(h, "5.1.1", { "omo-linux-x64": "bytes" })
    h.bucket.failWith = new Error("R2 unavailable")
    const response = await route(get("/v/5.1.1/omo-linux-x64"), h.ctx)
    expect(response.status).toBe(302)
    expect(response.headers.get("X-Omo-Fallback-Reason")).toBe("r2-error")
  })

  test("refuses names outside the release allowlist so the redirect cannot be steered", async () => {
    const h = harness()
    for (const path of ["/v/5.1.1/..%2F..%2Fevil", "/v/5.1.1/install.sh", "/v/latest/omo-linux-x64", "/v/5.1.1/omo-plan9-x64"]) {
      expect((await route(get(path), h.ctx)).status).toBe(404)
    }
    expect(h.points).toEqual([])
  })

  test("tags installer QA downloads so the rollup can leave them out", async () => {
    const h = harness()
    mirror(h, "5.1.1", { "omo-linux-x64": "bytes" })
    await route(get("/v/5.1.1/omo-linux-x64", { "User-Agent": "omo-install.sh/1 omo-install-qa" }), h.ctx)
    await route(get("/v/5.1.1/omo-linux-x64", { "User-Agent": "omo-install.sh/1" }), h.ctx)
    expect(h.points.map((p) => p.blobs[5])).toEqual(["qa", ""])
  })

  test("counts SHA256SUMS and desktop engines under their own kinds", async () => {
    const h = harness()
    mirror(h, "5.1.1", { SHA256SUMS: "s", "senpi-desktop-engine-darwin-arm64": "e" })
    await route(get("/v/5.1.1/SHA256SUMS"), h.ctx)
    await route(get("/v/5.1.1/senpi-desktop-engine-darwin-arm64"), h.ctx)
    expect(h.points.map((p) => p.blobs[0])).toEqual(["checksums", "engine"])
  })
})
