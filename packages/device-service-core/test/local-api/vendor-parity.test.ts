import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import pin from "../../src/local-api/PIN.json" with { type: "json" }

// Every vendored file under src/local-api is the omo-relay-daemon local-API client at the pinned commit, byte for byte
// after its provenance line, except the import specifiers PIN.json rewrites. A local edit, or a refresh that forgets
// PIN.json, fails here instead of drifting from the service's own client.
const SRC = join(import.meta.dir, "..", "..", "src", "local-api")
const NOT_VENDORED = ["PIN.json", ...Object.keys(pin.ported)]

const upstreamBytes = (vendored: string): Buffer =>
  Buffer.from(pin.importRewrites.reduce((text, { from, to }) => text.replaceAll(`"${to}"`, `"${from}"`), vendored))

describe("vendored device-service local-API client", () => {
  test("#given each pinned file #then it matches the upstream commit byte for byte", () => {
    for (const file of pin.files) {
      const name = file.upstreamPath.split("/").at(-1) ?? ""
      const text = readFileSync(join(SRC, name), "utf8")
      const provenance = `// Vendored from ${pin.upstream}@${pin.upstreamCommit} ${file.upstreamPath}\n`
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

  // spec-proto.ts is omo's own port, not byte-vendored, and knip skips the whole directory: this pins its exports to
  // exactly the relay-spec names the vendored files import from it, so a stale or missing port fails here.
  test("#given spec-proto.ts #then it exports exactly what the vendored files import from it", () => {
    const imported = new Set<string>()
    for (const file of pin.files) {
      const text = readFileSync(join(SRC, file.upstreamPath.split("/").at(-1) ?? ""), "utf8")
      for (const [, names] of text.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"\.\/spec-proto\.ts"/g))
        for (const name of (names ?? "").split(",")) {
          const bare = name.trim().replace(/^type\s+/, "")
          if (bare !== "") imported.add(bare)
        }
    }
    const port = readFileSync(join(SRC, "spec-proto.ts"), "utf8")
    // Value exports in every form come from the transpiler's scan; what it strips (type-only and `declare` declarations,
    // type-only names in an export list) from their own syntax.
    const exported = new Set([
      ...new Bun.Transpiler({ loader: "ts" }).scan(port).exports,
      ...[
        ...port.matchAll(
          /(?:^|;)\s*export\s+(?:declare\s+)?(?:type|interface|const|let|var|function|class|enum|namespace|module)\s+(\w+)/gm,
        ),
      ].map((match) => match[1]),
      ...[...port.matchAll(/(?:^|;)\s*export\s+(?:type\s+)?\{([^}]*)\}/gm)].flatMap((match) =>
        (match[1] ?? "")
          .split(",")
          .map(
            (entry) =>
              entry
                .trim()
                .replace(/^type\s+/, "")
                .split(/\s+as\s+/)
                .at(-1) ?? "",
          )
          .filter(Boolean),
      ),
    ])
    expect([...exported].toSorted()).toEqual([...imported].toSorted())
  })
})
