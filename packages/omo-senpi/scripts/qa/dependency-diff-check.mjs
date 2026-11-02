#!/usr/bin/env bun
// Supply-chain control over a range of commits (plan .omo/plans/kibitzer-resident-sidecar.md: "No new
// npm dependencies", checked by the final scope-fidelity step): compares EVERY package manifest and
// lockfile tracked at --base and at --head and exits 0 only when no dependency entry was ADDED. A
// version bump or a removal is reported and counted but never fails - the control guards the SET of
// things the repository depends on, not their versions. Test-only: it emits no production diagnostic.
//
//   bun packages/omo-senpi/scripts/qa/dependency-diff-check.mjs --base <rev> --head <rev> [--repo <dir>] [--evidence-dir <dir>]
//
// Files (by basename, anywhere in the tree except under node_modules): package.json, bun.lock,
// package-lock.json / npm-shrinkwrap.json, yarn.lock, pnpm-lock.yaml - see dependency-diff-parsers.mjs
// for what counts as one entry in each. A manifest that exists only at head contributes every entry
// as added (a new package with dependencies IS new dependencies); one that exists only at base
// contributes removals. A binary bun.lockb or a file the parser cannot read is `unverifiable`: when
// such a file changed, the verdict is red too, because the control cannot then promise anything.
//
// Exit 0 = no added entry; 1 = an added entry (each named on stdout) or an unverifiable change;
// 2 = usage or git error. The last stdout line is a JSON summary; --evidence-dir receives
// dependency-diff.json with every file's added / changed / removed entries and both blob hashes.
import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { entriesOf, manifestKind } from "./dependency-diff-parsers.mjs"

export const DRIVER = "dependency-diff-check"
export const EXIT_CLEAN = 0
export const EXIT_ADDED = 1
export const EXIT_USAGE = 2
const GIT_MAX_BUFFER = 256 * 1024 * 1024

const scriptDir = fileURLToPath(new URL(".", import.meta.url))
const defaultRepo = resolve(scriptDir, "..", "..", "..", "..")

export function parseArgs(argv) {
  const options = { base: undefined, head: undefined, repo: defaultRepo, evidenceDir: undefined, selfTest: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const take = () => {
      const value = argv[index + 1]
      if (value === undefined) throw new Error(`missing value for ${arg}`)
      index += 1
      return value
    }
    if (arg === "--base") options.base = take()
    else if (arg === "--head") options.head = take()
    else if (arg === "--repo") options.repo = resolve(take())
    else if (arg === "--evidence-dir") options.evidenceDir = resolve(take())
    else if (arg === "--self-test") options.selfTest = true
    else throw new Error(`unknown argument ${arg}`)
  }
  if (options.selfTest) return options
  if (options.base === undefined || options.head === undefined) throw new Error("--base <rev> and --head <rev> are required")
  return options
}

export function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: GIT_MAX_BUFFER, stdio: ["ignore", "pipe", "pipe"] })
}

export function resolveCommit(repo, rev) {
  return git(repo, ["rev-parse", "--verify", "--end-of-options", `${rev}^{commit}`]).trim()
}

/** `path -> blob` for every manifest/lockfile tracked at `sha`. */
export function listManifests(repo, sha) {
  const files = new Map()
  for (const record of git(repo, ["ls-tree", "-r", "-z", sha]).split("\0")) {
    if (record.length === 0) continue
    const tab = record.indexOf("\t")
    const [, type, blob] = record.slice(0, tab).split(" ")
    const path = record.slice(tab + 1)
    if (type === "blob" && manifestKind(path) !== undefined) files.set(path, blob)
  }
  return files
}

/** `undefined` when the file is opaque or unreadable; the caller records the failure reason. */
function readEntries(repo, path, blob, kind) {
  if (kind === "opaque") return { entries: undefined, reason: "binary lockfile" }
  try {
    return { entries: entriesOf(kind, git(repo, ["cat-file", "blob", blob])), reason: undefined }
  } catch (error) {
    return { entries: undefined, reason: error instanceof Error ? error.message : String(error) }
  }
}

export function diffEntries(base, head) {
  const added = []
  const removed = []
  const changed = []
  for (const [key, value] of head) {
    if (!base.has(key)) added.push({ key, value })
    else if (base.get(key) !== value) changed.push({ key, from: base.get(key), to: value })
  }
  for (const [key, value] of base) if (!head.has(key)) removed.push({ key, value })
  const byKey = (left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0)
  return { added: added.sort(byKey), removed: removed.sort(byKey), changed: changed.sort(byKey) }
}

/** One file's verdict between two blobs (either may be absent). */
export function compareFile(path, baseBlob, headBlob, read) {
  const kind = manifestKind(path)
  const status = baseBlob === undefined ? "added" : headBlob === undefined ? "deleted" : baseBlob === headBlob ? "unchanged" : "modified"
  const file = { path, kind, status, baseBlob, headBlob, added: [], removed: [], changed: [], unverifiable: undefined }
  if (status === "unchanged") return file
  const base = baseBlob === undefined ? { entries: new Map(), reason: undefined } : read(path, baseBlob, kind)
  const head = headBlob === undefined ? { entries: new Map(), reason: undefined } : read(path, headBlob, kind)
  if (base.entries === undefined || head.entries === undefined) {
    file.unverifiable = base.entries === undefined ? `base: ${base.reason}` : `head: ${head.reason}`
    return file
  }
  return { ...file, ...diffEntries(base.entries, head.entries) }
}

export function compareRange(repo, baseSha, headSha, read = (path, blob, kind) => readEntries(repo, path, blob, kind)) {
  const baseFiles = listManifests(repo, baseSha)
  const headFiles = listManifests(repo, headSha)
  const paths = [...new Set([...baseFiles.keys(), ...headFiles.keys()])].sort()
  const files = paths.map((path) => compareFile(path, baseFiles.get(path), headFiles.get(path), read))
  const added = files.flatMap((file) => file.added.map((entry) => ({ path: file.path, ...entry })))
  const unverifiable = files.filter((file) => file.unverifiable !== undefined).map((file) => ({ path: file.path, reason: file.unverifiable }))
  return {
    ok: added.length === 0 && unverifiable.length === 0,
    driver: DRIVER,
    repo,
    base: baseSha,
    head: headSha,
    files,
    totals: {
      files: files.length,
      unchanged: files.filter((file) => file.status === "unchanged").length,
      modified: files.filter((file) => file.status === "modified").length,
      addedFiles: files.filter((file) => file.status === "added").length,
      deletedFiles: files.filter((file) => file.status === "deleted").length,
      added: added.length,
      changed: files.reduce((sum, file) => sum + file.changed.length, 0),
      removed: files.reduce((sum, file) => sum + file.removed.length, 0),
    },
    added,
    unverifiable,
  }
}

function printReport(report) {
  for (const file of report.files) {
    if (file.status === "unchanged") continue
    if (file.unverifiable !== undefined) { console.log(`FAIL ${file.path} :: ${file.status}, unverifiable (${file.unverifiable})`); continue }
    const line = `${file.status}, +${file.added.length} added, ~${file.changed.length} changed, -${file.removed.length} removed`
    console.log(`${file.added.length === 0 ? "PASS" : "FAIL"} ${file.path} :: ${line}`)
    for (const entry of file.added) console.log(`  ADDED ${file.path} :: ${entry.key} = ${entry.value}`)
  }
  console.log(`unchanged: ${report.totals.unchanged} of ${report.totals.files} manifest/lockfile paths`)
}

async function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`${DRIVER}: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(EXIT_USAGE)
  }
  if (options.selfTest) { runSelfTest(); return }
  let report
  try {
    const base = resolveCommit(options.repo, options.base)
    const head = resolveCommit(options.repo, options.head)
    report = { ...compareRange(options.repo, base, head), refs: { base: options.base, head: options.head } }
  } catch (error) {
    console.error(`${DRIVER}: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(EXIT_USAGE)
  }
  printReport(report)
  let evidence
  if (options.evidenceDir !== undefined) {
    mkdirSync(options.evidenceDir, { recursive: true })
    evidence = join(options.evidenceDir, "dependency-diff.json")
    writeFileSync(evidence, `${JSON.stringify(report, null, 2)}\n`)
    console.log(`evidence: ${evidence}`)
  }
  const exitCode = report.ok ? EXIT_CLEAN : EXIT_ADDED
  console.log(JSON.stringify({
    ok: report.ok,
    driver: DRIVER,
    base: report.base,
    head: report.head,
    totals: report.totals,
    added: report.added.map((entry) => `${entry.path}:${entry.key}`),
    unverifiable: report.unverifiable,
    exitCode,
    ...(evidence === undefined ? {} : { evidence }),
  }))
  process.exit(exitCode)
}

function runSelfTest() {
  const read = (fixtures) => (path, blob) => ({ entries: entriesOf(manifestKind(path), fixtures[blob]), reason: undefined })
  const bump = compareFile("package.json", "a", "b", read({
    a: '{"dependencies":{"zod":"^4.0.0"},"devDependencies":{"typescript":"^5"}}',
    b: '{"dependencies":{"zod":"^4.4.3"}}',
  }))
  if (bump.added.length !== 0 || bump.changed.length !== 1 || bump.removed.length !== 1) throw new Error(`self-test: bump ${JSON.stringify(bump)}`)
  const added = compareFile("packages/x/package.json", "a", "b", read({
    a: '{"dependencies":{"zod":"^4.0.0"}}',
    b: '{"dependencies":{"zod":"^4.0.0","left-pad":"1.3.0"}}',
  }))
  if (added.added.map((entry) => entry.key).join() !== "dependencies:left-pad") throw new Error("self-test: an added dependency is named")
  const lock = compareFile("bun.lock", "a", "b", read({
    a: '{ "workspaces": { "": { "dependencies": { "zod": "^4.0.0", }, }, }, "packages": { "zod": ["zod@4.0.0", "", {}, "sha512-a"], }, }',
    b: '{ "workspaces": { "": { "dependencies": { "zod": "^4.4.3", }, }, }, "packages": { "zod": ["zod@4.4.3", "", {}, "sha512-b"], "left-pad": ["left-pad@1.3.0", "", {}, "sha512-c"], }, }',
  }))
  if (lock.added.map((entry) => entry.key).join() !== "packages:left-pad" || lock.changed.length !== 2) throw new Error(`self-test: bun.lock ${JSON.stringify(lock)}`)
  const yarn = compareFile("yarn.lock", "a", "b", read({
    a: '# yarn lockfile v1\n\n"@scope/a@^1.0.0", "@scope/a@^1.1.0":\n  version "1.1.0"\n',
    b: '# yarn lockfile v1\n\n"@scope/a@^1.2.0":\n  version "1.2.0"\n\nb@^2.0.0:\n  version "2.0.0"\n',
  }))
  if (yarn.added.map((entry) => entry.key).join() !== "packages:b" || yarn.changed[0]?.key !== "packages:@scope/a") throw new Error(`self-test: yarn ${JSON.stringify(yarn)}`)
  const pnpm = compareFile("pnpm-lock.yaml", "a", "b", read({
    a: "lockfileVersion: '9.0'\n\npackages:\n\n  '@scope/a@1.1.0':\n    resolution: {integrity: x}\n",
    b: "lockfileVersion: '9.0'\n\npackages:\n\n  '@scope/a@1.2.0':\n    resolution: {integrity: x}\n\n  b@2.0.0(peer@1):\n    resolution: {integrity: y}\n",
  }))
  if (pnpm.added.map((entry) => entry.key).join() !== "packages/b" || pnpm.changed[0]?.key !== "packages/@scope/a") throw new Error(`self-test: pnpm ${JSON.stringify(pnpm)}`)
  const opaque = compareFile("bun.lockb", "a", "b", () => ({ entries: undefined, reason: "binary lockfile" }))
  if (opaque.unverifiable !== "base: binary lockfile") throw new Error("self-test: an opaque change is unverifiable")
  if (compareFile("package.json", "same", "same", () => { throw new Error("must not read an unchanged file") }).status !== "unchanged") throw new Error("self-test: unchanged")
  for (const bad of [["--base", "a"], ["--head", "b"], ["--base"], ["--nope"]]) {
    let rejected = false
    try { parseArgs(bad) } catch { rejected = true }
    if (!rejected) throw new Error(`self-test: ${bad.join(" ")} must be rejected`)
  }
  console.log(JSON.stringify({ ok: true, driver: DRIVER, selfTest: true }))
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
