// search.ts — structural search tool for the ast_grep MCP server
// Implements the ub §3/§5/§6 contract exactly.

import {
  DEFAULT_MATCHES,
  MAX_MATCHES,
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  SgRunnerError,
  spawnSgRunner,
} from "../sg-runner";
import { normalizeRecords, type NormalizedMatch } from "../normalize";
import { validatePatternHints } from "../pattern-hints";

// ---- constants ----

const MAX_PATTERN_BYTES = 16 * 1024;
const MAX_GLOBS = 32;
const MAX_PATHS = 64;
const MIN_TIMEOUT_MS = 1000;
const MAX_PATH_LEN = 4096;
const MAX_GLOB_LEN = 1024;
const MAX_SELECTOR_LEN = 128;
const MAX_WORKDIR_LEN = 4096;

export const SEARCH_TOOL_NAME = "search" as const;

// ub §3 model-facing description — VERBATIM, do not modify
export const SEARCH_TOOL_DESCRIPTION =
  "Search code structurally with ast-grep. The pattern is code, not regex, and must parse as one AST node in the required language; use narrow paths. `$NAME` and `$_` match one whole node, while `$$$NAME` and `$$$` match zero-or-more nodes. Names are uppercase, `$$NAME` is invalid, partial-token captures do not work, and a repeated metavariable must match identical code. Wrap non-standalone syntax and use `selector` when needed. Parse warnings mean the query failed, not that the code is absent.";

// ---- input schema ----

const LANGUAGES = [
  "bash", "c", "cpp", "csharp", "css", "elixir", "go", "haskell", "html",
  "java", "javascript", "json", "kotlin", "lua", "nix", "php", "python",
  "ruby", "rust", "scala", "solidity", "swift", "typescript", "tsx", "yaml",
] as const;

// ub §3: strictness enum exactly [cst, smart, ast, relaxed, signature] — "template" excluded
const STRICTNESS = ["cst", "smart", "ast", "relaxed", "signature"] as const;

export interface SearchInput {
  readonly pattern: string;
  readonly language: (typeof LANGUAGES)[number];
  readonly paths: readonly string[];
  readonly workdir?: string;
  readonly globs?: readonly string[];
  readonly selector?: string;
  readonly strictness?: (typeof STRICTNESS)[number];
  readonly maxMatches?: number;
  readonly timeoutMs?: number;
  readonly includeHidden?: boolean;
  readonly followSymlinks?: boolean;
  readonly force?: boolean;
}

type ParseError = { ok: false; error: string };
type ParseSuccess = { ok: true; value: SearchInput };
type ParseResult = ParseError | ParseSuccess;

// JSON Schema maxLength counts Unicode code points, not UTF-16 code units.
function codePoints(value: string): number {
  let count = 0;
  for (const _ of value) count++;
  return count;
}

export const searchInputSchema = {
  parse(input: unknown): SearchInput {
    const result = parseSearchInput(input);
    if (!result.ok) throw new Error(result.error);
    return result.value;
  },
};

function parseSearchInput(input: unknown): ParseResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, error: "Input must be an object" };
  }
  const obj = input as Record<string, unknown>;

  // pattern (required, string, minLength 1, ≤16KiB)
  if (typeof obj.pattern !== "string") return { ok: false, error: "pattern must be a string" };
  if (obj.pattern.length === 0) return { ok: false, error: "pattern must be at least 1 character" };
  if (Buffer.byteLength(obj.pattern, "utf8") > MAX_PATTERN_BYTES) {
    return { ok: false, error: "pattern must be at most 16384 bytes" };
  }

  // language (required, enum of 25 canonical names)
  if (typeof obj.language !== "string" || !(LANGUAGES as readonly string[]).includes(obj.language)) {
    return { ok: false, error: `language must be one of: ${LANGUAGES.join(", ")}` };
  }

  // paths (required, 1-64 non-empty strings, each ≤4096 code points)
  if (!Array.isArray(obj.paths)) return { ok: false, error: "paths must be an array" };
  if (obj.paths.length < 1 || obj.paths.length > MAX_PATHS) {
    return { ok: false, error: `paths must have 1-${MAX_PATHS} entries` };
  }
  for (const p of obj.paths) {
    if (typeof p !== "string" || p.length === 0) return { ok: false, error: "each path must be a non-empty string" };
    if (codePoints(p) > MAX_PATH_LEN) return { ok: false, error: `each path must be at most ${MAX_PATH_LEN} characters` };
  }

  // workdir (optional, non-empty string, ≤4096 code points)
  if (obj.workdir !== undefined) {
    if (typeof obj.workdir !== "string") return { ok: false, error: "workdir must be a string" };
    if (obj.workdir.length === 0) return { ok: false, error: "workdir must be at least 1 character" };
    if (codePoints(obj.workdir) > MAX_WORKDIR_LEN) return { ok: false, error: `workdir must be at most ${MAX_WORKDIR_LEN} characters` };
  }

  // globs (optional, ≤32 items, each non-empty ≤1024 code points)
  if (obj.globs !== undefined) {
    if (!Array.isArray(obj.globs)) return { ok: false, error: "globs must be an array" };
    if (obj.globs.length > MAX_GLOBS) return { ok: false, error: `globs must have at most ${MAX_GLOBS} entries` };
    for (const g of obj.globs) {
      if (typeof g !== "string" || g.length === 0) return { ok: false, error: "each glob must be a non-empty string" };
      if (codePoints(g) > MAX_GLOB_LEN) return { ok: false, error: `each glob must be at most ${MAX_GLOB_LEN} characters` };
    }
  }

  // selector (optional, non-empty string, ≤128 code points)
  if (obj.selector !== undefined) {
    if (typeof obj.selector !== "string") return { ok: false, error: "selector must be a string" };
    if (obj.selector.length === 0) return { ok: false, error: "selector must be at least 1 character" };
    if (codePoints(obj.selector) > MAX_SELECTOR_LEN) return { ok: false, error: `selector must be at most ${MAX_SELECTOR_LEN} characters` };
  }

  // strictness (optional, enum [cst, smart, ast, relaxed, signature], default "smart")
  let strictness: (typeof STRICTNESS)[number] = "smart";
  if (obj.strictness !== undefined) {
    if (typeof obj.strictness !== "string" || !(STRICTNESS as readonly string[]).includes(obj.strictness)) {
      return { ok: false, error: `strictness must be one of: ${STRICTNESS.join(", ")}` };
    }
    strictness = obj.strictness as (typeof STRICTNESS)[number];
  }

  // maxMatches (optional, integer 1-500, default 50)
  let maxMatches = DEFAULT_MATCHES;
  if (obj.maxMatches !== undefined) {
    if (typeof obj.maxMatches !== "number" || !Number.isInteger(obj.maxMatches) || obj.maxMatches < 1 || obj.maxMatches > MAX_MATCHES) {
      return { ok: false, error: `maxMatches must be an integer between 1 and ${MAX_MATCHES}` };
    }
    maxMatches = obj.maxMatches;
  }

  // timeoutMs (optional, integer 1000-300000, default 300000)
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (obj.timeoutMs !== undefined) {
    if (typeof obj.timeoutMs !== "number" || !Number.isInteger(obj.timeoutMs) || obj.timeoutMs < MIN_TIMEOUT_MS || obj.timeoutMs > MAX_TIMEOUT_MS) {
      return { ok: false, error: `timeoutMs must be an integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}` };
    }
    timeoutMs = obj.timeoutMs;
  }

  // includeHidden (optional, boolean)
  if (obj.includeHidden !== undefined && typeof obj.includeHidden !== "boolean") {
    return { ok: false, error: "includeHidden must be a boolean" };
  }

  // followSymlinks (optional, boolean)
  if (obj.followSymlinks !== undefined && typeof obj.followSymlinks !== "boolean") {
    return { ok: false, error: "followSymlinks must be a boolean" };
  }

  // force (optional, boolean)
  if (obj.force !== undefined && typeof obj.force !== "boolean") {
    return { ok: false, error: "force must be a boolean" };
  }

  // additionalProperties: false — reject unknown keys
  const known = new Set([
    "pattern", "language", "paths", "workdir", "globs", "selector",
    "strictness", "maxMatches", "timeoutMs", "includeHidden", "followSymlinks", "force",
  ]);
  for (const key of Object.keys(obj)) {
    if (!known.has(key)) return { ok: false, error: `Unknown property: ${key}` };
  }

  return {
    ok: true,
    value: {
      pattern: obj.pattern,
      language: obj.language as SearchInput["language"],
      paths: obj.paths as string[],
      workdir: obj.workdir,
      globs: obj.globs as string[] | undefined,
      selector: obj.selector,
      strictness,
      maxMatches,
      timeoutMs,
      includeHidden: obj.includeHidden as boolean | undefined,
      followSymlinks: obj.followSymlinks as boolean | undefined,
      force: obj.force as boolean | undefined,
    },
  };
}

// ---- CLI translation (ub §3) ----

export function buildSearchArgs(input: SearchInput): string[] {
  const args: string[] = ["run", "-p", input.pattern, "--lang", input.language, "--json=stream"];

  // strictness (always emitted, defaults to "smart")
  args.push("--strictness", input.strictness ?? "smart");

  // selector (optional)
  if (input.selector) args.push("--selector", input.selector);

  // globs (optional, each as --globs <glob>)
  if (input.globs) for (const glob of input.globs) args.push("--globs", glob);

  // includeHidden → --no-ignore hidden ONLY
  if (input.includeHidden) args.push("--no-ignore", "hidden");

  // followSymlinks → --follow
  if (input.followSymlinks) args.push("--follow");

  // paths (required, appended last)
  args.push(...input.paths);

  return args;
}

// ---- error taxonomy (ub §6) ----

export type SearchErrorCode =
  | "INVALID_ARGUMENT"
  | "BINARY_NOT_FOUND"
  | "BINARY_INVALID"
  | "UNSUPPORTED_LANGUAGE"
  | "PATTERN_HINT_REJECTED"
  | "PATTERN_PARSE_FAILED"
  | "REWRITE_UNBOUND_METAVARIABLE"
  | "REWRITE_METAVARIABLE_KIND_MISMATCH"
  | "PATH_NOT_FOUND"
  | "PATH_UNREADABLE"
  | "TIMEOUT"
  | "ABORTED"
  | "OUTPUT_TOO_LARGE"
  | "OUTPUT_PARSE_FAILED"
  | "PREVIEW_TRUNCATED"
  | "REWRITE_STALE_PREVIEW"
  | "SG_FAILED"
  | "ENCODING_ERROR";

const RETRYABLE_CODES: ReadonlySet<SearchErrorCode> = new Set<SearchErrorCode>([
  "TIMEOUT",
  "ABORTED",
  "OUTPUT_PARSE_FAILED",
  "REWRITE_STALE_PREVIEW",
]);

// ---- output types (ub §5/§6) ----

export interface SearchSuccessPayload {
  readonly schemaVersion: 1;
  readonly ok: true;
  readonly kind: "search";
  readonly workdir: string;
  readonly matches: NormalizedMatch[];
  readonly counts: {
    readonly returnedMatches: number;
    readonly returnedFiles: number;
    readonly totalMatches: number | null;
    readonly totalFiles: number | null;
    readonly atLeastMatches: number;
  };
  readonly truncation: {
    readonly truncated: boolean;
    readonly reason: "match_limit" | "output_cap" | "sg_output_truncated" | null;
    readonly maxMatches: number;
    readonly maxPayloadBytes: number;
    readonly salvagedRecords: number;
  };
  readonly warnings: string[];
  readonly durationMs: number;
}

export interface SearchErrorPayload {
  readonly schemaVersion: 1;
  readonly ok: false;
  readonly error: {
    readonly code: SearchErrorCode;
    readonly message: string;
    readonly retryable: boolean;
    readonly phase: "search" | "preflight";
    readonly language: string;
    readonly details: {
      readonly stderr: string;
      readonly hint: string;
    };
  };
}

export type SearchPayload = SearchSuccessPayload | SearchErrorPayload;

// ---- pattern parse failure detection ----

// sg emits "Warning: Pattern contains an ERROR node" on stderr when the pattern
// is malformed but still parsed. The runner's hasSgErrorDiagnostic check looks
// for lines STARTING with "ERROR" or "error:" — the warning line starts with
// "Warning:" so it passes through undetected. We scan stderr ourselves.
const ERROR_NODE_RE = /Pattern contains an ERROR node/i;

function detectPatternParseFailure(stderr: string): boolean {
  return ERROR_NODE_RE.test(stderr);
}

function makeError(
  code: SearchErrorCode,
  message: string,
  language: string,
  phase: "search" | "preflight",
  stderr: string,
  hint: string,
  durationMs: number,
): SearchErrorPayload {
  return {
    schemaVersion: 1,
    ok: false,
    error: {
      code,
      message,
      retryable: RETRYABLE_CODES.has(code),
      phase,
      language,
      details: { stderr, hint },
    },
  };
}

// ---- main entry ----

const LIMIT_WARNING = "Result limit reached; narrow paths or globs.";

export async function executeSearch(
  input: SearchInput,
  sgPath: string,
  signal?: AbortSignal,
): Promise<SearchPayload> {
  const startedAt = performance.now();
  const workdir = input.workdir ?? process.cwd();
  const maxMatches = input.maxMatches ?? DEFAULT_MATCHES;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Preflight: pattern hint validation
  const validation = validatePatternHints(input.pattern, input.language, {
    force: input.force,
    paths: input.paths,
    limit: maxMatches,
  });
  if (validation.rejected) {
    const rejectHint = validation.hints.find((h) => h.severity === "always-reject" || h.severity === "reject");
    return makeError(
      (validation.code ?? "INVALID_ARGUMENT") as SearchErrorCode,
      rejectHint?.message ?? "Pattern validation failed",
      input.language,
      "preflight",
      "",
      validation.hints.map((h) => h.message).join("; "),
      Math.round(performance.now() - startedAt),
    );
  }

  // Build CLI args
  const args = buildSearchArgs(input);

  // Execute via runner
  let runnerResult;
  try {
    runnerResult = await spawnSgRunner({
      sgPath,
      args,
      workdir,
      maxMatches,
      timeoutMs,
      signal,
    });
  } catch (error) {
    if (error instanceof SgRunnerError) {
      return makeError(
        error.code as SearchErrorCode,
        error.message,
        input.language,
        "search",
        error.stderr,
        "",
        error.durationMs,
      );
    }
    return makeError(
      "SG_FAILED",
      error instanceof Error ? error.message : String(error),
      input.language,
      "search",
      "",
      "",
      Math.round(performance.now() - startedAt),
    );
  }

  // Check for pattern parse failure via stderr (even on exit 0)
  if (detectPatternParseFailure(runnerResult.stderr)) {
    return makeError(
      "PATTERN_PARSE_FAILED",
      "Pattern did not parse as one " + input.language + " AST node.",
      input.language,
      "search",
      runnerResult.stderr,
      "Use a complete function, call, declaration, or wrapped context.",
      runnerResult.durationMs,
    );
  }

  // Collect warnings from hint validation (non-rejecting hints)
  const warnings = validation.hints.map((h) => h.message);

  // Normalize records
  const matches = normalizeRecords(runnerResult.records, workdir);

  // Count unique files
  const fileSet = new Set(matches.map((m) => m.path));
  const returnedFiles = fileSet.size;

  const truncated = runnerResult.truncated;
  const reason = runnerResult.reason;

  // When truncated, totalMatches/totalFiles are null (unknown)
  // When not truncated, they equal the returned counts
  const totalMatches = truncated ? null : matches.length;
  const totalFiles = truncated ? null : returnedFiles;

  // Add the limit warning when truncated due to match_limit
  if (truncated) {
    warnings.push(LIMIT_WARNING);
  }

  return {
    schemaVersion: 1,
    ok: true,
    kind: "search",
    workdir,
    matches,
    counts: {
      returnedMatches: matches.length,
      returnedFiles,
      totalMatches,
      totalFiles,
      atLeastMatches: runnerResult.atLeastMatches,
    },
    truncation: {
      truncated,
      reason,
      maxMatches,
      maxPayloadBytes: runnerResult.maxPayloadBytes,
      salvagedRecords: runnerResult.salvagedRecords,
    },
    warnings,
    durationMs: runnerResult.durationMs,
  };
}
