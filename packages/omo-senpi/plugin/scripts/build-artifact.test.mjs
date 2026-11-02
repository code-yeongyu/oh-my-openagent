import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "bun:test"

import { artifactsMatch, closeNodeMinifier, minifyBundle, normalizeBuiltinImports } from "./build-artifact.mjs"

test("#given Node and Bun builtin catalogs #when imports are normalized #then Bun namespaces stay unchanged and both outputs match", async () => {
  const root = await mkdtemp(join(tmpdir(), "omo-builtin-normalize-"))
  const nodeOutput = join(root, "node.js")
  const bunOutput = join(root, "bun.js")
  const source = [
    'import path from "path";',
    'import "fs";',
    'import "bun";',
    'import { dlopen } from "bun:ffi";',
    'const test = import("bun:test");',
    'import "node:sqlite";',
  ].join("\n")
  try {
    await Promise.all([writeFile(nodeOutput, source), writeFile(bunOutput, source)])
    await normalizeBuiltinImports(nodeOutput, ["fs", "path", "node:sqlite"])
    await normalizeBuiltinImports(bunOutput, ["fs", "path", "bun", "bun:ffi", "bun:test", "node:sqlite"])
    const expected = source.replace('"path"', '"node:path"').replace('"fs"', '"node:fs"')
    expect(await readFile(nodeOutput, "utf8")).toBe(expected)
    expect(await readFile(bunOutput, "utf8")).toBe(expected)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

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
