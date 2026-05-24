import { existsSync } from "fs"; import { join } from "path"
import { log } from "../../shared"
import type { CodeGraphManagerOptions, CodeGraphInfo, CodeGraphStatus } from "./types"
export class CodeGraphManager {
  private directory: string; private config: CodeGraphManagerOptions["config"]
  private indexPath: string | null = null; private info: CodeGraphInfo = { fileCount: 0, nodeCount: 0, edgeCount: 0 }; private error: string | null = null
  constructor(o: CodeGraphManagerOptions) { this.directory = o.directory; this.config = o.config }
  async initialize(): Promise<boolean> {
    if (!this.config.enabled) { this.log("disabled"); return false }
    const cgDir = join(this.directory, ".codegraph")
    if (!existsSync(cgDir)) { this.error = "not found"; return false }
    this.indexPath = cgDir; try { this.info = await this.runStatus(); return true } catch (e) { this.error = String(e); return false }
  }
  isAvailable(): boolean { return this.config.enabled && this.indexPath !== null && this.error === null }
  getStatus(): CodeGraphStatus { return { isAvailable: this.isAvailable(), isInitialized: this.indexPath !== null, fileCount: this.info.fileCount, nodeCount: this.info.nodeCount, edgeCount: this.info.edgeCount, errorMessage: this.error, indexPath: this.indexPath } }
  async ensureIndex(): Promise<boolean> {
    if (this.isAvailable()) return true; if (!this.config.auto_init) return false
    try { await this.runInit(); this.indexPath = join(this.directory, ".codegraph"); this.error = null; this.info = await this.runStatus(); return true } catch (e) { this.error = String(e); return false }
  }
  async checkHealth(): Promise<boolean> { if (!this.indexPath) return false; try { await this.runStatus(); return true } catch { return false } }
  shouldPreferCodeGraph(): boolean { return this.config.prefer_codegraph && this.isAvailable() }
  getIndexPath(): string | null { return this.indexPath }
  private runStatus(): Promise<CodeGraphInfo> {
    return new Promise((resolve, reject) => {
      const { spawn } = require("child_process")
      const proc = spawn("npx", ["codegraph", "status", "--json"], { cwd: this.directory, stdio: ["ignore", "pipe", "pipe"], timeout: this.config.init_timeout_ms })
      let o = ""; proc.stdout.on("data", (c: Buffer) => { o += c.toString() })
      proc.on("close", (code: number | null) => {
        if (code !== 0) { reject(new Error(`exit ${code}`)); return }
        try { const p = JSON.parse(o); resolve({ fileCount: p.fileCount ?? p.files ?? 0, nodeCount: p.nodeCount ?? p.nodes ?? 0, edgeCount: p.edgeCount ?? p.edges ?? 0 }) } catch { resolve({ fileCount: 0, nodeCount: 0, edgeCount: 0 }) }
      })
      proc.on("error", reject)
    })
  }
  private runInit(): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = require("child_process").spawn("npx", ["codegraph", "init", "-i"], { cwd: this.directory, stdio: ["ignore", "pipe", "pipe"], timeout: this.config.init_timeout_ms })
      proc.on("close", (code: number | null) => code === 0 ? resolve() : reject(new Error(`init exit ${code}`)))
      proc.on("error", reject)
    })
  }
  private log(...a: unknown[]): void { log("[CodeGraphManager]", ...a) }
}
