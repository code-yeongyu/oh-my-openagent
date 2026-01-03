export type PerfSubcommand =
  | "profile"
  | "trace"
  | "benchmark"
  | "analyze"
  | "compare"
  | "flamegraph"
  | "memory"
  | "cpu"

export type PerfLanguage =
  | "typescript"
  | "javascript"
  | "python"
  | "rust"
  | "go"
  | "java"
  | "cpp"
  | "c"

export type ProfileType =
  | "cpu"
  | "memory"
  | "heap"
  | "wall"
  | "io"
  | "lock"

export interface ProfileInput {
  target: string
  type?: ProfileType
  duration?: number
  sampleRate?: number
  outputFormat?: "flamegraph" | "json" | "pprof" | "collapsed"
}

export interface ProfileResult {
  profileId: string
  type: ProfileType
  duration: number
  samples: number
  topFunctions: FunctionProfile[]
  hotspots: Hotspot[]
  outputPath?: string
}

export interface FunctionProfile {
  name: string
  selfTime: number
  totalTime: number
  selfPercent: number
  totalPercent: number
  samples: number
  callers?: string[]
  callees?: string[]
}

export interface Hotspot {
  location: string
  line: number
  selfTime: number
  description: string
  suggestion?: string
}

export interface TraceInput {
  target: string
  traceType?: "async" | "sync" | "all"
  maxDepth?: number
  includeArgs?: boolean
}

export interface TraceResult {
  traceId: string
  duration: number
  events: TraceEvent[]
  summary: TraceSummary
}

export interface TraceEvent {
  name: string
  category: string
  timestamp: number
  duration?: number
  args?: Record<string, unknown>
  stackTrace?: string[]
}

export interface TraceSummary {
  totalEvents: number
  totalDuration: number
  longestEvent: { name: string; duration: number }
  mostFrequent: { name: string; count: number }
}

export interface BenchmarkInput {
  target: string
  iterations?: number
  warmup?: number
  name?: string
  baseline?: string
}

export interface BenchmarkResult {
  name: string
  iterations: number
  meanTime: number
  stdDev: number
  minTime: number
  maxTime: number
  opsPerSecond: number
  percentiles: {
    p50: number
    p90: number
    p95: number
    p99: number
  }
  comparison?: BenchmarkComparison
}

export interface BenchmarkComparison {
  baselineName: string
  speedup: number
  percentChange: number
  significant: boolean
}

export interface AnalyzeInput {
  profilePath?: string
  tracePath?: string
  threshold?: number
}

export interface AnalyzeResult {
  summary: string
  bottlenecks: Bottleneck[]
  recommendations: Recommendation[]
  metrics: PerformanceMetrics
}

export interface Bottleneck {
  location: string
  type: "cpu" | "memory" | "io" | "lock" | "gc"
  severity: "critical" | "high" | "medium" | "low"
  impact: number
  description: string
}

export interface Recommendation {
  priority: number
  category: string
  title: string
  description: string
  estimatedImpact: string
  codeExample?: string
}

export interface PerformanceMetrics {
  cpuTime: number
  wallTime: number
  memoryPeak: number
  memoryAllocated: number
  gcPauses?: number
  gcTime?: number
  ioWait?: number
}

export interface MemoryInput {
  target: string
  trackAllocations?: boolean
  detectLeaks?: boolean
  snapshotInterval?: number
}

export interface MemoryResult {
  heapSize: number
  heapUsed: number
  external: number
  allocations: AllocationInfo[]
  leaks?: LeakInfo[]
  gcStats?: GCStats
}

export interface AllocationInfo {
  type: string
  count: number
  size: number
  location?: string
}

export interface LeakInfo {
  location: string
  size: number
  retainedBy: string[]
  confidence: number
}

export interface GCStats {
  collections: number
  totalPauseTime: number
  averagePauseTime: number
  maxPauseTime: number
}

export interface PerfConfig {
  defaultProfileType?: ProfileType
  defaultDuration?: number
  outputDirectory?: string
  retainProfiles?: number
}
