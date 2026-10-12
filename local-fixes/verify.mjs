#!/usr/bin/env bun
/**
 * Verify that the LOADED bundle actually contains every ledgered local fix.
 *
 *   bun run fixes:verify                  check the live bundle (dist/index.js)
 *   bun run fixes:verify <path/to/index.js>   check another bundle, e.g. the staged one
 *
 * Why this exists
 * ---------------
 * `fixes:apply` verifies the bundle only AFTER it builds one. Nothing stopped a
 * build from a branch that does not carry the fixes — `git checkout <pr-branch>`
 * silently disarms everything, `dist/index.js` is rebuilt without the fixes, and
 * opencode.json loads it anyway. That is how a session can lose 12 fixes and
 * still look healthy.
 *
 * This is the cheap pre-flight: no build, no writes, ~1s. Run it before trusting
 * a bundle, and after any checkout, pull, or release.
 *
 * What it proves: the bundle carries every ledger marker, the source would
 * reproduce them, and (when a staging record exists) the bundle is the one
 * staged from the checked-out commit. What it does NOT prove: that a fix
 * behaves correctly. Markers are strings; behavior is covered by the test
 * suites named in the fix reports. Never use this exit code as the only
 * activation gate.
 *
 * Exit codes: 0 = bundle is trustworthy, 1 = do not trust this bundle.
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, statSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, "..")
const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"))

const quiet = { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
const tryGit = (args) => {
  try {
    return execFileSync("git", args, quiet).trim()
  } catch {
    return ""
  }
}

let failures = 0
const ok = (m) => console.log(`  ok    ${m}`)
const bad = (m) => {
  failures += 1
  console.log(`  FAIL  ${m}`)
}

console.log("OMO bundle verification\n")

// ── 1. Are we on the branch that carries the fixes? ──────────────────────────
const branch = tryGit(["branch", "--show-current"]) || "(detached HEAD)"
const expected = manifest.bundleBranch
if (!expected) {
  ok(`branch: ${branch} (no bundleBranch pinned in the manifest)`)
} else if (branch !== expected) {
  bad(
    `on branch '${branch}', expected '${expected}'.\n` +
      `        The next build from here will DROP the local fixes.\n` +
      `        Fix:  git checkout ${expected}  &&  bun run fixes:apply`,
  )
} else {
  ok(`branch: ${branch}`)
}

// ── 2. Does the loaded bundle contain every fix? ─────────────────────────────
const bundleOverride = process.argv.slice(2).find((arg) => !arg.startsWith("--"))
const bundlePath = bundleOverride ?? join(repo, manifest.build.artifact)
if (bundleOverride) console.log(`  note  checking ${bundleOverride} instead of the live bundle`)
if (!existsSync(bundlePath)) {
  bad(`${bundleOverride ?? manifest.build.artifact} does not exist. Fix: bun run fixes:apply`)
} else {
  const bundle = readFileSync(bundlePath, "utf8")
  const mtime = statSync(bundlePath).mtime.toISOString().replace("T", " ").slice(0, 19)
  let missing = 0
  for (const fix of manifest.fixes) {
    const gone = (fix.markers || []).filter((marker) => !bundle.includes(marker))
    if (gone.length > 0) {
      missing += 1
      bad(`${fix.id}: missing from bundle -> ${gone.join(", ")}`)
    }
  }
  if (missing === 0) {
    ok(`all ${manifest.fixes.length} fixes present in ${manifest.build.artifact} (built ${mtime} UTC)`)
  } else {
    bad(`${missing} fix(es) missing from ${manifest.build.artifact}. Fix: bun run fixes:apply`)
  }
}

// ── 2b. Is this bundle the one staged from the checked-out commit? ───────────
// Markers cannot tell a bundle built here from one built elsewhere with extra
// fixes: a bundle whose source is not checked out loses them on the next rebuild.
// A bundle given on the command line is checked against the record beside it.
const stagedRoot = bundleOverride ? dirname(dirname(resolve(bundleOverride))) : join(repo, "..", `${basename(repo)}-staged`)
const lanePath = join(stagedRoot, "lane.json")
const stagedBundlePath = join(stagedRoot, "dist", "index.js")
const samePath = (a, b) => typeof a === "string" && typeof b === "string" && resolve(a).toLowerCase() === resolve(b).toLowerCase()
if (existsSync(bundlePath) && existsSync(lanePath)) {
  let lane = null
  try {
    lane = JSON.parse(readFileSync(lanePath, "utf8"))
  } catch {
    bad(`${lanePath} is not readable JSON. Fix: bun run fixes:apply`)
  }
  if (lane) {
    const bundleSha = createHash("sha256").update(readFileSync(bundlePath)).digest("hex")
    const head = tryGit(["rev-parse", "HEAD"])
    const checkingStaged = samePath(bundlePath, stagedBundlePath)
    if (checkingStaged || bundleSha === lane.stagedSha256) {
      if (bundleSha !== lane.stagedSha256) bad(`staged bundle is ${bundleSha.slice(0, 12)} but lane.json records ${String(lane.stagedSha256).slice(0, 12)}. Fix: stage it again`)
      else if (!samePath(lane.staged, stagedBundlePath)) bad(`lane.json names another staged bundle (${lane.staged}); it was staged for a different checkout. Fix: bun local-fixes/stage-bundle.mjs --target-checkout "${repo}" from the clone that built it`)
      else if (lane.commit !== head) bad(`the bundle was built from ${String(lane.commit).slice(0, 7)} but this checkout is at ${head.slice(0, 7)}; a rebuild here would not reproduce it.\n        Fix (OpenChamber closed): git fetch "${lane.source ?? "<the clone that staged it>"}" ${lane.branch}  &&  git merge --ff-only ${lane.commit}`)
      else if (lane.fixes !== manifest.fixes.length) bad(`lane.json records ${lane.fixes} fixes, the manifest has ${manifest.fixes.length}. Fix: bun run fixes:apply`)
      else ok(`bundle ${bundleSha.slice(0, 12)} is the build staged from the checked-out commit ${head.slice(0, 7)} (${lane.fixes} fixes)`)
    } else if (bundleOverride) {
      ok(`no staging record covers ${bundleOverride}; provenance not checked`)
    } else {
      ok(`live bundle ${bundleSha.slice(0, 12)} is not the staged build ${String(lane.stagedSha256).slice(0, 12)} (staged, not active)`)
    }
  }
} else if (existsSync(bundlePath)) {
  ok("no staging record beside this checkout; provenance not checked")
}

// ── 3. Would a rebuild keep them? (source carries the markers) ───────────────
let srcMissing = 0
for (const fix of manifest.fixes) {
  for (const marker of fix.markers || []) {
    const hit = tryGit(["grep", "-l", "-F", marker, "--", "packages/omo-opencode/src", "packages/utils/src", "packages/claude-code-compat-core/src"])
    if (!hit) {
      srcMissing += 1
      bad(`source tree is missing marker '${marker}' for ${fix.id}`)
    }
  }
}
if (srcMissing === 0) ok("source tree contains every marker (a rebuild would keep them)")

// ── 4. Are the fix commits reachable from HEAD? ──────────────────────────────
const unreachable = []
// A fix is safe to re-apply as long as its commit still EXISTS in this repo: apply.mjs
// cherry-picks by SHA, and the SHA does not have to be an ancestor of HEAD. Fix 05 is
// recorded as the PR-branch commit while this branch carries the cherry-picked twin.
const missingCommits = []
const notInHistory = []
for (const fix of manifest.fixes) {
  let exists = true
  try {
    execFileSync("git", ["cat-file", "-e", `${fix.commit}^{commit}`], quiet)
  } catch {
    exists = false
  }
  if (!exists) missingCommits.push(fix.id)

  let ancestor = true
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", fix.commit, "HEAD"], quiet)
  } catch {
    ancestor = false
  }
  if (!ancestor) notInHistory.push(fix.id)
}

if (missingCommits.length === 0) {
  ok("every fix commit exists in this repo (cherry-pick fallback is available)")
} else {
  bad(
    `commit(s) missing from the repo entirely: ${missingCommits.join(", ")}.\n` +
      `        Only the patch file can re-apply these now. Check that it still applies.`,
  )
}

if (notInHistory.length === 0) {
  ok("every fix commit is already in HEAD's history (nothing left to re-apply)")
} else {
  ok(
    `${notInHistory.length} fix commit(s) are not ancestors of HEAD but exist in the repo ` +
      `(${notInHistory.join(", ")}); apply.mjs resolves them by marker or cherry-pick.`,
  )
}

if (failures === 0) console.log("\n  note  markers and provenance only: behavior is proven by the test suites, not by this check")
console.log(
  failures === 0
    ? "\nBundle is trustworthy. Safe to use.\n"
    : `\n${failures} problem(s). Do NOT trust this bundle until they are resolved.\n`,
)

process.exit(failures === 0 ? 0 : 1)
