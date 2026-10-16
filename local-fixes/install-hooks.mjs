#!/usr/bin/env bun
/**
 * Install the OMO post-checkout guard into .git/hooks.
 *
 *   bun run fixes:hooks
 *
 * .git/hooks is not versioned, so the hook lives in local-fixes/hooks/ and is
 * copied in from here. Re-run this after cloning the repo or after any OMO
 * update that replaces .git.
 *
 * The guard warns when you leave local/bundle-all, because that silently
 * disarms every local fix on the next build.
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, "..")

const git = (args) =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()

let gitDir
try {
  gitDir = git(["rev-parse", "--absolute-git-dir"])
} catch {
  console.error(`FAIL: ${repo} is not a git repository.`)
  process.exit(1)
}

// A configured core.hooksPath silently bypasses .git/hooks — refuse to pretend we installed it.
let hooksPath = ""
try {
  hooksPath = git(["config", "core.hooksPath"])
} catch {
  hooksPath = ""
}
if (hooksPath) {
  console.error(
    `FAIL: core.hooksPath is set to '${hooksPath}', so .git/hooks is ignored.\n` +
      `      Unset it (git config --unset core.hooksPath) or install the hook there instead.`,
  )
  process.exit(1)
}

const source = join(here, "hooks", "post-checkout")
const hooksDir = join(gitDir, "hooks")
const target = join(hooksDir, "post-checkout")

if (!existsSync(source)) {
  console.error(`FAIL: hook source not found at ${source}`)
  process.exit(1)
}
if (!existsSync(hooksDir)) mkdirSync(hooksDir, { recursive: true })

copyFileSync(source, target)
try {
  chmodSync(target, 0o755)
} catch {
  // Windows/git-bash may not honour chmod; git runs hooks regardless.
}

console.log(`Installed: ${target}`)
console.log("Guard active: leaving integration/opencode-v2 now prints a warning.")
console.log("Verify any time with:  bun run fixes:verify")
