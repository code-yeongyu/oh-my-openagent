export type DbSubcommand =
  | "query"
  | "schema"
  | "migrate"
  | "analyze"
  | "optimize"
  | "explain"
  | "backup"
  | "seed"

export type DbType =
  | "postgresql"
  | "mysql"
  | "sqlite"
  | "mongodb"
  | "redis"
  | "elasticsearch"
  | "dynamodb"

export interface QueryInput {
  query: string
  database?: string
  params?: unknown[]
  limit?: number
  format?: "table" | "json" | "csv"
}

export interface QueryResult {
  rows: Record<string, unknown>[]
  rowCount: number
  duration: number
  columns: ColumnInfo[]
}

export interface ColumnInfo {
  name: string
  type: string
  nullable: boolean
}

export interface SchemaInput {
  database?: string
  table?: string
  action?: "show" | "create" | "alter" | "drop"
}

export interface SchemaResult {
  tables: TableSchema[]
  views?: ViewSchema[]
  indexes?: IndexSchema[]
  constraints?: ConstraintSchema[]
}

export interface TableSchema {
  name: string
  columns: ColumnSchema[]
  primaryKey?: string[]
  indexes?: IndexSchema[]
  foreignKeys?: ForeignKeySchema[]
}

export interface ColumnSchema {
  name: string
  type: string
  nullable: boolean
  defaultValue?: string
  autoIncrement?: boolean
  comment?: string
}

export interface ViewSchema {
  name: string
  definition: string
  columns: string[]
}

export interface IndexSchema {
  name: string
  table: string
  columns: string[]
  unique: boolean
  type?: string
}

export interface ConstraintSchema {
  name: string
  type: "primary" | "foreign" | "unique" | "check"
  table: string
  columns: string[]
  reference?: { table: string; columns: string[] }
}

export interface ForeignKeySchema {
  name: string
  columns: string[]
  referencedTable: string
  referencedColumns: string[]
  onDelete?: string
  onUpdate?: string
}

export interface MigrateInput {
  action: "status" | "up" | "down" | "create" | "generate"
  name?: string
  steps?: number
  dryRun?: boolean
}

export interface MigrateResult {
  action: string
  migrations: MigrationInfo[]
  applied?: number
  pending?: number
}

export interface MigrationInfo {
  id: string
  name: string
  status: "applied" | "pending" | "failed"
  appliedAt?: string
  duration?: number
}

export interface AnalyzeInput {
  table?: string
  query?: string
  includeSlowQueries?: boolean
}

export interface AnalyzeResult {
  statistics: TableStats[]
  slowQueries?: SlowQuery[]
  recommendations: DbRecommendation[]
}

export interface TableStats {
  table: string
  rowCount: number
  sizeBytes: number
  indexSizeBytes: number
  lastAnalyzed?: string
  bloatPercent?: number
}

export interface SlowQuery {
  query: string
  duration: number
  frequency: number
  lastExecuted: string
  suggestions?: string[]
}

export interface DbRecommendation {
  type: "index" | "query" | "schema" | "maintenance"
  priority: "high" | "medium" | "low"
  table?: string
  message: string
  sql?: string
}

export interface OptimizeInput {
  target: "query" | "table" | "index"
  query?: string
  table?: string
}

export interface OptimizeResult {
  original?: string
  optimized?: string
  improvement?: number
  suggestions: OptimizeSuggestion[]
}

export interface OptimizeSuggestion {
  type: string
  description: string
  impact: "high" | "medium" | "low"
  sql?: string
}

export interface ExplainInput {
  query: string
  analyze?: boolean
  format?: "text" | "json" | "yaml"
}

export interface ExplainResult {
  plan: QueryPlan
  cost: number
  rows: number
  actualTime?: number
  warnings?: string[]
}

export interface QueryPlan {
  operation: string
  details: string
  cost: number
  rows: number
  children?: QueryPlan[]
  actualTime?: number
  loops?: number
}

export interface BackupInput {
  target: string
  format?: "sql" | "binary" | "archive"
  compress?: boolean
  tables?: string[]
}

export interface BackupResult {
  path: string
  size: number
  duration: number
  tables: number
  rows: number
}

export interface SeedInput {
  source: string
  table?: string
  truncate?: boolean
  count?: number
}

export interface SeedResult {
  tables: SeedTableResult[]
  totalRows: number
  duration: number
}

export interface SeedTableResult {
  table: string
  inserted: number
  errors: number
}

export interface DbConfig {
  connections?: Record<string, ConnectionConfig>
  defaultConnection?: string
  migrationsPath?: string
  seedsPath?: string
}

export interface ConnectionConfig {
  type: DbType
  host?: string
  port?: number
  database: string
  user?: string
  password?: string
  ssl?: boolean
  uri?: string
}
