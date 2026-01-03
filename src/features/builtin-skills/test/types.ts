export type TestSubcommand = "run" | "generate" | "coverage" | "matrix"

export type Language = "typescript" | "javascript" | "python" | "go" | "rust" | "java" | "kotlin" | "csharp"

export type TestFramework =
  | "jest" | "vitest" | "mocha" | "playwright" | "cypress"
  | "pytest" | "unittest" | "hypothesis"
  | "go-test" | "testify" | "ginkgo"
  | "cargo-test" | "proptest"
  | "junit" | "testng" | "mockito" | "spock"
  | "xunit" | "nunit" | "mstest"

export interface RunInput {
  language?: Language
  framework?: TestFramework
  pattern?: string
  file?: string
  directory?: string
  watch?: boolean
  coverage?: boolean
  updateSnapshots?: boolean
  bail?: boolean
  grep?: string
  timeout?: number
  reporter?: "default" | "verbose" | "json" | "junit" | "tap"
  parallel?: boolean
  tags?: string[]
}

export interface RunResult {
  language: Language
  framework: TestFramework
  total: number
  passed: number
  failed: number
  skipped: number
  duration: number
  coverage?: CoverageResult
  failures: TestFailure[]
  suites: TestSuite[]
}

export interface TestSuite {
  name: string
  file: string
  tests: number
  passed: number
  failed: number
  skipped: number
  duration: number
}

export interface TestFailure {
  name: string
  file: string
  line: number
  message: string
  expected?: string
  actual?: string
  stack?: string
}

export interface GenerateInput {
  file: string
  language?: Language
  type: "unit" | "integration" | "e2e" | "property" | "snapshot" | "benchmark"
  framework?: TestFramework
  functions?: string[]
  coverage?: boolean
  mocks?: boolean
  fixtures?: boolean
}

export interface GenerateResult {
  testFile: string
  language: Language
  framework: TestFramework
  tests: GeneratedTest[]
  mocks: GeneratedMock[]
  fixtures: GeneratedFixture[]
  imports: string[]
}

export interface GeneratedTest {
  name: string
  description: string
  type: "unit" | "integration" | "e2e" | "property" | "benchmark"
  code: string
}

export interface GeneratedMock {
  name: string
  target: string
  language: Language
  code: string
}

export interface GeneratedFixture {
  name: string
  type: "setup" | "teardown" | "data"
  scope: "test" | "suite" | "module" | "session"
  code: string
}

export interface CoverageInput {
  language?: Language
  directory?: string
  threshold?: CoverageThreshold
  include?: string[]
  exclude?: string[]
  reporter?: ("text" | "html" | "lcov" | "json" | "cobertura" | "jacoco")[]
}

export interface CoverageResult {
  language: Language
  tool: string
  lines: CoverageMetric
  statements: CoverageMetric
  functions: CoverageMetric
  branches: CoverageMetric
  files: FileCoverage[]
  uncovered: UncoveredCode[]
}

export interface CoverageMetric {
  total: number
  covered: number
  percentage: number
  threshold?: number
  passing: boolean
}

export interface CoverageThreshold {
  lines?: number
  statements?: number
  functions?: number
  branches?: number
}

export interface FileCoverage {
  file: string
  lines: number
  covered: number
  percentage: number
  uncoveredLines: number[]
}

export interface UncoveredCode {
  file: string
  startLine: number
  endLine: number
  type: "function" | "branch" | "statement"
  code: string
}

export interface MatrixInput {
  parameters: MatrixParameter[]
  constraints?: MatrixConstraint[]
  algorithm?: "pict" | "allpairs" | "exhaustive"
  coverage?: number
  outputFormat?: "json" | "csv" | "yaml" | "code"
  language?: Language
}

export interface MatrixParameter {
  name: string
  values: string[]
  weight?: number
}

export interface MatrixConstraint {
  if: Record<string, string>
  then?: Record<string, string>
  else?: Record<string, string>
}

export interface MatrixResult {
  combinations: MatrixCombination[]
  totalPossible: number
  generated: number
  coverage: number
  parameters: string[]
  code?: string
}

export interface MatrixCombination {
  id: number
  values: Record<string, string>
  priority?: "high" | "medium" | "low"
}

export interface E2EInput {
  url?: string
  scenario: string
  browser?: "chromium" | "firefox" | "webkit"
  headless?: boolean
  screenshots?: boolean
  video?: boolean
  trace?: boolean
  language?: Language
}

export interface E2EResult {
  passed: boolean
  duration: number
  steps: E2EStep[]
  screenshots?: string[]
  video?: string
  trace?: string
  errors: string[]
}

export interface E2EStep {
  action: string
  selector?: string
  value?: string
  duration: number
  passed: boolean
  screenshot?: string
  error?: string
}

export interface BenchmarkInput {
  file: string
  language?: Language
  functions?: string[]
  iterations?: number
  warmup?: number
  outputFormat?: "text" | "json" | "markdown"
}

export interface BenchmarkResult {
  benchmarks: Benchmark[]
  environment: BenchmarkEnvironment
}

export interface Benchmark {
  name: string
  iterations: number
  meanTime: number
  stdDev: number
  minTime: number
  maxTime: number
  opsPerSecond: number
  memoryUsage?: number
}

export interface BenchmarkEnvironment {
  os: string
  arch: string
  cpu: string
  memory: string
  runtime: string
  version: string
}

export interface TestConfig {
  defaultLanguage?: Language
  frameworks?: Partial<Record<Language, TestFramework>>
  coverageThreshold?: CoverageThreshold
  testDirectory?: string
  testPatterns?: Partial<Record<Language, string>>
  timeout?: number
  parallel?: boolean
}

export const LANGUAGE_FRAMEWORKS: Record<Language, TestFramework[]> = {
  typescript: ["jest", "vitest", "mocha", "playwright", "cypress"],
  javascript: ["jest", "vitest", "mocha", "playwright", "cypress"],
  python: ["pytest", "unittest", "hypothesis"],
  go: ["go-test", "testify", "ginkgo"],
  rust: ["cargo-test", "proptest"],
  java: ["junit", "testng", "mockito", "spock"],
  kotlin: ["junit", "testng", "mockito", "spock"],
  csharp: ["xunit", "nunit", "mstest"],
}

export const LANGUAGE_COVERAGE_TOOLS: Record<Language, string[]> = {
  typescript: ["istanbul", "c8", "vitest"],
  javascript: ["istanbul", "c8", "nyc"],
  python: ["coverage.py", "pytest-cov"],
  go: ["go cover", "gocov"],
  rust: ["cargo-tarpaulin", "cargo-llvm-cov", "grcov"],
  java: ["jacoco", "cobertura", "clover"],
  kotlin: ["jacoco", "kover"],
  csharp: ["coverlet", "dotcover", "opencover"],
}
