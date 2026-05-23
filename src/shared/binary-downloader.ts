import { chmodSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import * as path from "node:path";
import { spawn } from "./bun-spawn-shim";
import { bunWrite } from "./bun-file-shim";
import { validateArchiveEntries, type ArchiveEntry } from "./archive-entry-validator";
import { extractZip } from "./zip-extractor";
import { readProcessStream } from "./process-stream-reader";

function isTarTraversalErrorOutput(output: string): boolean {
  return /path contains '\.\.'|member name contains '\.\.'|removing leading [`'\"]?\.\.\//i.test(output)
}

export function getCachedBinaryPath(cacheDir: string, binaryName: string): string | null {
  const binaryPath = path.join(cacheDir, binaryName);
  return existsSync(binaryPath) ? binaryPath : null;
}

export function ensureCacheDir(cacheDir: string): void {
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }
}

export async function downloadArchive(downloadUrl: string, archivePath: string): Promise<void> {
  const response = await fetch(downloadUrl, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  await bunWrite(archivePath, arrayBuffer);
}

export async function extractTarGz(
  archivePath: string,
  destDir: string,
  options?: { args?: string[]; cwd?: string }
): Promise<void> {
  const entries = await listTarEntries(archivePath, options?.cwd)
  validateArchiveEntries(entries, destDir)

  const args = options?.args ?? ["tar", "-xzf", archivePath, "-C", destDir];
  const proc = spawn(args, {
    cwd: options?.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    // #3919: Avoid Response(stream).text() in Windows Desktop utility processes.
    const stderr = await readProcessStream(proc.stderr);

    if (isTarTraversalErrorOutput(stderr)) {
      throw new Error(`Unsafe archive entry: path contains path traversal (${archivePath})`)
    }
    throw new Error(`tar extraction failed (exit ${exitCode}): ${stderr}`);
  }
}

export async function extractZipArchive(archivePath: string, destDir: string): Promise<void> {
  await extractZip(archivePath, destDir);
}

export function cleanupArchive(archivePath: string): void {
  if (existsSync(archivePath)) {
    unlinkSync(archivePath);
  }
}

export function ensureExecutable(binaryPath: string): void {
  if (process.platform !== "win32" && existsSync(binaryPath)) {
    chmodSync(binaryPath, 0o755);
  }
}

function parseTarEntry(line: string): ArchiveEntry | null {
  const match = line.match(/^([^\s])\S*\s+\d+\s+\S+\s+\S+\s+\d+\s+\w+\s+\d+\s+(?:\d{2}:\d{2}|\d{4})\s+(.*)$/)
  if (!match) {
    return null
  }

  const [, rawType, rawEntryPath] = match
  if (rawType === "l" || rawType === "h") {
    const arrowIndex = rawEntryPath.lastIndexOf(" -> ")
    if (arrowIndex === -1) {
      return { path: rawEntryPath, type: rawType === "l" ? "symlink" : "hardlink" }
    }

    return {
      path: rawEntryPath.slice(0, arrowIndex),
      type: rawType === "l" ? "symlink" : "hardlink",
      linkPath: rawEntryPath.slice(arrowIndex + 4),
    }
  }

  return {
    path: rawEntryPath,
    type: rawType === "d" ? "directory" : "file",
  }
}

async function listTarEntries(archivePath: string, cwd?: string): Promise<ArchiveEntry[]> {
  const proc = spawn(["tar", "-tvzf", archivePath], {
    cwd,
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

  return stdout
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => parseTarEntry(line))
    .filter((entry): entry is ArchiveEntry => entry !== null)
}
