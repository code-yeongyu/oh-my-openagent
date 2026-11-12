import { afterAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"

import { buildCodexInstaller } from "../../../../script/build-codex-install.ts"

// #9903: script/generated-bundles.json must name exactly the files the release job's generators write (publish.yml
// prepare job: build-extension.mjs, build-codex-install.ts, build-service-auth.ts), no more and no less. A listed file
// no generator writes is source that the PR gate would forbid editing; a written file that is tracked and unlisted
// is a bundle feature PRs could commit again. This builds every output into a temporary root and compares.
const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url))
const PLUGIN = "packages/omo-senpi/plugin"
const CODEX_INSTALL_DIST = "packages/omo-codex/scripts/install-dist"
// build-service-auth.ts has one fixed target (its \`target\` constant); it writes nothing else.
const SERVICE_AUTH_TARGET = "packages/omo-native/bin/lib/service-auth.generated.js"
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

describe("generated bundle list", () => {
  test("#given the release generators built into a temporary root #when compared with the listed tracked files #then they are the same set", async () => {
    // given
    const written = new Set([...pluginOutputs(), ...(await codexInstallerOutputs()), SERVICE_AUTH_TARGET])
    const patterns = listPatterns()
    const tracked = trackedFiles()
    const listed = new Set(tracked.filter((path) => patterns.some((pattern) => pattern.test(path))))

    // when
    const listedNotWritten = [...listed].filter((path) => !written.has(path)).sort()
    // The invariant is "written == listed and tracked", asserted as two inclusions so a new bundle can land: every listed
    // tracked file is written (this catches hand-written source on the list, such as runtime/dag), and every written file
    // is matched by the patterns, tracked or not (this catches an output nobody listed). A written path the patterns
    // match but git does not track yet is a new bundle: under the PR gate its PR cannot commit it, and the release
    // commit adds it, so a strict equality would fail that PR with nothing it could do.
    const writtenNotListed = [...written].filter((path) => !patterns.some((pattern) => pattern.test(path))).sort()
    const runtimeUnaccounted = tracked
      .filter((path) => path.startsWith(`${PLUGIN}/runtime/`))
      .filter((path) => !listed.has(path) && !RUNTIME_SOURCE.has(path))
      .sort()

    // then
    expect(listed.size).toBeGreaterThan(0)
    expect({ listedNotWritten, writtenNotListed, runtimeUnaccounted }).toEqual({
      listedNotWritten: [],
      writtenNotListed: [],
      runtimeUnaccounted: [],
    })
  }, 600_000)
})
