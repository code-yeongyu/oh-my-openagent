#!/usr/bin/env bun

import { existsSync } from "node:fs"
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { getOpenCodeConfigDir } from "../src/shared/opencode-config-dir"

export const MANAGED_CUSTOM_OPENCODE_ASSET_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../assets/custom-opencode"
)

export const SYNC_STATE_DIRNAME = ".oh-my-openagent-sync"
export const SYNC_MANIFEST_FILENAME = "manifest.json"
export const SYNC_LOG_FILENAME = "sync.log"
export const SYNC_BACKUP_DIRNAME = "backups"

export type SyncFileStatus = "created" | "updated" | "unchanged"

export interface SyncedFileRecord {
  relativePath: string
  sourcePath: string
  destinationPath: string
  status: SyncFileStatus
  backupPath: string | null
  bytes: number
}

export interface SyncManifest {
  timestamp: string
  runId: string
  assetRoot: string
  targetDir: string
  stateDir: string
  backupDir: string
  manifestPath: string
  logPath: string
  createdDirectories: string[]
  files: SyncedFileRecord[]
  summary: {
    created: number
    updated: number
    unchanged: number
    backups: number
  }
}

export interface SyncCustomOpenCodeAssetsOptions {
  assetRoot?: string
  targetDir?: string
  timestamp?: string
}

export interface SyncCustomOpenCodeAssetsResult {
  manifest: SyncManifest
  manifestPath: string
  logPath: string
  backupDir: string
}

function toPortableRelativePath(pathValue: string): string {
  return pathValue.split("\\").join("/")
}

function createRunId(timestamp: string): string {
  return timestamp.replace(/[.:]/g, "-")
}

async function listManagedAssetFiles(rootDir: string): Promise<string[]> {
  const discovered: string[] = []

  async function walk(currentDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))

    for (const entry of entries) {
      const entryPath = join(currentDir, entry.name)

      if (entry.isDirectory()) {
        await walk(entryPath)
        continue
      }

      if (entry.isFile()) {
        discovered.push(entryPath)
      }
    }
  }

  await walk(rootDir)
  return discovered.sort((left, right) => left.localeCompare(right))
}

async function ensureDirectory(directoryPath: string, targetDir: string, createdDirectories: Set<string>): Promise<void> {
  if (!existsSync(directoryPath)) {
    await mkdir(directoryPath, { recursive: true })
    const relativePath = toPortableRelativePath(relative(targetDir, directoryPath))
    createdDirectories.add(relativePath === "" ? "." : relativePath)
  }
}

async function fileContentsMatch(sourcePath: string, destinationPath: string): Promise<boolean> {
  if (!existsSync(destinationPath)) {
    return false
  }

  const [sourceContents, destinationContents] = await Promise.all([
    readFile(sourcePath),
    readFile(destinationPath),
  ])

  return sourceContents.equals(destinationContents)
}

export function resolveSyncTargetDir(targetDir?: string): string {
  if (targetDir) {
    return resolve(targetDir)
  }

  return getOpenCodeConfigDir({ binary: "opencode" })
}

export function resolveManagedCustomOpenCodeAssetDir(assetRoot?: string): string {
  const candidatePaths = [
    assetRoot ? resolve(assetRoot) : null,
    MANAGED_CUSTOM_OPENCODE_ASSET_DIR,
    resolve(process.cwd(), "assets/custom-opencode"),
  ].filter((candidate): candidate is string => Boolean(candidate))

  for (const candidatePath of candidatePaths) {
    if (existsSync(candidatePath)) {
      return candidatePath
    }
  }

  throw new Error(`Managed asset directory not found. Tried: ${candidatePaths.join(", ")}`)
}

export async function syncCustomOpenCodeAssets(
  options: SyncCustomOpenCodeAssetsOptions = {}
): Promise<SyncCustomOpenCodeAssetsResult> {
  const timestamp = options.timestamp ?? new Date().toISOString()
  const runId = createRunId(timestamp)
  const assetRoot = resolveManagedCustomOpenCodeAssetDir(options.assetRoot)
  const targetDir = resolveSyncTargetDir(options.targetDir)
  const stateDir = join(targetDir, SYNC_STATE_DIRNAME)
  const backupDir = join(stateDir, SYNC_BACKUP_DIRNAME, runId)
  const manifestPath = join(stateDir, SYNC_MANIFEST_FILENAME)
  const logPath = join(stateDir, SYNC_LOG_FILENAME)
  const createdDirectories = new Set<string>()

  await ensureDirectory(targetDir, targetDir, createdDirectories)
  await ensureDirectory(stateDir, targetDir, createdDirectories)
  await ensureDirectory(backupDir, targetDir, createdDirectories)

  const assetFiles = await listManagedAssetFiles(assetRoot)
  const fileRecords: SyncedFileRecord[] = []

  for (const sourcePath of assetFiles) {
    const relativePath = toPortableRelativePath(relative(assetRoot, sourcePath))
    const destinationPath = join(targetDir, relativePath)
    const destinationDir = dirname(destinationPath)

    await ensureDirectory(destinationDir, targetDir, createdDirectories)

    const destinationExists = existsSync(destinationPath)
    if (destinationExists) {
      const destinationStats = await stat(destinationPath)
      if (!destinationStats.isFile()) {
        throw new Error(`Cannot sync file onto non-file path: ${destinationPath}`)
      }
    }

    const sourceStats = await stat(sourcePath)
    let backupPath: string | null = null
    let status: SyncFileStatus = "created"

    if (destinationExists) {
      const contentsMatch = await fileContentsMatch(sourcePath, destinationPath)
      if (contentsMatch) {
        status = "unchanged"
      } else {
        backupPath = join(backupDir, relativePath)
        await ensureDirectory(dirname(backupPath), targetDir, createdDirectories)
        await copyFile(destinationPath, backupPath)
        status = "updated"
      }
    }

    if (status !== "unchanged") {
      await copyFile(sourcePath, destinationPath)
    }

    fileRecords.push({
      relativePath,
      sourcePath,
      destinationPath,
      status,
      backupPath,
      bytes: sourceStats.size,
    })
  }

  const manifest: SyncManifest = {
    timestamp,
    runId,
    assetRoot,
    targetDir,
    stateDir,
    backupDir,
    manifestPath,
    logPath,
    createdDirectories: [...createdDirectories].sort((left, right) => left.localeCompare(right)),
    files: fileRecords,
    summary: {
      created: fileRecords.filter((file) => file.status === "created").length,
      updated: fileRecords.filter((file) => file.status === "updated").length,
      unchanged: fileRecords.filter((file) => file.status === "unchanged").length,
      backups: fileRecords.filter((file) => file.backupPath !== null).length,
    },
  }

  const logLines = [
    "Managed custom OpenCode asset sync",
    `Timestamp: ${timestamp}`,
    `Target: ${targetDir}`,
    `Asset root: ${assetRoot}`,
    `Backup dir: ${backupDir}`,
    `Created directories: ${manifest.createdDirectories.join(", ") || "(none)"}`,
    "",
    ...fileRecords.map((file) => {
      const backupSuffix = file.backupPath ? ` | backup: ${file.backupPath}` : ""
      return `[${file.status.toUpperCase()}] ${file.relativePath} -> ${file.destinationPath}${backupSuffix}`
    }),
  ]

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n")
  await writeFile(logPath, logLines.join("\n") + "\n")

  return {
    manifest,
    manifestPath,
    logPath,
    backupDir,
  }
}

export function parseSyncCustomOpenCodeAssetArgs(argv: string[]): SyncCustomOpenCodeAssetsOptions & {
  help: boolean
} {
  let targetDir: string | undefined
  let help = false

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === "--help" || arg === "-h") {
      help = true
      continue
    }

    if (arg === "--target") {
      const nextArg = argv[index + 1]
      if (!nextArg) {
        throw new Error("Missing value for --target")
      }

      targetDir = nextArg
      index += 1
      continue
    }

    if (arg.startsWith("--target=")) {
      targetDir = arg.slice("--target=".length)
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  return { targetDir, help }
}

function printUsage(): void {
  console.log("Usage: bun run script/sync-custom-opencode-assets.ts [--target <path>]")
  console.log("Copies managed custom OpenCode assets into a target config directory with backups and a manifest.")
}

async function main(): Promise<void> {
  const args = parseSyncCustomOpenCodeAssetArgs(process.argv.slice(2))

  if (args.help) {
    printUsage()
    return
  }

  const result = await syncCustomOpenCodeAssets({ targetDir: args.targetDir })

  console.log(`Synced managed assets into ${result.manifest.targetDir}`)
  console.log(`Manifest: ${result.manifestPath}`)
  console.log(`Log: ${result.logPath}`)
  console.log(`Backup dir: ${result.backupDir}`)
  console.log(
    `Summary: ${result.manifest.summary.created} created, ${result.manifest.summary.updated} updated, ${result.manifest.summary.unchanged} unchanged`
  )
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
