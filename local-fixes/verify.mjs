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
 * Exit codes: 0 = bundle is trustworthy, 1 = do not trust this bundle.
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
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

console.log(
  failures === 0
    ? "\nBundle is trustworthy. Safe to use.\n"
    : `\n${failures} problem(s). Do NOT trust this bundle until they are resolved.\n`,
)

process.exit(failures === 0 ? 0 : 1)
