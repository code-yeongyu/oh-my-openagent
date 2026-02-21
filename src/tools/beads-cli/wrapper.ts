import type { BeadsConfig } from "../../config"
import type {
  BdIssue,
  BdCreateOptions,
  BdUpdateOptions,
  BdCloseOptions,
  BdDependencyType,
  BdResult,
} from "./types"
import { log } from "../../shared"

export interface BeadsWrapperOptions {
  config: BeadsConfig
}

export class BeadsWrapper {
  private config: BeadsConfig

  constructor(options: BeadsWrapperOptions) {
    this.config = options.config
  }

  private buildCommand(command: string, args: string[] = []): string[] {
    const baseCommand = this.config.beads_command ?? "bd"
    return [baseCommand, command, ...args]
  }

  private async exec(cmdParts: string[]): Promise<string> {
    const { spawn } = await import("bun")
    const cmd = cmdParts.join(" ")
    log(`[BeadsWrapper] Executing: ${cmd}`)

    const proc = spawn(cmdParts, {
      stdout: "pipe",
      stderr: "pipe",
    })

    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited

    if (exitCode !== 0) {
      const errorMsg = stderr.trim() || stdout.trim() || `exit code ${exitCode}`
      throw new Error(`Beads command failed: ${errorMsg}`)
    }

    return stdout
  }

  private async execJson<T>(cmdParts: string[]): Promise<BdResult<T>> {
    try {
      const output = await this.exec([...cmdParts, "--json"])
      const data = JSON.parse(output) as T
      return { success: true, data }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      log(`[BeadsWrapper] Command failed`, { error })
      return { success: false, error }
    }
  }

  private async execBoolean(cmdParts: string[]): Promise<BdResult<void>> {
    try {
      await this.exec(cmdParts)
      return { success: true }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      log(`[BeadsWrapper] Command failed`, { error })
      return { success: false, error }
    }
  }

  async ready(): Promise<BdResult<BdIssue[]>> {
    const cmd = this.buildCommand("ready")
    const result = await this.execJson<BdIssue[]>(cmd)
    return result.success ? { success: true, data: result.data ?? [] } : result
  }

  async create(title: string, options: BdCreateOptions = {}): Promise<BdResult<BdIssue>> {
    const args: string[] = [title]

    if (options.priority !== undefined) {
      args.push(`--priority=${options.priority}`)
    }
    if (options.issue_type) {
      args.push(`--type=${options.issue_type}`)
    }
    if (options.assignee) {
      args.push(`--assignee=${options.assignee}`)
    }

    const cmd = this.buildCommand("create", args)
    return this.execJson<BdIssue>(cmd)
  }

  async update(id: string, options: BdUpdateOptions = {}): Promise<BdResult<BdIssue>> {
    const args: string[] = [id]

    if (options.status) {
      args.push(`--status=${options.status}`)
    }
    if (options.priority !== undefined) {
      args.push(`--priority=${options.priority}`)
    }
    if (options.assignee) {
      args.push(`--assignee=${options.assignee}`)
    }
    if (options.claim) {
      args.push("--claim")
    }

    const cmd = this.buildCommand("update", args)
    return this.execJson<BdIssue>(cmd)
  }

  async close(id: string, options: BdCloseOptions = {}): Promise<BdResult<BdIssue>> {
    const args: string[] = [id]

    if (options.reason) {
      args.push(`--reason=${options.reason}`)
    }

    const cmd = this.buildCommand("close", args)
    return this.execJson<BdIssue>(cmd)
  }

  async sync(): Promise<BdResult<void>> {
    const cmd = this.buildCommand("sync")
    return this.execBoolean(cmd)
  }

  async depAdd(id: string, depId: string, type: BdDependencyType): Promise<BdResult<void>> {
    const args = [id, depId, `--type=${type}`]
    const cmd = this.buildCommand("dep", ["add", ...args])
    return this.execBoolean(cmd)
  }

  async depRemove(id: string, depId: string): Promise<BdResult<void>> {
    const args = [id, depId]
    const cmd = this.buildCommand("dep", ["remove", ...args])
    return this.execBoolean(cmd)
  }

  async init(): Promise<BdResult<void>> {
    const cmd = this.buildCommand("init", ["--quiet"])
    return this.execBoolean(cmd)
  }

  async claim(id: string, assignee?: string): Promise<BdResult<BdIssue>> {
    return this.update(id, { claim: true, assignee })
  }

  async block(id: string): Promise<BdResult<BdIssue>> {
    return this.update(id, { status: "blocked" })
  }

  async reopen(id: string): Promise<BdResult<BdIssue>> {
    return this.update(id, { status: "open" })
  }
}
