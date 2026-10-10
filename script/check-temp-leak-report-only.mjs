#!/usr/bin/env node
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

// test-temp-leak-report-only.json names the test temp entries that are still reported instead of
// failing the run (#9766). It exists to be emptied: a change may remove entries, never add them. A
// new leak is fixed where it is created, not listed.
export const REPORT_ONLY_LIST_PATH = "test-temp-leak-report-only.json"

/**
 * Owner/prefix pairs present in `head` but not in `base`. Both are the parsed list: owner -> prefixes.
 * @param {Record<string, readonly string[]>} base
 * @param {Record<string, readonly string[]>} head
 * @returns {string[]}
 */
export function addedReportOnlyEntries(base, head) {
  const added = []
  for (const [owner, prefixes] of Object.entries(head)) {
    const baseEntries = base[owner] ?? []
    for (const prefix of prefixes) {
      if (baseEntries.includes(prefix) || narrowsBaseEntry(prefix, baseEntries)) continue
      added.push(`${owner}: ${prefix}`)
    }
  }
  return added.sort()
}

// Replacing a broad prefix with the narrower names under it ("omo-test-" -> "omo-test-session-manager-")
// only shrinks what is report-only, so it is not an addition. Same rule as test-temp-leak-match.ts.
function narrowsBaseEntry(entry, baseEntries) {
  const name = entry.endsWith("$") ? entry.slice(0, -1) : entry
  return baseEntries.some((baseEntry) => !baseEntry.endsWith("$") && name.startsWith(baseEntry))
}

function existsAtBase(baseSha) {
  try {
    execFileSync("git", ["cat-file", "-e", `${baseSha}:${REPORT_ONLY_LIST_PATH}`], { stdio: "ignore" })
    return true
  } catch {
    // A missing commit fails too; `git show` below then reports it instead of reading it as "new file".
    execFileSync("git", ["cat-file", "-e", `${baseSha}^{commit}`], { stdio: "ignore" })
    return false
  }
}

function readBaseList(baseSha) {
  if (!existsAtBase(baseSha)) return undefined
  return JSON.parse(execFileSync("git", ["show", `${baseSha}:${REPORT_ONLY_LIST_PATH}`], { encoding: "utf8" }))
}

function main() {
  const baseSha = process.argv[2]
  if (!baseSha) throw new Error("usage: check-temp-leak-report-only.mjs <base-sha>")
  const base = readBaseList(baseSha)
  if (base === undefined) {
    console.log(`${REPORT_ONLY_LIST_PATH} is new at this change; nothing to compare.`)
    return
  }
  const head = JSON.parse(readFileSync(REPORT_ONLY_LIST_PATH, "utf8"))
  const added = addedReportOnlyEntries(base, head)
  if (added.length === 0) {
    console.log(`${REPORT_ONLY_LIST_PATH}: no entries added since ${baseSha.slice(0, 10)}.`)
    return
  }
  console.error(`${REPORT_ONLY_LIST_PATH} may only shrink (#9766). Remove the temp dirs these tests leave instead of listing them:`)
  for (const entry of added) console.error(`  ${entry}`)
  process.exitCode = 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
