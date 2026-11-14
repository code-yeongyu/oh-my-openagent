import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import pin from "../../src/local-api/PIN.json" with { type: "json" }

// Every vendored file under src/local-api is the omo-relay-daemon local-API client at the pinned commit (or the file's own
// upstreamCommit when PIN.json names one), byte for byte after its provenance line, except the import specifiers PIN.json
// rewrites. A local edit, or a refresh that forgets PIN.json, fails here instead of drifting from the service's own client.
const SRC = join(import.meta.dir, "..", "..", "src", "local-api")
const NOT_VENDORED = ["PIN.json", ...Object.keys(pin.ported)]

const upstreamBytes = (vendored: string): Buffer =>
  Buffer.from(pin.importRewrites.reduce((text, { from, to }) => text.replaceAll(`"${to}"`, `"${from}"`), vendored))

describe("vendored device-service local-API client", () => {
  test("#given each pinned file #then it matches the upstream commit byte for byte", () => {
    for (const file of pin.files) {
      const name = file.upstreamPath.split("/").at(-1) ?? ""
      const text = readFileSync(join(SRC, name), "utf8")
      const commit = "upstreamCommit" in file ? file.upstreamCommit : pin.upstreamCommit
      const provenance = `// Vendored from ${pin.upstream}@${commit} ${file.upstreamPath}\n`
      expect(text.startsWith(provenance)).toBe(true)
      const vendored = text.slice(provenance.length)
      const upstream = upstreamBytes(vendored)
      expect([name, pin.importRewrites.some(({ to }) => vendored.includes(`"${to}"`))]).toEqual([
        name,
        file.importRewrite,
      ])
      expect([name, createHash("sha256").update(upstream).digest("hex")]).toEqual([name, file.sha256])
      expect([name, createHash("sha1").update(`blob ${upstream.length}\0`).update(upstream).digest("hex")]).toEqual([
        name,
        file.gitBlobSha1,
      ])
    }
  })

  test("#given the directory #then it holds no file PIN.json does not name", () => {
    const pinned = pin.files.map((file) => file.upstreamPath.split("/").at(-1) ?? "")
    const present = readdirSync(SRC).filter((name) => !NOT_VENDORED.includes(name))
    expect(present.toSorted()).toEqual(pinned.toSorted())
  })
})
