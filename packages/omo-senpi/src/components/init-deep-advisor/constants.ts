export const MISSING_COVERAGE_RATIO_THRESHOLD = 0.5

export const CANDIDATE_MIN_FILES = 8
export const CANDIDATE_MIN_LOC = 500
export const CANDIDATE_MAX_DEPTH = 3

export const COMMIT_DISTANCE_THRESHOLD = 30
export const TOUCHED_RATIO_THRESHOLD = 0.15
export const CHURN_LOC_RATIO_THRESHOLD = 0.25
export const DAYS_SINCE_THRESHOLD = 90

export const COOLDOWN_DAYS = 7
export const MS_PER_DAY = 86_400_000

export const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".rb",
  ".php",
  ".c",
  ".cpp",
  ".cs",
  ".scala",
  ".lua",
  ".ex",
  ".exs",
  ".zig",
  ".dart",
])

export const EXCLUDED_DIR_NAMES: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "vendor",
  ".next",
  "__pycache__",
  ".venv",
  "target",
  "coverage",
  "third_party",
])
