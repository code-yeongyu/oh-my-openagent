#!/usr/bin/env bun
// Version-scoped patch guard (refs #7546): every patches/*.patch pins one
// published npm version by file name, so each hunk must still apply to that
// exact tarball. Renaming a patch to a new version without rebasing its hunks
// used to re-apply changes that had already landed upstream and ship an
// invalid module. This script fails CI on any non-applying hunk and reports
// whether the fix is to drop an obsolete hunk or to rebase a conflicting one.

import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const PATCHES_DIR = "patches"

export type PatchTarget = {
  file: string
  name: string
  version: string
}

// Bun names version-scoped patches "<pkg>@<version>.patch" with "/" in scoped
// names percent-encoded, e.g. "@code-yeongyu%2Fsenpi@2026.8.31.patch".
export function parsePatchTarget(fileName: string): PatchTarget {
  if (!fileName.endsWith(".patch")) {
    throw new Error(`not a patch file: ${fileName}`)
  }
  const decoded = decodeURIComponent(fileName.slice(0, -".patch".length))
  const separator = decoded.lastIndexOf("@")
  const name = separator > 0 ? decoded.slice(0, separator) : ""
  const version = separator > 0 ? decoded.slice(separator + 1) : ""
  if (name.length === 0 || version.length === 0) {
    throw new Error(`patch file name must be "<pkg>@<version>.patch": ${fileName}`)
  }
  return { file: fileName, name, version }
}

export type SplitHunk = {
  header: string[]
  body: string[]
}

// Splits a unified diff into single-hunk patches. Each result keeps the header
// of its file section, so it is a valid standalone diff for git apply --check.
export function splitHunks(patchText: string): SplitHunk[] {
  const lines = patchText.split("\n")
  const hunks: SplitHunk[] = []
  let header: string[] = []
  let current: string[] | null = null
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      if (current !== null) hunks.push({ header, body: current })
      header = [line]
      current = null
      continue
    }
    if (line.startsWith("@@ ")) {
      if (current !== null) hunks.push({ header, body: current })
      current = [line]
      continue
    }
    if (current !== null) {
      current.push(line)
    } else {
      header.push(line)
    }
  }
  if (current !== null) hunks.push({ header, body: current })
  return hunks
}

export function hunkTargetPath(hunk: SplitHunk): string | null {
  const plusLine = hunk.header.find((line) => line.startsWith("+++ "))
  if (plusLine === undefined) return null
  const path = plusLine.slice("+++ ".length).trim()
  if (path === "/dev/null") return null
  return path.replace(/^b\//, "")
}

export type HunkVerdict = "applies" | "obsolete" | "conflict"

// A hunk that fails git apply --check is obsolete when the published package
// already carries its change: every added line exists upstream, or a
// removal-only hunk has nothing left to remove. Anything else is a conflict.
export function classifyHunk(hunk: SplitHunk, targetContent: string | null): HunkVerdict {
  const added: string[] = []
  const removed: string[] = []
  for (const line of hunk.body) {
    if (line.startsWith("+")) added.push(line.slice(1))
    else if (line.startsWith("-")) removed.push(line.slice(1))
  }
  if (targetContent !== null) {
    const targetLines = new Set(targetContent.split("\n").map((line) => line.trim()))
    if (added.length > 0 && added.every((line) => targetLines.has(line.trim()))) return "obsolete"
    if (added.length === 0 && removed.length > 0 && removed.every((line) => !targetLines.has(line.trim()))) {
      return "obsolete"
    }
  }
  return "conflict"
}

type Scratch = {
  scratchDir: string
  packageDir: string
}

async function fetchPublishedPackage(target: PatchTarget): Promise<Scratch> {
  const metaUrl = `https://registry.npmjs.org/${encodeURIComponent(target.name)}/${encodeURIComponent(target.version)}`
  const metaResponse = await fetch(metaUrl, { signal: AbortSignal.timeout(30_000) })
  if (!metaResponse.ok) {
    throw new Error(`registry lookup failed for ${target.name}@${target.version}: HTTP ${metaResponse.status}`)
  }
  const meta = (await metaResponse.json()) as { dist?: { tarball?: string } }
  const tarballUrl = meta.dist?.tarball
  if (typeof tarballUrl !== "string" || tarballUrl.length === 0) {
    throw new Error(`registry metadata for ${target.name}@${target.version} has no dist.tarball`)
  }
  const tarballResponse = await fetch(tarballUrl, { signal: AbortSignal.timeout(60_000) })
  if (!tarballResponse.ok) {
    throw new Error(`tarball download failed for ${target.name}@${target.version}: HTTP ${tarballResponse.status}`)
  }
  const scratchDir = mkdtempSync(join(tmpdir(), "omo-patch-hunks-"))
  const tgzPath = join(scratchDir, "package.tgz")
  await Bun.write(tgzPath, tarballResponse)
  const extract = Bun.spawnSync(["tar", "-xzf", tgzPath, "-C", scratchDir])
  if (extract.exitCode !== 0) {
    rmSync(scratchDir, { recursive: true, force: true })
    throw new Error(`tar extraction failed for ${target.name}@${target.version}: ${extract.stderr.toString().trim()}`)
  }
  return { scratchDir, packageDir: join(scratchDir, "package") }
}

function runGitApplyCheck(patchPath: string, cwd: string): { ok: boolean; stderr: string } {
  const proc = Bun.spawnSync(["git", "apply", "--check", patchPath], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  return { ok: proc.exitCode === 0, stderr: proc.stderr.toString().trim() }
}

function readPackageFile(packageDir: string, relativePath: string): string | null {
  try {
    return readFileSync(join(packageDir, relativePath), "utf8")
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
    throw error
  }
}

type HunkReport = {
  index: number
  range: string
  verdict: HunkVerdict
  stderr?: string
}

type PatchReport = {
  target: PatchTarget
  failed: boolean
  hunks: HunkReport[]
}

async function verifyPatch(patchPath: string, target: PatchTarget): Promise<PatchReport> {
  const report: PatchReport = { target, failed: false, hunks: [] }
  const { scratchDir, packageDir } = await fetchPublishedPackage(target)
  try {
    // Windows checkouts can hand us CRLF patch files; git apply and the
    // published (LF) sources both expect LF, so normalize before checking.
    const patchText = readFileSync(patchPath, "utf8").replace(/\r\n/g, "\n")
    const normalizedPath = join(scratchDir, "normalized.patch")
    await Bun.write(normalizedPath, patchText)
    if (runGitApplyCheck(normalizedPath, packageDir).ok) {
      console.log(`  all hunks apply to ${target.name}@${target.version}`)
      return report
    }
    const hunks = splitHunks(patchText)
    for (const [index, hunk] of hunks.entries()) {
      const range = hunk.body[0]?.split(" @@")[0]?.slice("@@ ".length) ?? `hunk ${index + 1}`
      const singlePath = join(scratchDir, `hunk-${index + 1}.patch`)
      const singleText = [...hunk.header, ...hunk.body].join("\n")
      // git apply rejects a hunk whose final line lacks a newline.
      await Bun.write(singlePath, singleText.endsWith("\n") ? singleText : `${singleText}\n`)
      const check = runGitApplyCheck(singlePath, packageDir)
      if (check.ok) {
        report.hunks.push({ index: index + 1, range, verdict: "applies" })
        continue
      }
      const targetPath = hunkTargetPath(hunk)
      const targetContent = targetPath === null ? null : readPackageFile(packageDir, targetPath)
      const verdict = classifyHunk(hunk, targetContent)
      report.hunks.push({ index: index + 1, range, verdict, stderr: check.stderr })
      report.failed = true
    }
    return report
  } finally {
    rmSync(scratchDir, { recursive: true, force: true })
  }
}

async function main(): Promise<number> {
  const patchFiles = readdirSync(PATCHES_DIR)
    .filter((file) => file.endsWith(".patch"))
    .sort()
  if (patchFiles.length === 0) {
    console.log("no version-scoped patches to verify")
    return 0
  }
  let failed = false
  for (const file of patchFiles) {
    const target = parsePatchTarget(file)
    console.log(`verifying ${join(PATCHES_DIR, file)} against ${target.name}@${target.version}`)
    const report = await verifyPatch(join(PATCHES_DIR, file), target)
    const annotationFile = join(PATCHES_DIR, file).replaceAll("\\", "/")
    for (const hunk of report.hunks) {
      console.log(`  hunk ${hunk.index} (${rangeLabel(hunk.range)}): ${hunk.verdict}`)
      if (hunk.verdict === "applies") continue
      failed = true
      const reason =
        hunk.verdict === "obsolete"
          ? "its change already exists upstream, drop the hunk and regenerate the patch"
          : "the published source moved on, rebase the hunk onto the pinned version"
      console.error(`::error file=${annotationFile}::hunk ${hunk.index} (${rangeLabel(hunk.range)}) does not apply: ${reason}`)
      if (hunk.stderr !== undefined && hunk.stderr.length > 0) console.error(hunk.stderr)
    }
  }
  if (failed) {
    console.error("patch verification failed: regenerate patches/ so every hunk applies to its published package (see issue #7546)")
    return 1
  }
  console.log(`patch verification passed: ${patchFiles.length} patch file(s), every hunk applies`)
  return 0
}

function rangeLabel(range: string): string {
  return range.length > 0 ? range : "?"
}

if (import.meta.main) {
  process.exitCode = await main()
}
