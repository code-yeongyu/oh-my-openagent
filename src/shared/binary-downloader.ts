import { chmodSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "bun";
import { validateArchiveEntries, type ArchiveEntry } from "./archive-entry-validator";
import { extractZip } from "./zip-extractor";
import { log } from "./logger";

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

export class BinaryIntegrityError extends Error {
  constructor(message: string, public readonly expectedHash: string, public readonly actualHash: string) {
    super(message);
    this.name = "BinaryIntegrityError";
  }
}

export interface DownloadArchiveOptions {
  expectedSha256?: string;
}

export async function downloadArchive(
  downloadUrl: string,
  archivePath: string,
  options?: DownloadArchiveOptions
): Promise<void> {
  const response = await fetch(downloadUrl, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  await Bun.write(archivePath, arrayBuffer);

  // SHA256検証（提供されている場合）
  if (options?.expectedSha256) {
    const actualSha256 = createHash("sha256")
      .update(new Uint8Array(arrayBuffer))
      .digest("hex");

    if (actualSha256 !== options.expectedSha256.toLowerCase()) {
      // 検証失敗時はファイルを削除してエラーをスロー
      unlinkSync(archivePath);
      log(`[binary-downloader] SHA256 mismatch for ${archivePath}: expected ${options.expectedSha256}, got ${actualSha256}`);
      throw new BinaryIntegrityError(
        `Binary integrity check failed: SHA256 mismatch for ${downloadUrl}`,
        options.expectedSha256,
        actualSha256
      );
    }
    log(`[binary-downloader] SHA256 verified for ${archivePath}`);
  } else {
    // expectedSha256未指定時は警告ログを出して後方互換
    log(`[binary-downloader] Warning: No SHA256 provided for ${downloadUrl} - skipping integrity check`);
  }
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
    const stderr = await new Response(proc.stderr).text();

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
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
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
