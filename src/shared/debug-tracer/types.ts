/**
 * Debug Tracer Types
 * Comprehensive logging/tracing for Windows crash debugging
 */

export interface TracerConfig {
  /** Enable tracing (default: false, enabled via OMO_DEBUG=1 or --debug flag) */
  enabled: boolean
  /** Ring buffer size for in-memory events (default: 1000) */
  ringBufferSize: number
  /** Flush interval in ms (default: 5000) */
  flushIntervalMs: number
  /** Log file path (default: temp dir) */
  logFilePath?: string
  /** Include memory stats in events (default: true) */
  includeMemoryStats: boolean
  /** Redact user home paths (default: true) */
  redactHomePaths: boolean
}

export interface TraceEvent {
  /** ISO timestamp */
  ts: string
  /** Event type/category */
  type: TraceEventType
  /** Correlation/span ID */
  spanId?: string
  /** Parent span ID for nested operations */
  parentSpanId?: string
  /** Event name/action */
  name: string
  /** Duration in ms (for completed spans) */
  durationMs?: number
  /** Event-specific data */
  data?: Record<string, unknown>
  /** Error info if applicable */
  error?: {
    message: string
    stack?: string
    code?: string
  }
  /** Memory stats at time of event */
  memory?: MemoryStats
  /** Process info */
  process?: ProcessInfo
}

export interface MemoryStats {
  /** Resident Set Size in MB */
  rss: number
  /** Heap used in MB */
  heapUsed: number
  /** Heap total in MB */
  heapTotal: number
  /** External memory in MB */
  external: number
}

export interface ProcessInfo {
  /** Process ID */
  pid: number
  /** Platform */
  platform: string
  /** Bun version */
  bunVersion: string
  /** Node version */
  nodeVersion: string
  /** App version */
  appVersion: string
  /** Session/run ID */
  runId: string
  /** Uptime in seconds */
  uptimeSeconds: number
}

export type TraceEventType =
  | "spawn.start"
  | "spawn.exit"
  | "spawn.error"
  | "notification.send"
  | "notification.sound"
  | "subagent.start"
  | "subagent.stop"
  | "subagent.error"
  | "background.start"
  | "background.complete"
  | "background.error"
  | "timer.start"
  | "timer.tick"
  | "timer.stop"
  | "file.read"
  | "file.write"
  | "hook.enter"
  | "hook.exit"
  | "event.received"
  | "memory.pressure"
  | "crash.handler"
  | "flush.periodic"
  | "flush.shutdown"
  | "system.init"
  | "system.shutdown"

export interface SpanContext {
  spanId: string
  parentSpanId?: string
  startTime: number
  name: string
  type: TraceEventType
  data?: Record<string, unknown>
}

export interface DiagnosticBundle {
  /** Bundle creation timestamp */
  createdAt: string
  /** Ring buffer snapshot */
  events: TraceEvent[]
  /** Process info at bundle time */
  processInfo: ProcessInfo
  /** Environment variables (redacted) */
  env: Record<string, string>
  /** Recent log entries */
  recentLogs: string[]
  /** System info */
  system: {
    platform: string
    arch: string
    cpuCores: number
    totalMemory: number
    freeMemory: number
  }
}
