import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "bun:test"

import { artifactsMatch, closeNodeMinifier, minifyBundle } from "./build-artifact.mjs"

test("#given an injected bundle body with a recomputed marker #when freshness is checked #then the artifact is rejected", () => {
  // given
  const sourceDigest = digest("reviewed source")
  const expected = artifact(sourceDigest, "export const safe = true\n")
  const injected = artifact(sourceDigest, "export const safe = true\nglobalThis.injected = true\n")

  // when / then
  expect(artifactsMatch(injected, expected)).toBe(false)
})

test("#given the Node minifier starts closing #when another bundle is queued #then a fresh worker completes it", async () => {
  const root = await mkdtemp(join(tmpdir(), "omo-minifier-close-"))
  const first = join(root, "first.js")
  const second = join(root, "second.js")
  try {
    await Promise.all([
      writeFile(first, "export const value = 1 + 1\n"),
      writeFile(second, "export const value = 1 + 1\n"),
    ])

    await minifyBundle(first)
    closeNodeMinifier()
    await minifyBundle(second)

    expect(await readFile(second, "utf8")).toBe(await readFile(first, "utf8"))
  } finally {
    closeNodeMinifier()
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)

function artifact(sourceDigest, body) {
  return `// omo:${sourceDigest}:${digest(body)}\n${body}`
}

function digest(value) {
  return createHash("sha256").update(value).digest("base64url")
}
