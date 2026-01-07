/**
 * Debug Tracer Core Implementation
 * 
 * Provides comprehensive logging/tracing for Windows crash debugging.
 * Features:
 * - Ring buffer for in-memory storage (survives most crashes)
 * - JSONL format for easy parsing
 * - Periodic flush to disk
 * - Crash handlers for emergency flush
 * - Sensitive data redaction
 */

import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { randomUUID } from "crypto"
import type {
  TracerConfig,
  TraceEvent,
  TraceEventType,
  MemoryStats,
  ProcessInfo,
  SpanContext,
  DiagnosticBundle,
} from "./types"
import {
  DEBUG_ENV_VAR,
  DEBUG_LOG_PATH_VAR,
  DEFAULT_RING_BUFFER_SIZE,
  DEFAULT_FLUSH_INTERVAL_MS,
  REDACTION_PATTERNS,
  REDACTED_ENV_VARS,
  getDefaultLogFilePath,
} from "./constants"

// Package version - will be injected at build time or read from package.json
let appVersion = "unknown"
try {
  // Try to read version at runtime
  const pkgPath = path.join(__dirname, "..", "..", "..", "package.json")
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"))
    appVersion = pkg.version || "unknown"
  }
} catch {
  // Ignore - version stays unknown
}

class DebugTracer {
  private config: TracerConfig
  private ringBuffer: TraceEvent[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private runId: string
  private startTime: number
  private activeSpans: Map<string, SpanContext> = new Map()
  private initialized = false
  private logStream: fs.WriteStream | null = null
  private userHomePath: string

  constructor() {
    this.runId = randomUUID().slice(0, 8)
    this.startTime = Date.now()
    this.userHomePath = os.homedir()
    
    // Default config - disabled by default
    this.config = {
      enabled: false,
      ringBufferSize: DEFAULT_RING_BUFFER_SIZE,
      flushIntervalMs: DEFAULT_FLUSH_INTERVAL_MS,
      includeMemoryStats: true,
      redactHomePaths: true,
    }
  }

  /**
   * Initialize the tracer with optional config overrides.
   * Call this early in the application lifecycle.
   */
  init(configOverrides?: Partial<TracerConfig>): void {
    if (this.initialized) return

    // Check environment variables
    const envEnabled = process.env[DEBUG_ENV_VAR] === "1" || process.env[DEBUG_ENV_VAR] === "true"
    const envLogPath = process.env[DEBUG_LOG_PATH_VAR]

    this.config = {
      ...this.config,
      ...configOverrides,
      enabled: configOverrides?.enabled ?? envEnabled,
      logFilePath: configOverrides?.logFilePath ?? envLogPath ?? getDefaultLogFilePath(),
    }

    if (!this.config.enabled) {
      this.initialized = true
      return
    }

    // Set up log file stream
    try {
      const logDir = path.dirname(this.config.logFilePath!)
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true })
      }
      this.logStream = fs.createWriteStream(this.config.logFilePath!, { flags: "a" })
    } catch (err) {
      console.error("[debug-tracer] Failed to open log file:", err)
    }

    // Set up periodic flush
    this.flushTimer = setInterval(() => {
      this.flush("periodic")
    }, this.config.flushIntervalMs)

    // Prevent timer from keeping process alive
    if (this.flushTimer.unref) {
      this.flushTimer.unref()
    }

    // Set up crash handlers
    this.setupCrashHandlers()

    this.initialized = true

    // Log initialization
    this.trace("system.init", "tracer.initialized", {
      config: {
        ringBufferSize: this.config.ringBufferSize,
        flushIntervalMs: this.config.flushIntervalMs,
        logFilePath: this.redactPath(this.config.logFilePath!),
      },
    })
  }

  /**
   * Check if tracing is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled
  }

  /**
   * Get the run ID for this session
   */
  getRunId(): string {
    return this.runId
  }

  /**
   * Get the log file path
   */
  getLogFilePath(): string | undefined {
    return this.config.logFilePath
  }

  /**
   * Record a trace event
   */
  trace(
    type: TraceEventType,
    name: string,
    data?: Record<string, unknown>,
    error?: Error
  ): void {
    if (!this.config.enabled) return

    const event: TraceEvent = {
      ts: new Date().toISOString(),
      type,
      name: this.redactString(name),
      data: data ? this.redactData(data) : undefined,
      error: error
        ? {
            message: this.redactString(error.message),
            stack: error.stack ? this.redactString(error.stack) : undefined,
            code: (error as NodeJS.ErrnoException).code,
          }
        : undefined,
    }

    if (this.config.includeMemoryStats) {
      event.memory = this.getMemoryStats()
    }

    event.process = this.getProcessInfo()

    this.addToRingBuffer(event)
  }

  /**
   * Start a span for tracking duration of an operation
   */
  startSpan(
    type: TraceEventType,
    name: string,
    data?: Record<string, unknown>,
    parentSpanId?: string
  ): string {
    const spanId = randomUUID().slice(0, 12)

    if (!this.config.enabled) return spanId

    const context: SpanContext = {
      spanId,
      parentSpanId,
      startTime: Date.now(),
      name,
      type,
      data,
    }
    this.activeSpans.set(spanId, context)

    this.trace(type, `${name}.start`, {
      ...data,
      spanId,
      parentSpanId,
    })

    return spanId
  }

  /**
   * End a span and record its duration
   */
  endSpan(
    spanId: string,
    data?: Record<string, unknown>,
    error?: Error
  ): void {
    if (!this.config.enabled) return

    const context = this.activeSpans.get(spanId)
    if (!context) return

    this.activeSpans.delete(spanId)
    const durationMs = Date.now() - context.startTime

    // Determine the end type based on start type
    const endType = context.type.replace(".start", ".exit").replace(".enter", ".exit") as TraceEventType

    const event: TraceEvent = {
      ts: new Date().toISOString(),
      type: error ? (context.type.replace(".start", ".error") as TraceEventType) : endType,
      spanId,
      parentSpanId: context.parentSpanId,
      name: `${context.name}.end`,
      durationMs,
      data: data ? this.redactData({ ...context.data, ...data }) : this.redactData(context.data),
      error: error
        ? {
            message: this.redactString(error.message),
            stack: error.stack ? this.redactString(error.stack) : undefined,
            code: (error as NodeJS.ErrnoException).code,
          }
        : undefined,
    }

    if (this.config.includeMemoryStats) {
      event.memory = this.getMemoryStats()
    }

    event.process = this.getProcessInfo()

    this.addToRingBuffer(event)
  }

  /**
   * Flush ring buffer to disk
   */
  flush(reason: "periodic" | "shutdown" | "crash" = "periodic"): void {
    if (!this.config.enabled || this.ringBuffer.length === 0) return

    const events = [...this.ringBuffer]
    
    // Add flush marker
    const flushEvent: TraceEvent = {
      ts: new Date().toISOString(),
      type: reason === "periodic" ? "flush.periodic" : "flush.shutdown",
      name: `flush.${reason}`,
      data: { eventCount: events.length },
      memory: this.config.includeMemoryStats ? this.getMemoryStats() : undefined,
      process: this.getProcessInfo(),
    }
    events.push(flushEvent)

    // Write to stream
    if (this.logStream) {
      try {
        for (const event of events) {
          this.logStream.write(JSON.stringify(event) + "\n")
        }
      } catch (err) {
        console.error("[debug-tracer] Failed to write to log:", err)
      }
    }

    // Clear buffer after successful write
    this.ringBuffer = []
  }

  /**
   * Emergency flush - synchronous write for crash scenarios
   */
  emergencyFlush(reason: string): void {
    if (!this.config.enabled) return

    // Add crash marker
    const crashEvent: TraceEvent = {
      ts: new Date().toISOString(),
      type: "crash.handler",
      name: `crash.${reason}`,
      data: {
        eventCount: this.ringBuffer.length,
        activeSpans: this.activeSpans.size,
      },
      memory: this.getMemoryStats(),
      process: this.getProcessInfo(),
    }
    this.ringBuffer.push(crashEvent)

    // Synchronous write
    if (this.config.logFilePath) {
      try {
        const content = this.ringBuffer.map((e) => JSON.stringify(e)).join("\n") + "\n"
        fs.appendFileSync(this.config.logFilePath, content)
      } catch {
        // Last resort - try console
        console.error("[debug-tracer] Emergency flush:")
        console.error(JSON.stringify(this.ringBuffer.slice(-50)))
      }
    }
  }

  /**
   * Create a diagnostic bundle for sharing
   */
  createDiagnosticBundle(): DiagnosticBundle {
    return {
      createdAt: new Date().toISOString(),
      events: [...this.ringBuffer],
      processInfo: this.getProcessInfo(),
      env: this.getRedactedEnv(),
      recentLogs: this.getRecentLogEntries(),
      system: {
        platform: os.platform(),
        arch: os.arch(),
        cpuCores: os.cpus().length,
        totalMemory: Math.round(os.totalmem() / 1024 / 1024),
        freeMemory: Math.round(os.freemem() / 1024 / 1024),
      },
    }
  }

  /**
   * Shutdown the tracer gracefully
   */
  shutdown(): void {
    if (!this.config.enabled) return

    this.trace("system.shutdown", "tracer.shutdown")
    this.flush("shutdown")

    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }

    if (this.logStream) {
      this.logStream.end()
      this.logStream = null
    }
  }

  // Private methods

  private addToRingBuffer(event: TraceEvent): void {
    this.ringBuffer.push(event)
    if (this.ringBuffer.length > this.config.ringBufferSize) {
      this.ringBuffer.shift()
    }
  }

  private getMemoryStats(): MemoryStats {
    const mem = process.memoryUsage()
    return {
      rss: Math.round(mem.rss / 1024 / 1024 * 100) / 100,
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024 * 100) / 100,
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024 * 100) / 100,
      external: Math.round(mem.external / 1024 / 1024 * 100) / 100,
    }
  }

  private getProcessInfo(): ProcessInfo {
    return {
      pid: process.pid,
      platform: os.platform(),
      bunVersion: typeof Bun !== "undefined" ? Bun.version : "N/A",
      nodeVersion: process.version,
      appVersion,
      runId: this.runId,
      uptimeSeconds: Math.round((Date.now() - this.startTime) / 1000),
    }
  }

  private redactPath(p: string): string {
    if (!this.config.redactHomePaths) return p
    return p.replace(this.userHomePath, "~")
  }

  private redactString(s: string): string {
    let result = s

    // Redact home paths
    if (this.config.redactHomePaths) {
      result = result.replace(new RegExp(this.escapeRegExp(this.userHomePath), "gi"), "~")
    }

    // Redact sensitive patterns
    for (const pattern of REDACTION_PATTERNS) {
      result = result.replace(pattern, "[REDACTED]")
    }

    return result
  }

  private redactData(data?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!data) return undefined

    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase()
      if (
        lowerKey.includes("token") ||
        lowerKey.includes("secret") ||
        lowerKey.includes("password") ||
        lowerKey.includes("key") ||
        lowerKey.includes("auth") ||
        lowerKey.includes("credential")
      ) {
        result[key] = "[REDACTED]"
      } else if (typeof value === "string") {
        result[key] = this.redactString(value)
      } else if (Array.isArray(value)) {
        result[key] = value.map((v) =>
          typeof v === "string" ? this.redactString(v) : v
        )
      } else if (typeof value === "object" && value !== null) {
        result[key] = this.redactData(value as Record<string, unknown>)
      } else {
        result[key] = value
      }
    }
    return result
  }

  private getRedactedEnv(): Record<string, string> {
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (!value) continue
      if (REDACTED_ENV_VARS.has(key) || key.toLowerCase().includes("secret") || key.toLowerCase().includes("token")) {
        result[key] = "[REDACTED]"
      } else {
        result[key] = this.redactString(value)
      }
    }
    return result
  }

  private getRecentLogEntries(): string[] {
    // Read last 100 lines from the log file if it exists
    if (!this.config.logFilePath || !fs.existsSync(this.config.logFilePath)) {
      return []
    }

    try {
      const content = fs.readFileSync(this.config.logFilePath, "utf-8")
      const lines = content.trim().split("\n")
      return lines.slice(-100)
    } catch {
      return []
    }
  }

  private escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  }

  private setupCrashHandlers(): void {
    // uncaughtException
    process.on("uncaughtException", (error) => {
      this.trace("crash.handler", "uncaughtException", undefined, error)
      this.emergencyFlush("uncaughtException")
    })

    // unhandledRejection
    process.on("unhandledRejection", (reason) => {
      const error = reason instanceof Error ? reason : new Error(String(reason))
      this.trace("crash.handler", "unhandledRejection", undefined, error)
      this.emergencyFlush("unhandledRejection")
    })

    // SIGTERM
    process.on("SIGTERM", () => {
      this.trace("system.shutdown", "SIGTERM")
      this.flush("shutdown")
    })

    // SIGINT (Ctrl+C)
    process.on("SIGINT", () => {
      this.trace("system.shutdown", "SIGINT")
      this.flush("shutdown")
    })

    // Windows-specific: SIGBREAK
    if (process.platform === "win32") {
      process.on("SIGBREAK", () => {
        this.trace("system.shutdown", "SIGBREAK")
        this.flush("shutdown")
      })
    }

    // beforeExit
    process.on("beforeExit", () => {
      this.shutdown()
    })

    // exit
    process.on("exit", () => {
      this.emergencyFlush("exit")
    })
  }
}

// Singleton instance
export const tracer = new DebugTracer()

// Convenience exports
export const initTracer = (config?: Partial<TracerConfig>) => tracer.init(config)
export const trace = (type: TraceEventType, name: string, data?: Record<string, unknown>, error?: Error) =>
  tracer.trace(type, name, data, error)
export const startSpan = (type: TraceEventType, name: string, data?: Record<string, unknown>, parentSpanId?: string) =>
  tracer.startSpan(type, name, data, parentSpanId)
export const endSpan = (spanId: string, data?: Record<string, unknown>, error?: Error) =>
  tracer.endSpan(spanId, data, error)
export const isTracingEnabled = () => tracer.isEnabled()
export const getTracerRunId = () => tracer.getRunId()
export const getTracerLogPath = () => tracer.getLogFilePath()
export const flushTracer = (reason?: "periodic" | "shutdown" | "crash") => tracer.flush(reason)
export const createDiagnosticBundle = () => tracer.createDiagnosticBundle()
export const shutdownTracer = () => tracer.shutdown()
