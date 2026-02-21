import type { BeadsConfig } from "../../config"
import type {
  BdIssue,
  BdCreateOptions,
  BdUpdateOptions,
  BdCloseOptions,
  BdDependencyType,
} from "../../features/beads-integration/types"
import { log } from "../../shared"

export interface BeadsWrapperOptions {
  config: BeadsConfig
}

export class BeadsWrapper {
  private config: BeadsConfig

  constructor(options: BeadsWrapperOptions) {
    this.config = options.config
  }

  private buildCommand(command: string, args: string[] = []): string {
    const baseCommand = this.config.beads_command ?? "bd"
    const fullArgs = args.join(" ")
    return `${baseCommand} ${command} ${fullArgs}`.trim()
  }

  private async exec(cmd: string): Promise<string> {
    const { spawn } = await import("bun")
    log(`[BeadsWrapper] Executing: ${cmd}`)

    const parts = cmd.split(" ")
    const [cli, ...args] = parts

    const proc = spawn([cli, ...args], {
      stdout: "pipe",
      stderr: "pipe",
    })

    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited

    if (exitCode !== 0) {
      throw new Error(`Beads command failed (exit ${exitCode}): ${stderr || stdout}`)
    }

    return stdout
  }

  private async execJson<T>(cmd: string): Promise<T | null> {
    try {
      const output = await this.exec(cmd + " --json")
      return JSON.parse(output) as T
    } catch (e) {
      log(`[BeadsWrapper] JSON parse error`, { error: e instanceof Error ? e.message : String(e) })
      return null
    }
  }

  async ready(): Promise<BdIssue[]> {
    const cmd = this.buildCommand("ready")
    const result = await this.execJson<BdIssue[]>(cmd)
    return result ?? []
  }

  async create(title: string, options: BdCreateOptions = {}): Promise<BdIssue | null> {
    const args: string[] = [`"${title.replace(/"/g, '\\"')}"`]

    if (options.priority !== undefined) {
      args.push(`--priority=${options.priority}`)
    }
    if (options.issue_type) {
      args.push(`--type=${options.issue_type}`)
    }
    if (options.assignee) {
      args.push(`--assignee="${options.assignee.replace(/"/g, '\\"')}"`)
    }

    const cmd = this.buildCommand("create", args)
    return this.execJson<BdIssue>(cmd)
  }

  async update(id: string, options: BdUpdateOptions = {}): Promise<BdIssue | null> {
    const args: string[] = [id]

    if (options.status) {
      args.push(`--status=${options.status}`)
    }
    if (options.priority !== undefined) {
      args.push(`--priority=${options.priority}`)
    }
    if (options.assignee) {
      args.push(`--assignee="${options.assignee.replace(/"/g, '\\"')}"`)
    }
    if (options.claim) {
      args.push("--claim")
    }

    const cmd = this.buildCommand("update", args)
    return this.execJson<BdIssue>(cmd)
  }

  async close(id: string, options: BdCloseOptions = {}): Promise<BdIssue | null> {
    const args: string[] = [id]

    if (options.reason) {
      args.push(`--reason="${options.reason.replace(/"/g, '\\"')}"`)
    }

    const cmd = this.buildCommand("close", args)
    return this.execJson<BdIssue>(cmd)
  }

  async sync(): Promise<boolean> {
    try {
      const cmd = this.buildCommand("sync")
      await this.exec(cmd)
      return true
    } catch {
      return false
    }
  }

  async depAdd(id: string, depId: string, type: BdDependencyType): Promise<boolean> {
    try {
      const args = [id, depId, `--type=${type}`]
      const cmd = this.buildCommand("dep add", args)
      await this.exec(cmd)
      return true
    } catch {
      return false
    }
  }

  async depRemove(id: string, depId: string): Promise<boolean> {
    try {
      const args = [id, depId]
      const cmd = this.buildCommand("dep remove", args)
      await this.exec(cmd)
      return true
    } catch {
      return false
    }
  }

  async init(): Promise<boolean> {
    try {
      const args = ["--quiet"]
      const cmd = this.buildCommand("init", args)
      await this.exec(cmd)
      return true
    } catch {
      return false
    }
  }

  async claim(id: string, assignee?: string): Promise<BdIssue | null> {
    return this.update(id, { claim: true, assignee })
  }

  async block(id: string): Promise<BdIssue | null> {
    return this.update(id, { status: "blocked" })
  }

  async reopen(id: string): Promise<BdIssue | null> {
    return this.update(id, { status: "open" })
  }
}
