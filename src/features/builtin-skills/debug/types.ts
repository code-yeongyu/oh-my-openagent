/**
 * Debug skill types for enterprise debugging workflows
 * Includes both observability (Datadog/Sentry) and interactive debugging (DAP/LLDB/GDB)
 */

export type DebugSubcommand =
  | "trace"
  | "logs"
  | "metrics"
  | "profile"
  | "breakpoint"
  | "step"
  | "continue"
  | "stacktrace"
  | "variables"
  | "evaluate"
  | "attach"
  | "launch"
  | "session"

export interface TraceInput {
  /** Error message or stack trace to analyze */
  error: string
  /** Service or component name */
  service?: string
  /** Time range for trace search (e.g., "1h", "30m") */
  timeRange?: string
  /** Additional context (environment, deployment, etc.) */
  context?: Record<string, string>
}

export interface TraceResult {
  /** Root cause analysis */
  rootCause: string
  /** Ordered list of spans/events leading to the error */
  traceChain: TraceSpan[]
  /** Related errors found */
  relatedErrors: RelatedError[]
  /** Recommended actions */
  recommendations: string[]
}

export interface TraceSpan {
  /** Service name */
  service: string
  /** Operation name */
  operation: string
  /** Timestamp */
  timestamp: string
  /** Duration in ms */
  duration: number
  /** Status (ok, error, timeout) */
  status: "ok" | "error" | "timeout"
  /** Error message if status is error */
  error?: string
  /** Trace/span IDs */
  traceId?: string
  spanId?: string
}

export interface RelatedError {
  /** Error message */
  message: string
  /** Number of occurrences */
  count: number
  /** First seen timestamp */
  firstSeen: string
  /** Last seen timestamp */
  lastSeen: string
  /** Affected services */
  services: string[]
}

export interface LogsInput {
  /** Search query */
  query: string
  /** Service filter */
  service?: string
  /** Log level filter */
  level?: "debug" | "info" | "warn" | "error" | "fatal"
  /** Time range */
  timeRange?: string
  /** Maximum number of results */
  limit?: number
}

export interface LogEntry {
  /** Timestamp */
  timestamp: string
  /** Log level */
  level: string
  /** Service name */
  service: string
  /** Log message */
  message: string
  /** Structured attributes */
  attributes?: Record<string, unknown>
  /** Trace ID for correlation */
  traceId?: string
}

export interface MetricsInput {
  /** Metric name or pattern */
  metric: string
  /** Service filter */
  service?: string
  /** Time range */
  timeRange?: string
  /** Aggregation (avg, sum, max, min, p95, p99) */
  aggregation?: "avg" | "sum" | "max" | "min" | "p95" | "p99"
}

export interface MetricSeries {
  /** Metric name */
  name: string
  /** Service name */
  service: string
  /** Data points */
  points: MetricPoint[]
  /** Tags/labels */
  tags: Record<string, string>
}

export interface MetricPoint {
  /** Timestamp */
  timestamp: string
  /** Value */
  value: number
}

export interface ProfileInput {
  /** Service to profile */
  service: string
  /** Profile type */
  type: "cpu" | "memory" | "goroutine" | "block" | "mutex"
  /** Duration in seconds */
  duration?: number
}

export interface ProfileResult {
  /** Profile type */
  type: string
  /** Service name */
  service: string
  /** Top hotspots */
  hotspots: ProfileHotspot[]
  /** Flame graph URL (if available) */
  flameGraphUrl?: string
  /** Raw profile data URL */
  profileUrl?: string
}

export interface ProfileHotspot {
  /** Function/method name */
  function: string
  /** File location */
  file: string
  /** Line number */
  line: number
  /** Percentage of samples */
  percentage: number
  /** Sample count */
  samples: number
}

export interface DebugConfig {
  /** Datadog API configuration */
  datadog?: {
    apiKey: string
    appKey: string
    site?: string
  }
  /** Sentry configuration */
  sentry?: {
    authToken: string
    organization: string
    project?: string
  }
  /** Default time range for queries */
  defaultTimeRange?: string
  /** Default service filter */
  defaultService?: string
}

export type DebugLanguage = "python" | "javascript" | "typescript" | "rust" | "cpp" | "c" | "go" | "java" | "csharp"

export type StepAction = "into" | "over" | "out"

export interface BreakpointInput {
  filePath: string
  line: number
  condition?: string
  hitCondition?: string
  logMessage?: string
}

export interface Breakpoint {
  id: string
  filePath: string
  line: number
  verified: boolean
  condition?: string
  hitCount?: number
}

export interface LaunchInput {
  program: string
  language: DebugLanguage
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  stopOnEntry?: boolean
}

export interface AttachInput {
  processId?: number
  port?: number
  host?: string
  language: DebugLanguage
}

export interface DebugSession {
  id: string
  language: DebugLanguage
  program: string
  status: "running" | "paused" | "stopped" | "terminated"
  threadId?: number
}

export interface StackFrame {
  id: number
  name: string
  filePath: string
  line: number
  column: number
  moduleId?: string
}

export interface Variable {
  name: string
  value: string
  type: string
  variablesReference: number
  namedVariables?: number
  indexedVariables?: number
}

export interface Scope {
  name: string
  variablesReference: number
  expensive: boolean
  namedVariables?: number
  indexedVariables?: number
}

export interface EvaluateInput {
  expression: string
  frameId?: number
  context?: "watch" | "repl" | "hover" | "clipboard"
}

export interface EvaluateResult {
  result: string
  type?: string
  variablesReference: number
  namedVariables?: number
  indexedVariables?: number
}
