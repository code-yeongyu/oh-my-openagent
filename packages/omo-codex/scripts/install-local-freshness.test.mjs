import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { test } from "node:test"

// Release contract (#13192): the installer bundle is not tracked, so `git pull` never refreshes it. The shim must rebuild a
// bundle whose source digest no longer matches the sources, keep a current one, and in a published package (no sources)
// use the bundle it ships. The builder here is a stand-in with the real module's exports; the shim under test is the real file.
const SHIM = new URL("./install-local.mjs", import.meta.url)
const sha = (text) => createHash("sha256").update(text).digest("hex")

const FAKE_BUILDER = `
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const source = join(root, "packages", "omo-codex", "src", "install", "install-local-cli.ts")
export const generatedCodexInstallerPath = join(root, "packages", "omo-codex", "scripts", "install-dist", "install-local.mjs")
// Like the real builder: the bundle body names the workspace sources it bundled, and the digest reads each of them.
export const bundledWorkspaceSources = (body) => [...body.matchAll(/^\\/\\/ src:(\\S+)$/gm)].map((match) => match[1])
export async function digestCodexInstallerSources(bundled = []) {
  const hash = createHash("sha256").update(readFileSync(source, "utf8"))
  for (const path of bundled) hash.update(readFileSync(join(root, path), "utf8"))
  return hash.digest("hex")
}
export function parseCodexInstallerArtifact(text) {
  const lines = text.split("\\n")
  const match = /^\\/\\/ omo-codex-install:([a-f0-9]{64}):([a-f0-9]{64})$/.exec(lines[1] ?? "")
  return match ? { sourceDigest: match[1], bodyDigest: match[2], body: lines.slice(2).join("\\n") } : undefined
}
if (import.meta.main) {
  mkdirSync(dirname(generatedCodexInstallerPath), { recursive: true })
  writeFileSync(generatedCodexInstallerPath, "#!/usr/bin/env node\\n// omo-codex-install:" + (await digestCodexInstallerSources()) + ":" + "0".repeat(64) + "\\nexport {}\\n")
  appendFileSync(join(root, "builds.log"), "build\\n")
}
`

function checkout({ source, bundleBuiltFrom, published = false, bannerSources = [] }) {
  const root = mkdtempSync(join(tmpdir(), "omo-codex-shim-"))
  const scripts = join(root, "packages", "omo-codex", "scripts")
  mkdirSync(join(scripts, "install-dist"), { recursive: true })
  copyFileSync(SHIM, join(scripts, "install-local.mjs"))
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ scripts: { "build:codex-install": "bun script/build-codex-install.ts" } }),
  )
  if (!published) {
    mkdirSync(join(root, "packages", "omo-codex", "src", "install"), { recursive: true })
    writeFileSync(join(root, "packages", "omo-codex", "src", "install", "install-local-cli.ts"), source)
    mkdirSync(join(root, "script"))
    writeFileSync(join(root, "script", "build-codex-install.ts"), FAKE_BUILDER)
  }
  if (bundleBuiltFrom !== undefined)
    writeFileSync(
      join(scripts, "install-dist", "install-local.mjs"),
      `#!/usr/bin/env node\n// omo-codex-install:${sha(bundleBuiltFrom)}:${"0".repeat(64)}\n${bannerSources.map((path) => `// src:${path}\n`).join("")}export {}\n`,
    )
  return {
    root,
    builds: () =>
      existsSync(join(root, "builds.log"))
        ? readFileSync(join(root, "builds.log"), "utf8").split("\n").filter(Boolean).length
        : 0,
    marker: () => readFileSync(join(scripts, "install-dist", "install-local.mjs"), "utf8").split("\n")[1],
    load: () => import(pathToFileURL(join(scripts, "install-local.mjs")).href),
  }
}

test("#given a checkout whose bundle was built from older sources #when the shim loads #then it rebuilds the bundle", async () => {
  const tree = checkout({ source: "export const v = 2\n", bundleBuiltFrom: "export const v = 1\n" })
  try {
    await tree.load()
    assert.equal(tree.builds(), 1)
    assert.equal(tree.marker(), `// omo-codex-install:${sha("export const v = 2\n")}:${"0".repeat(64)}`)
  } finally {
    rmSync(tree.root, { recursive: true, force: true })
  }
})

test("#given a checkout whose bundle matches its sources #when the shim loads #then it keeps the bundle", async () => {
  const tree = checkout({ source: "export const v = 2\n", bundleBuiltFrom: "export const v = 2\n" })
  try {
    await tree.load()
    assert.equal(tree.builds(), 0)
  } finally {
    rmSync(tree.root, { recursive: true, force: true })
  }
})

test("#given a published package without sources #when the shim loads #then it uses the shipped bundle", async () => {
  const tree = checkout({ bundleBuiltFrom: "anything\n", published: true })
  try {
    await tree.load()
    assert.equal(tree.builds(), 0)
  } finally {
    rmSync(tree.root, { recursive: true, force: true })
  }
})

test("#given a bundle that records a source since deleted #when the shim loads #then it rebuilds instead of failing", async () => {
  const tree = checkout({
    source: "export const v = 2\n",
    bundleBuiltFrom: "export const v = 2\n",
    bannerSources: ["packages/omo-codex/src/install/deleted-helper.ts"],
  })
  try {
    const installer = await tree.load()
    assert.equal(tree.builds(), 1)
    assert.equal(typeof installer, "object")
  } finally {
    rmSync(tree.root, { recursive: true, force: true })
  }
})
