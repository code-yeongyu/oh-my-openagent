import { exec } from "node:child_process"
import { promisify } from "node:util"
import { existsSync, mkdirSync, copyFileSync, symlinkSync } from "node:fs"
import { join, dirname, relative } from "node:path"
import { log } from "../../shared/logger"

const execAsync = promisify(exec)

export interface VerificationResult {
  success: boolean
  output: string
}

export class SandboxManager {
  private workspaceDir: string

  constructor(workspaceDir: string) {
    this.workspaceDir = workspaceDir
  }

  public async verify(verifyCommand: string): Promise<VerificationResult> {
    const sandboxId = Math.random().toString(36).substring(2, 10)
    const tempDir = join(this.workspaceDir, ".omo", `sandbox_${sandboxId}`)
    
    log(`[sandbox-manager] Starting verification. Temp sandbox dir: ${tempDir}`)

    try {
      // 1. Get modified/added files
      const { stdout: statusOut } = await execAsync("git status --porcelain", { cwd: this.workspaceDir })
      const lines = statusOut.split("\n").filter((l) => l.trim().length > 0)
      
      const modifiedFiles: string[] = []
      for (const line of lines) {
        // Status format: XY filepath (e.g. M src/index.ts, A test.ts)
        const parts = line.trim().match(/^([MADRCU? ]+)\s+(.+)$/)
        if (parts) {
          const status = parts[1].trim()
          const filepath = parts[2].trim()
          // Only copy modified, added, or untracked source files (excluding git markers or temp dirs)
          if (!filepath.startsWith(".omo") && !filepath.startsWith(".git") && status !== "D") {
            modifiedFiles.push(filepath)
          }
        }
      }

      if (modifiedFiles.length === 0) {
        log(`[sandbox-manager] No modified files detected. Skipping verification.`)
        return { success: true, output: "No modified files to verify." }
      }

      // Ensure .omo directory exists
      const omoDir = join(this.workspaceDir, ".omo")
      if (!existsSync(omoDir)) {
        mkdirSync(omoDir)
      }

      // 2. Create git worktree
      log(`[sandbox-manager] Creating git worktree at ${tempDir}`)
      await execAsync(`git worktree add --detach "${tempDir}" HEAD`, { cwd: this.workspaceDir })

      // 3. Symlink node_modules
      const sourceNodeModules = join(this.workspaceDir, "node_modules")
      const targetNodeModules = join(tempDir, "node_modules")
      if (existsSync(sourceNodeModules)) {
        log(`[sandbox-manager] Symlinking node_modules to sandbox`)
        symlinkSync(sourceNodeModules, targetNodeModules, "dir")
      }

      // 4. Copy modified files to worktree
      log(`[sandbox-manager] Copying ${modifiedFiles.length} modified files to sandbox`)
      for (const file of modifiedFiles) {
        const sourcePath = join(this.workspaceDir, file)
        const targetPath = join(tempDir, file)
        const targetDirPath = dirname(targetPath)

        if (!existsSync(targetDirPath)) {
          mkdirSync(targetDirPath, { recursive: true })
        }
        if (existsSync(sourcePath)) {
          copyFileSync(sourcePath, targetPath)
        }
      }

      // 5. Run verification command
      log(`[sandbox-manager] Running verification command: ${verifyCommand}`)
      const { stdout, stderr } = await execAsync(verifyCommand, { cwd: tempDir })
      const output = `${stdout}\n${stderr}`
      log(`[sandbox-manager] Verification command succeeded.`)
      return { success: true, output }

    } catch (err: any) {
      const output = err.stdout || err.stderr || err.message || String(err)
      log(`[sandbox-manager] Verification command failed. Output:\n${output}`)
      return { success: false, output }
    } finally {
      // 6. Cleanup git worktree
      if (existsSync(tempDir)) {
        log(`[sandbox-manager] Cleaning up git worktree at ${tempDir}`)
        try {
          await execAsync(`git worktree remove --force "${tempDir}"`, { cwd: this.workspaceDir })
        } catch (e) {
          log(`[sandbox-manager] Error removing worktree:`, e)
        }
      }
    }
  }
}
