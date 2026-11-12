import { afterAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"

import { buildCodexInstaller } from "../../../../script/build-codex-install.ts"

// #9903, #13192: every file the full generated build writes (script/build-generated.ts) is on script/generated-bundles.json
// and ignored by git, and no tracked file is on the list. A written file that is unlisted or not ignored is an output a
// PR could commit; a listed tracked file is a build output back in git, or source no generator writes (runtime/dag).
// This builds the outputs into a temporary root, except the fixed bin/lib targets, and checks both directions.
const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url))
const PLUGIN = "packages/omo-senpi/plugin"
const CODEX_INSTALL_DIST = "packages/omo-codex/scripts/install-dist"
// build-service-auth.ts, build-reflection-lock.ts and build-brand-logo.ts each have one fixed target; they write nothing else.
const FIXED_TARGETS = [
  "packages/omo-native/bin/lib/service-auth.generated.js",
  "packages/omo-native/bin/lib/reflection-lock.generated.js",
  "packages/omo-native/bin/lib/brand-logo.generated.js",
]
// Hand-written source that ships under plugin/runtime beside the generated bundles: the dag SDK and its library loader.
// No generator writes them; script/build-omo-native.ts copies the directory from the tree. Add a new hand-written
// runtime file here on purpose.
const RUNTIME_SOURCE = new Set([`${PLUGIN}/runtime/dag/sdk.js`, `${PLUGIN}/runtime/dag/library.js`])
const temporaryRoot = mkdtempSync(join(tmpdir(), "generated-bundles-list-"))

afterAll(() => {
  rmSync(temporaryRoot, { recursive: true, force: true })
})

function listPatterns() {
  const list = JSON.parse(readFileSync(join(repositoryRoot, "script/generated-bundles.json"), "utf8"))
  if (list.dialect !== "ecmascript") throw new Error("script/generated-bundles.json must declare dialect ecmascript")
  return list.patterns.map((pattern) => new RegExp(pattern))
}

function trackedFiles() {
  const result = spawnSync("git", ["ls-files", "-z"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.status !== 0) throw new Error(`git ls-files failed: ${result.stderr}`)
  return result.stdout.split("\0").filter((path) => path.length > 0)
}

function filesBelow(root) {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
}

// The plugin build runs as the release job runs it, with its documented output root override.
function pluginOutputs() {
  const pluginRoot = join(temporaryRoot, "plugin")
  const build = spawnSync("node", [join(repositoryRoot, PLUGIN, "scripts/build-extension.mjs")], {
    cwd: repositoryRoot,
    env: { ...process.env, OMO_SENPI_PLUGIN_OUTPUT: pluginRoot },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
  if (build.status !== 0) throw new Error(`build-extension.mjs failed: ${build.stderr}`)
  const install = spawnSync("node", [join(repositoryRoot, PLUGIN, "scripts/build-install.mjs")], {
    cwd: repositoryRoot,
    env: { ...process.env, OMO_SENPI_PLUGIN_OUTPUT: pluginRoot },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
  if (install.status !== 0) throw new Error(`build-install.mjs failed: ${install.stderr}`)
  // buildEntry's temporary metafiles are deleted in a finally block; never an output.
  return filesBelow(pluginRoot)
    .filter((path) => !path.endsWith(".meta.json"))
    .map((path) => `${PLUGIN}/${path}`)
}

async function codexInstallerOutputs() {
  const distRoot = join(temporaryRoot, "install-dist")
  await buildCodexInstaller({ outputPath: join(distRoot, "install-local.mjs") })
  return filesBelow(distRoot).map((path) => `${CODEX_INSTALL_DIST}/${path}`)
}

function ignoredPaths(paths) {
  const result = spawnSync("git", ["check-ignore", "--no-index", "--stdin", "-z"], {
    cwd: repositoryRoot,
    input: paths.join("\0"),
    encoding: "utf8",
  })
  if (result.status !== 0 && result.status !== 1) throw new Error(`git check-ignore failed: ${result.stderr}`)
  return new Set(result.stdout.split("\0").filter((path) => path.length > 0))
}

describe("generated bundle list", () => {
  test("#given the full generated build written into a temporary root #when compared with the list and git #then every output is listed and ignored and none is tracked", async () => {
    // given
    const written = [...new Set([...pluginOutputs(), ...(await codexInstallerOutputs()), ...FIXED_TARGETS])].sort()
    const patterns = listPatterns()
    const tracked = trackedFiles()
    const ignored = ignoredPaths(written)

    // when
    const writtenNotListed = written.filter((path) => !patterns.some((pattern) => pattern.test(path)))
    const writtenNotIgnored = written.filter((path) => !ignored.has(path))
    const trackedListed = tracked.filter((path) => patterns.some((pattern) => pattern.test(path))).sort()
    const runtimeUnaccounted = tracked
      .filter((path) => path.startsWith(`${PLUGIN}/runtime/`))
      .filter((path) => !RUNTIME_SOURCE.has(path))
      .sort()

    // then
    expect(written.length).toBeGreaterThan(0)
    expect({ writtenNotListed, writtenNotIgnored, trackedListed, runtimeUnaccounted }).toEqual({
      writtenNotListed: [],
      writtenNotIgnored: [],
      trackedListed: [],
      runtimeUnaccounted: [],
    })
  }, 600_000)
})
