import { readdir, readFile, stat } from "fs/promises"
import { join, relative } from "path"
import type { Sandbox } from "opensandbox"
import type { ProjectConfig, FileSyncState } from "./types"

export async function detectChanges(
  localDir: string,
  state: FileSyncState,
  ignore: string[] = ["node_modules", ".git", "dist", "build", "__pycache__", ".venv"]
): Promise<string[]> {
  const changed: string[] = []
  const entries: string[] = []

  async function walk(currentDir: string): Promise<void> {
    const dirents = await readdir(currentDir, { withFileTypes: true })

    for (const dirent of dirents) {
      if (ignore.includes(dirent.name)) continue

      const fullPath = join(currentDir, dirent.name)
      const relPath = relative(localDir, fullPath)

      if (dirent.isDirectory()) {
        await walk(fullPath)
      } else {
        entries.push(relPath)
      }
    }
  }

  await walk(localDir)

  for (const relPath of entries) {
    const fullPath = join(localDir, relPath)
    const fileStat = await stat(fullPath)
    const lastMtime = state.lastSync.get(relPath)

    if (!lastMtime || fileStat.mtimeMs > lastMtime) {
      changed.push(relPath)
      state.lastSync.set(relPath, fileStat.mtimeMs)
    }
  }

  return changed
}

export async function uploadChangedFiles(
  sandbox: Sandbox,
  localDir: string,
  remoteDir: string,
  changedFiles: string[]
): Promise<void> {
  if (changedFiles.length === 0) return

  const { WriteEntry } = await import("opensandbox")

  const writeEntries = await Promise.all(
    changedFiles.map(async (file) => {
      const localPath = join(localDir, file)
      const remotePath = join(remoteDir, file)
      const content = await readFile(localPath, "utf-8")
      const fileStat = await stat(localPath)

      return new WriteEntry({
        path: remotePath,
        data: content,
        mode: fileStat.mode,
      })
    })
  )

  await sandbox.files.writeFiles(writeEntries)
}

export async function restartDevServer(
  sandbox: Sandbox,
  startCommand: string,
  projectType: "node" | "python"
): Promise<void> {
  await killProcess(sandbox, projectType)
  await new Promise((r) => setTimeout(r, 500))
  await sandbox.commands.run_background(startCommand)
}

async function killProcess(
  sandbox: Sandbox,
  projectType: "node" | "python"
): Promise<void> {
  try {
    if (projectType === "node") {
      await sandbox.commands.run("pkill -f 'node' || true")
    } else {
      await sandbox.commands.run("pkill -f 'python' || true")
    }
  } catch {
    // ignore
  }
}

export async function startWatching(
  sandbox: Sandbox,
  localDir: string,
  remoteDir: string,
  startCommand: string,
  projectType: "node" | "python",
  intervalMs: number = 1000
): Promise<void> {
  const state: FileSyncState = { lastSync: new Map() }

  while (true) {
    const changed = await detectChanges(localDir, state)

    if (changed.length > 0) {
      await uploadChangedFiles(sandbox, localDir, remoteDir, changed)
      await restartDevServer(sandbox, startCommand, projectType as "node" | "python")
    }

    await new Promise((r) => setTimeout(r, intervalMs))
  }
}