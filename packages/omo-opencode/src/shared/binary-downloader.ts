import { chmodSync, existsSync, mkdirSync, unlinkSync } from "node:fs"
import * as path from "node:path"
import { spawn } from "./bun-spawn-shim"
import { bunWrite } from "./bun-file-shim"
import { validateArchiveEntries, type ArchiveEntry } from "./archive-entry-validator"
import { extractZip } from "./zip-extractor"
import { readProcessStream } from "./process-stream-reader"

function isTarTraversalErrorOutput(output: string): boolean {
  return /path contains '\.\.'|member name contains '\.\.'|removing leading [`'\"]?\.\.\//i.test(output)
}

export function getCachedBinaryPath(cacheDir: string, binaryName: string): string | null {
  const binaryPath = path.join(cacheDir, binaryName)
  return existsSync(binaryPath) ? binaryPath : null
}

export function ensureCacheDir(cacheDir: string): void {
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true })
  }
}

export async function downloadArchive(downloadUrl: string, archivePath: string): Promise<void> {
  const response = await fetch(downloadUrl, { redirect: "follow" })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  await bunWrite(archivePath, arrayBuffer)
}

export async function extractTarGz(
  archivePath: string,
  destDir: string,
  options?: { args?: string[]; cwd?: string },
): Promise<void> {
  const entries = await listTarEntries(archivePath, options?.cwd)
  validateArchiveEntries(entries, destDir)

  const args = options?.args ?? ["tar", "-xzf", archivePath, "-C", destDir]
  const proc = spawn(args, {
    cwd: options?.cwd,
    env: tarSpawnEnv(),
    stdout: "pipe",
    stderr: "pipe",
  })

  const exitCode = await proc.exited
  if (exitCode !== 0) {
    // #3919: Avoid Response(stream).text() in Windows Desktop utility processes.
    const stderr = await readProcessStream(proc.stderr)

    if (isTarTraversalErrorOutput(stderr)) {
      throw new Error(`Unsafe archive entry: path contains path traversal (${archivePath})`)
    }
    throw new Error(`tar extraction failed (exit ${exitCode}): ${stderr}`)
  }
}

export async function extractZipArchive(archivePath: string, destDir: string): Promise<void> {
  await extractZip(archivePath, destDir)
}

export function cleanupArchive(archivePath: string): void {
  if (existsSync(archivePath)) {
    unlinkSync(archivePath)
  }
}

export function ensureExecutable(binaryPath: string): void {
  if (process.platform !== "win32" && existsSync(binaryPath)) {
    chmodSync(binaryPath, 0o755)
  }
}

// bsdtar: "mode links owner group size date path", with the month in the system locale, before the day
// on Windows and in locale order on macOS, sometimes as two words ("10-р сар", "تشرين الأول"). The day-first
// form is tried first and the second month word only when needed, so a path that starts with a year or a
// time stays whole.
const BSDTAR_LISTING_LINE =
  /^([^\s])\S*\s+\d+\s+\S+\s+\S+\s+\d+\s+(?:\d+\s+\S+(?:\s+\S+)??|\S+(?:\s+\S+)??\s+\d+)\s+(?:\d{2}:\d{2}|\d{4})\s+(.*)$/
// GNU tar: "mode owner/group size YYYY-MM-DD HH:MM path".
const GNU_TAR_LISTING_LINE = /^([^\s])\S*\s+\S+\/\S+\s+\d+\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?\s+(.*)$/

function parseTarEntry(line: string): ArchiveEntry | null {
  const match = line.match(BSDTAR_LISTING_LINE) ?? line.match(GNU_TAR_LISTING_LINE)
  if (!match) {
    return null
  }

  const [, rawType, rawEntryPath] = match
  if (rawType === "l" || rawType === "h") {
    // Both tars list a hard link as "path link to target".
    const separator = rawType === "h" && rawEntryPath.includes(" link to ") ? " link to " : " -> "
    const separatorIndex = rawEntryPath.lastIndexOf(separator)
    if (separatorIndex === -1) {
      return { path: rawEntryPath, type: rawType === "l" ? "symlink" : "hardlink" }
    }
    // A path or target that contains the separator makes the split ambiguous, so the line stays unparsed.
    if (rawEntryPath.indexOf(separator) !== separatorIndex) {
      return null
    }

    return {
      path: rawEntryPath.slice(0, separatorIndex),
      type: rawType === "l" ? "symlink" : "hardlink",
      linkPath: rawEntryPath.slice(separatorIndex + separator.length),
    }
  }

  return {
    path: rawEntryPath,
    type: rawType === "d" ? "directory" : "file",
  }
}

function tarSpawnEnv(): NodeJS.ProcessEnv {
  // GNU tar reads extra options from TAR_OPTIONS (--block-number prefixes every listing line) and
  // translates " link to " in the message locale, so both tar spawns pin only the categories the
  // listing parser depends on (LC_TIME for the date column, LC_MESSAGES for GNU's wording) and drop
  // TAR_OPTIONS. LC_ALL is deliberately not pinned: under it bsdtar prints non-ASCII entry names as
  // backslash escapes, which the validator reads as path separators, so a valid archive with an
  // entry like 한.txt is refused (#9790). bsdtar ignores these variables; Windows bsdtar keeps the
  // system locale regardless, hence the localized date forms parsed above. The extraction must run
  // under exactly the environment that produced the validated listing, so it builds the same env
  // instead of inheriting the startup one.
  const env: NodeJS.ProcessEnv = { ...process.env, LC_TIME: "C", LC_MESSAGES: "C" }
  delete env.TAR_OPTIONS
  return env
}

async function listTarEntries(archivePath: string, cwd?: string): Promise<ArchiveEntry[]> {
  // Owner and group names are stored as-is and can contain spaces, so both tars list them as numbers.
  const proc = spawn(["tar", "--numeric-owner", "-tvzf", archivePath], {
    cwd,
    env: tarSpawnEnv(),
    stdout: "pipe",
    stderr: "pipe",
  })

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    // #3919: Use Buffer-concat stream reads for Node utility-process compatibility.
    readProcessStream(proc.stdout),
    readProcessStream(proc.stderr),
  ])

  if (isTarTraversalErrorOutput(stderr)) {
    throw new Error(`Unsafe archive entry: path contains path traversal (${archivePath})`)
  }

  if (exitCode !== 0) {
    throw new Error(`tar entry listing failed (exit ${exitCode}): ${stderr}`)
  }

  const listingLines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const entries: ArchiveEntry[] = []
  let unparsedLineCount = 0
  for (const listingLine of listingLines) {
    const entry = parseTarEntry(listingLine)
    if (entry === null) {
      unparsedLineCount += 1
    } else {
      entries.push(entry)
    }
  }

  // An unparsed line would reach extraction without validation, so fail closed like the ZIP listing path.
  if (unparsedLineCount > 0) {
    throw new Error(
      `tar entry listing failed: ${unparsedLineCount}/${listingLines.length} tar listing lines could not be parsed (fail-closed)`,
    )
  }

  return entries
}
