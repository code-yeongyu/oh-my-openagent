/**
 * Debug Tracer Module
 * 
 * Comprehensive logging/tracing system for debugging Windows crashes.
 * 
 * ## Quick Start
 * 
 * Enable tracing via environment variable:
 * ```
 * # PowerShell
 * $env:OMO_DEBUG = "1"
 * opencode
 * 
 * # CMD
 * set OMO_DEBUG=1
 * opencode
 * ```
 * 
 * Or programmatically:
 * ```typescript
 * import { initTracer, trace, startSpan, endSpan } from "./shared/debug-tracer"
 * 
 * // Initialize (call early)
 * initTracer({ enabled: true })
 * 
 * // Log a simple event
 * trace("spawn.start", "notification.powershell", { command: "powershell" })
 * 
 * // Track duration with spans
 * const spanId = startSpan("spawn.start", "lsp.server", { server: "typescript" })
 * // ... do work ...
 * endSpan(spanId, { exitCode: 0 })
 * ```
 * 
 * ## Log File Location
 * 
 * Default: `%TEMP%/oh-my-opencode-trace.jsonl` (Windows)
 * Override: `$env:OMO_DEBUG_LOG = "C:\path\to\trace.jsonl"`
 * 
 * ## Features
 * 
 * - Ring buffer (in-memory, survives most crashes)
 * - JSONL format for easy parsing
 * - Automatic crash handlers (uncaughtException, unhandledRejection, signals)
 * - Periodic flush to disk (every 5s)
 * - Sensitive data redaction
 * - Memory stats tracking
 */

export {
  tracer,
  initTracer,
  trace,
  startSpan,
  endSpan,
  isTracingEnabled,
  getTracerRunId,
  getTracerLogPath,
  flushTracer,
  createDiagnosticBundle,
  shutdownTracer,
} from "./tracer"

export type {
  TracerConfig,
  TraceEvent,
  TraceEventType,
  MemoryStats,
  ProcessInfo,
  SpanContext,
  DiagnosticBundle,
} from "./types"

export {
  DEBUG_ENV_VAR,
  DEBUG_LOG_PATH_VAR,
  getDefaultLogFilePath,
} from "./constants"

export {
  tracedSpawn,
  tracedSpawnAsync,
  tracedBunSpawn,
  tracedBunSpawnSync,
  redactArgs,
  getCommandName,
} from "./traced-spawn"
