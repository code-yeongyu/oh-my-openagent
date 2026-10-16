#!/usr/bin/env bun
/**
 * Applies every local OMO fix we own, rebuilds dist, and verifies the result.
 *
 *   bun run fixes:apply            apply the fixes, then STAGE the bundle beside the checkout
 *   bun run fixes:apply --live     apply the fixes, then rebuild dist/ in place (offline only)
 *
 * OpenCode v2 watches dist/index.js. Rebuilding it under a running backend unloads every
 * plugin ordered after this one and fails Claude sessions that are mid-loop, so the default
 * never touches the live bundle: it stages one (stage-bundle.mjs) for activate-staged.ps1 to
 * swap in during the owner's restart. --live refuses to run while OpenChamber/opencode is up.
 *
 * Run this after every OMO update (pull / new release) before using the bundle.
 * Safe to run repeatedly: fixes already in history are skipped.
 * A failed run can retain earlier picks. Use promote-clone.mjs for preflight and explicit clone recovery.
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, "..")
const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"))

// `bun run build` regenerates these tracked files, so they are permanently "modified" in any
// healthy checkout. They must not block the run, and they must never ride along in a commit.
const GENERATED_PATHS = [
  "packages/omo-senpi/plugin/extensions/",
  "packages/omo-senpi/plugin/scripts/install.mjs",
  "packages/omo-codex/scripts/install-dist/",
  "packages/omo-senpi/plugin/runtime/",
]
const isGenerated = (line) => GENERATED_PATHS.some((prefix) => line.slice(3).startsWith(prefix))

const quiet = { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
const git = (args) => execFileSync("git", args, quiet).trim()

/**
 * Is this fix already present in the source tree?
 *
 * Git history is NOT a reliable test: the same fix exists under several SHAs (the original
 * commit, the variant ported onto a newer base, and any cherry-pick of either), so
 * `merge-base --is-ancestor` reports "missing" for an equivalent change and the applier would
 * try to re-apply it. Marker strings in the source are SHA-independent, so ask the code.
 */
function fixAlreadyPresent(fix) {
  const markers = fix.markers || []
  if (markers.length === 0) return false
  return markers.every((marker) => {
    try {
      return git(["grep", "-l", "-F", marker, "--", "packages/omo-opencode/src", "packages/utils/src", "packages/claude-code-compat-core/src"]).length > 0
    } catch {
      return false
    }
  })
}

function fail(message, code) {
  console.error("\n" + message)
  process.exit(code)
}

// ── 1. Preconditions ─────────────────────────────────────────────────────────
try {
  git(["rev-parse", "--is-inside-work-tree"])
} catch {
  fail(`FAIL: ${repo} is not a git repository.`, 1)
}

// Not via git(): its trim() would eat the leading space of the first porcelain line
// (" M path" -> "M path"), shifting slice(3) in isGenerated() off the path.
const dirty = execFileSync("git", ["status", "--porcelain"], quiet)
  .split("\n")
  .filter((line) => line.trim().length > 0)
  .filter((line) => !isGenerated(line))

if (dirty.length > 0) {
  fail(
    "FAIL: the working tree has changes beyond the known generated bundles.\n" +
      "      Commit or stash them, then re-run. Refusing to apply on top of real work.\n\n" +
      dirty.join("\n"),
    1,
  )
}

console.log(`Repo:   ${repo}`)
console.log(`Fixes:  ${manifest.fixes.length}`)
console.log(`Bundle: ${manifest.build.artifact}\n`)

// ── 2. Apply the fixes in order ──────────────────────────────────────────────
const results = []

for (const fix of manifest.fixes) {
  let inHistory = false
  try {
    git(["merge-base", "--is-ancestor", fix.commit, "HEAD"])
    inHistory = true
  } catch {
    inHistory = false
  }

  if (inHistory) {
    results.push([fix.id, "already applied"])
    continue
  }

  if (fixAlreadyPresent(fix)) {
    results.push([fix.id, "already applied (equivalent change under a different commit)"])
    continue
  }

  try {
    // cherry-pick commits exactly the picked change; unrelated dirty files stay untouched
    git(["cherry-pick", "-x", fix.commit])
    results.push([fix.id, "applied"])
    continue
  } catch {
    try {
      git(["cherry-pick", "--abort"])
    } catch {}
  }

  const patchPath = join(here, fix.patch)
  if (existsSync(patchPath)) {
    const touched = [
      ...new Set(
        readFileSync(patchPath, "utf8")
          .split("\n")
          .filter((line) => line.startsWith("+++ b/"))
          .map((line) => line.slice(6).trim()),
      ),
    ].filter((path) => path.length > 0 && path !== "/dev/null")

    try {
      git(["apply", "--3way", patchPath])
      if (touched.length > 0) git(["add", "--", ...touched])
      git(["commit", "-m", `fix(local): ${fix.title} [${fix.id}]`, "--no-verify"])
      results.push([fix.id, "applied from patch"])
      continue
    } catch {
      // Preserve the failed index/worktree for explicit disposable-clone recovery.
    }
  }

  fail(
    [
      "",
      `CONFLICT: ${fix.id} — ${fix.title}`,
      `  commit: ${fix.commit}`,
      `  patch:  ${fix.patch}`,
      `  pr:     ${fix.pr}`,
      "",
      "  A new OMO release changed the same code. Earlier successful picks can remain.",
      "  Inspect the index/worktree; use promote-clone.mjs --abort only in the disposable clone.",
      "",
      "  Do NOT improvise, do NOT skip it, do NOT hand-edit generated bundles.",
      "  Escalate with this exact output: manifest.json lists the fix and its PR.",
      "",
    ].join("\n"),
    2,
  )
}

// ── 3. Rebuild ───────────────────────────────────────────────────────────────
console.log(results.map(([id, state]) => `${id.padEnd(34)} ${state}`).join("\n"))

if (!process.argv.includes("--live")) {
  console.log("\nApplying complete; staging the bundle beside the checkout (live dist/ is not touched)…\n")
  try {
    execFileSync("bun", [join(here, "stage-bundle.mjs")], { cwd: repo, stdio: "inherit" })
  } catch {
    fail("FAIL: staging failed. Nothing was activated; the live bundle is unchanged.", 3)
  }
  process.exit(0)
}

let harnessRunning = ""
try {
  harnessRunning = execFileSync("tasklist", ["/FO", "CSV", "/NH"], quiet)
    .split("\n")
    .filter((line) => /^"(OpenChamber|opencode)\.exe"/i.test(line))
    .map((line) => line.split(",")[0])
    .join(", ")
} catch {}
if (harnessRunning && !process.argv.includes("--force")) {
  fail(
    "FAIL: --live rebuilds dist/index.js in place, and OpenChamber/opencode is running (" + harnessRunning + ").\n" +
      "      That unloads every plugin ordered after OMO and fails running Claude sessions.\n" +
      "      Quit OpenChamber fully, or drop --live to stage the bundle instead.",
    6,
  )
}
console.log("\nApplying complete; building…\n")

try {
  execFileSync("bun", ["run", "build"], { cwd: repo, stdio: "inherit" })
} catch {
  fail("FAIL: `bun run build` failed. The bundle was NOT updated. Fix the build before using it.", 3)
}

// ── 4. Verify the bundle actually contains every fix ─────────────────────────
const bundlePath = join(repo, manifest.build.artifact)
if (!existsSync(bundlePath)) {
  fail(`FAIL: ${manifest.build.artifact} was not produced by the build.`, 4)
}
const bundle = readFileSync(bundlePath, "utf8")

let missingCount = 0
const report = []
for (const fix of manifest.fixes) {
  const missing = (fix.markers || []).filter((marker) => !bundle.includes(marker))
  if (missing.length > 0) missingCount += 1
  report.push(`${fix.id.padEnd(34)} ${missing.length === 0 ? "ok" : "MISSING: " + missing.join(", ")}`)
}

console.log(`\nBundle verification (${manifest.build.artifact}):`)
console.log(report.join("\n"))

if (missingCount > 0) {
  fail(`\nFAIL: ${missingCount} fix(es) are missing from the bundle. Do not restart on this build.`, 5)
}

console.log(
  `\nAll ${manifest.fixes.length} local fixes are applied and verified in ${manifest.build.artifact}.`,
)
console.log("Restart OpenChamber to load it.")
