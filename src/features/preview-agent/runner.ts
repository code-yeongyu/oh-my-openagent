import { readdir, readFile, stat } from "fs/promises"
import { join, relative } from "path"
import type { Sandbox } from "opensandbox"
import type { ProjectConfig } from "./types"
import { getImage, getInstallCommand } from "./detector"

interface SandboxConfig {
  domain: string
  port: number
}

export async function createSandbox(config: SandboxConfig): Promise<Sandbox> {
  const { Sandbox } = await import("opensandbox")
  const { ConnectionConfig } = await import("opensandbox")

  const connConfig = new ConnectionConfig({
    domain: config.domain,
  })

  const sandbox = await Sandbox.create({
    connectionConfig: connConfig,
    image: "node:20",
  })

  return sandbox
}

export async function uploadProject(
  sandbox: Sandbox,
  localDir: string,
  remoteDir: string = "/workspace"
): Promise<void> {
  const entries = await scanDirectory(localDir, localDir)
  const { WriteEntry } = await import("opensandbox")

  const writeEntries = await Promise.all(
    entries.map(async (file) => {
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

async function scanDirectory(
  dir: string,
  baseDir: string,
  ignore: string[] = ["node_modules", ".git", "dist", "build", "__pycache__", ".venv"]
): Promise<string[]> {
  const entries: string[] = []

  async function walk(currentDir: string): Promise<void> {
    const dirents = await readdir(currentDir, { withFileTypes: true })

    for (const dirent of dirents) {
      if (ignore.includes(dirent.name)) continue

      const fullPath = join(currentDir, dirent.name)
      const relPath = relative(baseDir, fullPath)

      if (dirent.isDirectory()) {
        await walk(fullPath)
      } else {
        entries.push(relPath)
      }
    }
  }

  await walk(dir)
  return entries
}

export async function installDependencies(
  sandbox: Sandbox,
  projectType: "node" | "python"
): Promise<void> {
  const command = getInstallCommand(projectType)
  await sandbox.commands.run(command)
}

export async function startDevServer(
  sandbox: Sandbox,
  startCommand: string,
  projectType: "node" | "python"
): Promise<string> {
  const port = projectType === "node" ? 3000 : 8000
  await sandbox.commands.run_background(startCommand)
  return port.toString()
}

export async function getEndpoint(
  sandbox: Sandbox,
  port: number
): Promise<string> {
  const result = await sandbox.get_endpoint(port)
  return result.endpoint
}

export async function killDevServer(sandbox: Sandbox): Promise<void> {
  try {
    await sandbox.commands.run("pkill -f 'npm' || true")
  } catch {
    // ignore
  }
}

export async function renewSandbox(
  sandbox: Sandbox,
  minutes: number
): Promise<void> {
  const durationMs = minutes * 60 * 1000
  await sandbox.renew(durationMs)
}