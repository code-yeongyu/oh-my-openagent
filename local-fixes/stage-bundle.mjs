#!/usr/bin/env bun
/**
 * Builds the plugin bundle BESIDE the checkout instead of into dist/.
 *
 *   bun local-fixes/stage-bundle.mjs
 *   bun local-fixes/stage-bundle.mjs --target-checkout <dir>
 *
 * --target-checkout stages for ANOTHER checkout of this repository: the bundle and lane.json
 * land beside that checkout and name its paths. Use it from a work clone, because no file
 * inside the live checkout may be written while OpenChamber runs. The target has to be able
 * to fast-forward to the commit being staged; activate-staged.ps1 there refuses the swap
 * until it has.
 *
 * Why this exists
 * ---------------
 * OpenCode v2 watches dist/index.js (and the root index.js). Writing it under a running
 * backend makes opencode unload and re-register every plugin ordered after this one, which
 * drops the claude-code provider and fails Claude sessions that are mid-loop
 * (2026-10-11T18:50:59Z rebuild -> "Model unavailable" at 18:51:09Z). So the live bundle is
 * only ever replaced offline, by local-fixes/activate-staged.ps1, during the owner's restart.
 *
 * This runs the same two steps `bun run build` uses for dist/index.js (the "index" node and
 * the node-require shim) with the output redirected, then checks every ledger marker.
 * Nothing under dist/ and no file at the repo root is written.
 */
import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, "..")
const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"))
const targetFlag = process.argv.indexOf("--target-checkout")
const target = targetFlag > 0 ? resolve(process.argv[targetFlag + 1] ?? "") : resolve(repo)
const stagedRoot = join(target, "..", `${basename(target)}-staged`)
const stagedDist = join(stagedRoot, "dist")
const staged = join(stagedDist, "index.js")
const live = join(target, manifest.build.artifact)

// Keep in step with the "index" node in script/build-nodes.ts; only --outdir differs.
const INDEX_BUILD_ARGS = [
  "build",
  "packages/omo-opencode/src/index.ts",
  "--outdir",
  stagedDist,
  "--target",
  "bun",
  "--format",
  "esm",
  "--external",
  "zod",
  "--external",
  "@opencode/plugin",
]
// Keep in step with script/patch-node-require-shim.ts, which hardcodes dist/index.js.
const SHIM_IMPORT_LINE = 'import { createRequire as __omoCreateRequire } from "node:module";'
const BUN_REQUIRE_LINE = "var __require = import.meta.require;"
const NODE_SAFE_REQUIRE_LINE =
  'var __require = typeof import.meta.require === "function" ? import.meta.require : __omoCreateRequire(import.meta.url);'

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex")
const git = (args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim()
const pass = (message) => console.log(`PASS ${message}`)
function fail(message) {
  console.log(`FAIL ${message}`)
  process.exit(1)
}

// 1. The staged bundle must name a commit on the bundle branch.
const branch = git(["branch", "--show-current"])
if (manifest.bundleBranch && branch !== manifest.bundleBranch) {
  fail(`on branch '${branch}', expected '${manifest.bundleBranch}'`)
}
pass(`branch ${branch}`)
const GENERATED_PATHS = [
  "packages/omo-senpi/plugin/extensions/",
  "packages/omo-senpi/plugin/scripts/install.mjs",
  "packages/omo-codex/scripts/install-dist/",
  "packages/omo-senpi/plugin/runtime/",
]
const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" })
  .split("\n")
  .filter((line) => line.trim().length > 0)
  .filter((line) => !GENERATED_PATHS.some((prefix) => line.slice(3).startsWith(prefix)))
if (dirty.length > 0) fail(`working tree has uncommitted changes:\n${dirty.join("\n")}`)
pass("working tree is clean")

// 1b. Another checkout must be the same repository, behind this commit and nothing else.
let targetHead = null
if (resolve(target) !== resolve(repo)) {
  try {
    // --no-optional-locks: reading the target must not write its index.
    targetHead = execFileSync("git", ["--no-optional-locks", "-C", target, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
    git(["cat-file", "-e", `${targetHead}^{commit}`])
    git(["merge-base", "--is-ancestor", targetHead, "HEAD"])
  } catch {
    fail(`${target} (at ${targetHead ?? "an unreadable commit"}) cannot fast-forward to this commit; fetch it here and rebase first`)
  }
  pass(`target checkout ${target} can fast-forward from ${targetHead.slice(0, 7)}`)
}

// 2. Bundle beside the checkout.
mkdirSync(stagedDist, { recursive: true })
const build = spawnSync("bun", INDEX_BUILD_ARGS, {
  cwd: repo,
  encoding: "utf8",
   timeout: 110_000,
  shell: process.platform === "win32",
})
if (build.status !== 0 || !existsSync(staged)) {
  process.stdout.write(build.stdout ?? "")
  process.stderr.write(build.stderr ?? "")
  fail("bundle (bun build)")
}
pass("bundle (bun build)")

// 3. Node/Electron require shim.
let bundle = readFileSync(staged, "utf8")
if (!bundle.includes(NODE_SAFE_REQUIRE_LINE)) {
  if (!bundle.includes(BUN_REQUIRE_LINE)) fail("node-require shim: Bun require helper not found")
  bundle = bundle.replace(BUN_REQUIRE_LINE, () => `${SHIM_IMPORT_LINE}\n${NODE_SAFE_REQUIRE_LINE}`)
  writeFileSync(staged, bundle, "utf8")
}
pass("node-require shim")

// 4. Every ledger marker.
const missing = []
for (const fix of manifest.fixes) {
  const gone = (fix.markers || []).filter((marker) => !bundle.includes(marker))
  if (gone.length > 0) missing.push(`${fix.id}: ${gone.join(", ")}`)
}
if (missing.length > 0) fail(`markers missing from the staged bundle:\n${missing.join("\n")}`)
pass(`all ${manifest.fixes.length} fixes present in the staged bundle`)

// 5. Record what was staged.
const lane = {
  builtUtc: new Date().toISOString(),
  commit: git(["rev-parse", "HEAD"]),
  branch,
  fixes: manifest.fixes.length,
  fixIds: manifest.fixes.map((fix) => fix.id),
  source: resolve(repo),
  targetHeadAtBuild: targetHead,
  staged,
  stagedSha256: sha256(staged),
  live,
  liveSha256AtBuild: existsSync(live) ? sha256(live) : null,
}
writeFileSync(join(stagedRoot, "lane.json"), `${JSON.stringify(lane, null, 2)}\n`)
console.log(`staged ${lane.stagedSha256.slice(0, 12)} from ${lane.commit.slice(0, 7)} -> ${staged}`)
console.log(
  lane.stagedSha256 === lane.liveSha256AtBuild
    ? "ACTIVE on disk: the live bundle already matches the staged one"
    : targetHead && targetHead !== lane.commit
      ? `NOT ACTIVE: with OpenChamber fully closed, in ${target}:  git fetch "${lane.source}" ${branch}  &&  git merge --ff-only ${lane.commit}  then  pwsh -NoProfile -File local-fixes\\activate-staged.ps1`
      : "NOT ACTIVE: with OpenChamber fully closed, run  pwsh -NoProfile -File local-fixes\\activate-staged.ps1",
)
