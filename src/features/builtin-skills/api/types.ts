export type ApiSubcommand =
  | "design"
  | "document"
  | "validate"
  | "generate"
  | "test"
  | "mock"
  | "diff"
  | "lint"

export type ApiSpecFormat =
  | "openapi3"
  | "openapi2"
  | "asyncapi"
  | "graphql"
  | "grpc"
  | "json-schema"

export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS"

export interface DesignInput {
  description: string
  style?: "rest" | "graphql" | "grpc" | "event-driven"
  version?: string
  baseUrl?: string
}

export interface DesignResult {
  spec: string
  format: ApiSpecFormat
  endpoints: EndpointSummary[]
  schemas: SchemaSummary[]
  suggestions?: DesignSuggestion[]
}

export interface EndpointSummary {
  method: HttpMethod
  path: string
  operationId: string
  summary: string
  tags?: string[]
}

export interface SchemaSummary {
  name: string
  type: "object" | "array" | "enum" | "union"
  properties?: number
  required?: number
}

export interface DesignSuggestion {
  type: "naming" | "structure" | "security" | "versioning" | "pagination"
  message: string
  location?: string
}

export interface DocumentInput {
  source: string
  format?: ApiSpecFormat
  outputFormat?: "markdown" | "html" | "pdf"
  includeExamples?: boolean
}

export interface DocumentResult {
  documentation: string
  format: string
  sections: DocSection[]
}

export interface DocSection {
  title: string
  anchor: string
  level: number
  content?: string
}

export interface ValidateInput {
  spec: string
  format?: ApiSpecFormat
  rules?: string[]
  severity?: "error" | "warning" | "info"
}

export interface ValidateResult {
  valid: boolean
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
  info: ValidationIssue[]
  score?: number
}

export interface ValidationIssue {
  code: string
  message: string
  path: string
  line?: number
  severity: "error" | "warning" | "info"
  suggestion?: string
}

export interface GenerateInput {
  spec: string
  target: "client" | "server" | "types" | "mocks"
  language: string
  framework?: string
  outputPath?: string
}

export interface GenerateResult {
  files: GeneratedFile[]
  language: string
  framework?: string
}

export interface GeneratedFile {
  path: string
  content: string
  type: "code" | "config" | "types"
}

export interface TestInput {
  spec: string
  baseUrl: string
  auth?: AuthConfig
  coverage?: boolean
}

export interface AuthConfig {
  type: "bearer" | "basic" | "apikey" | "oauth2"
  credentials: Record<string, string>
}

export interface TestResult {
  total: number
  passed: number
  failed: number
  skipped: number
  duration: number
  results: EndpointTestResult[]
  coverage?: CoverageReport
}

export interface EndpointTestResult {
  endpoint: string
  method: HttpMethod
  status: "passed" | "failed" | "skipped"
  duration: number
  statusCode?: number
  error?: string
}

export interface CoverageReport {
  endpoints: { covered: number; total: number; percent: number }
  methods: { covered: number; total: number; percent: number }
  statusCodes: { covered: number; total: number; percent: number }
}

export interface MockInput {
  spec: string
  port?: number
  delay?: number
  dynamic?: boolean
}

export interface MockResult {
  url: string
  port: number
  endpoints: number
  status: "running" | "stopped"
}

export interface DiffInput {
  oldSpec: string
  newSpec: string
  format?: "text" | "json" | "markdown"
}

export interface DiffResult {
  breaking: ApiChange[]
  nonBreaking: ApiChange[]
  summary: DiffSummary
}

export interface ApiChange {
  type: "added" | "removed" | "modified" | "deprecated"
  path: string
  description: string
  breaking: boolean
}

export interface DiffSummary {
  added: number
  removed: number
  modified: number
  deprecated: number
  breakingChanges: number
}

export interface LintInput {
  spec: string
  ruleset?: string
  fix?: boolean
}

export interface LintResult {
  issues: LintIssue[]
  fixed?: number
  score: number
}

export interface LintIssue {
  rule: string
  message: string
  path: string
  severity: "error" | "warning" | "info"
  fixable: boolean
}

export interface ApiConfig {
  defaultFormat?: ApiSpecFormat
  lintRuleset?: string
  generateDefaults?: {
    language?: string
    framework?: string
  }
}
