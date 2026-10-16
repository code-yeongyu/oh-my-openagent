#!/usr/bin/env node
// Disposable-clone orchestration. Recovery is explicit, never automatic or live.
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, "..")
const git = (args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", timeout: 30_000 }).trim()
const journal = resolve(git(["rev-parse", "--absolute-git-dir"]), "omo-promotion-run.json")
const run = (script, args = []) => execFileSync("bun", [resolve(here, script), ...args], {
  cwd: repo, stdio: "inherit", timeout: 110_000,
})
const abort = process.argv.includes("--abort")
// Real clone only; shared worktrees and any arbitrary checkout are prohibited.
if (!existsSync(resolve(repo, ".git/config")) || !/[/\\]Temp[/\\]opencode[/\\]omo-v5134-build-[^/\\]+$/i.test(repo)) {
  throw new Error("Refusing: not an isolated omo-v5134-build clone under Temp/opencode")
}
if (abort) {
  const receipt = JSON.parse(readFileSync(journal, "utf8"))
  if (receipt.repo !== repo || receipt.branch !== git(["branch", "--show-current"])) throw new Error("Recovery checkout mismatch")
  try { git(["cherry-pick", "--abort"]) } catch {}
  git(["reset", "--hard", receipt.startHead])
  // Never clean unknown untracked files. Any leftovers remain visible for inspection.
  const status = git(["status", "--porcelain"])
  if (status) throw new Error(`Tracked baseline restored; inspect preserved leftovers before retry:\n${status}`)
  unlinkSync(journal)
  console.log(`PASS explicitly restored disposable clone to ${receipt.startHead}`)
  process.exit(0)
}
if (existsSync(journal)) throw new Error("Previous run unresolved: inspect journal, then explicitly run promote-clone.mjs --abort")
if (git(["status", "--porcelain"])) throw new Error("Promotion requires a completely clean clone, including generated paths")
const targetIndex = process.argv.indexOf("--target-checkout")
const target = targetIndex >= 0 ? process.argv[targetIndex + 1] : null
if (targetIndex >= 0 && !target) throw new Error("Missing --target-checkout value")
run("check-lineage.mjs")
const receipt = { repo, branch: git(["branch", "--show-current"]), startHead: git(["rev-parse", "HEAD"]), startedUtc: new Date().toISOString() }
writeFileSync(journal, JSON.stringify(receipt, null, 2) + "\n")
try {
  run("apply.mjs")
  run("verify.mjs", [repo + "-staged/dist/index.js"])
  if (target) {
    // Deliberate second gate: explicit target staging, never implicit clone-sibling staging.
    run("stage-bundle.mjs", ["--target-checkout", target])
    run("verify.mjs", [resolve(target) + "-staged/dist/index.js"])
  }
  unlinkSync(journal)
} catch (error) {
  console.error(`FAILED WHOLE RUN. Earlier picks/staging may remain. No activation performed.\nReceipt: ${journal}\nInspect first; explicit clone-only recovery: bun local-fixes/promote-clone.mjs --abort`)
  process.exit(1)
}
