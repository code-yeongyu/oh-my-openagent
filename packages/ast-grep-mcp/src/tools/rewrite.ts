// rewrite.ts — AST-aware rewrite tool for the ast_grep MCP server.
// Implements the plan todo 6 contract (ub §4 schema/flow, §5 payload shape, §6 taxonomy):
// dry-run by default, mandatory metavariable preflight that `force` can never bypass,
// and a two-pass apply (JSON preview, then a separate `--update-all` process) because
// `sg` cannot combine JSON output with mutation.

import { normalizeRecords, type NormalizedMatch } from "../normalize";
import { validateRewriteHints } from "../pattern-hints";
import {
  DEFAULT_MATCHES,
  DEFAULT_TIMEOUT_MS,
  MAX_MATCHES,
  MAX_TIMEOUT_MS,
  SgRunnerError,
  spawnSgRunner,
} from "../sg-runner";

// ---- constants ----

const MAX_PATTERN_BYTES = 16 * 1024;
const MAX_REWRITE_BYTES = 64 * 1024;
const MAX_PATHS = 64;
const MAX_PATH_CHARS = 4096;
const MAX_GLOBS = 32;
const MAX_GLOB_CHARS = 1024;
const MAX_SELECTOR_CHARS = 128;
const MAX_WORKDIR_CHARS = 4096;
const MIN_TIMEOUT_MS = 1_000;

export const REWRITE_TOOL_NAME = "rewrite" as const;

// Verbatim model-facing description from the work plan (todo 6 / ub §4).
export const REWRITE_TOOL_DESCRIPTION =
  "Preview or apply an AST-aware rewrite. The pattern follows the same metavariable rules as `search`; the replacement may only reference metavariables captured by the pattern, and an empty replacement deletes the match. Dry-run is the default. Apply uses a JSON preview followed by a separate `--update-all` process because `sg` cannot safely combine JSON output and mutation. Truncated previews are never applied, and rewrite idempotency is not guaranteed.";

const APPLY_PREVIEW_WARNING =
  "Mutation counts are based on the preview pass; sg update-all does not return equivalent JSON.";

const LANGUAGES = [
  "bash", "c", "cpp", "csharp", "css", "elixir", "go", "haskell", "html",
  "java", "javascript", "json", "kotlin", "lua", "nix", "php", "python",
  "ruby", "rust", "scala", "solidity", "swift", "typescript", "tsx", "yaml",
] as const;

const STRICTNESS = ["cst", "smart", "ast", "relaxed", "signature"] as const;

// ---- input ----

export interface RewriteInput {
  readonly pattern: string;
  readonly rewrite: string;
  readonly language: (typeof LANGUAGES)[number];
  readonly paths: readonly string[];
  readonly workdir?: string;
  readonly globs?: readonly string[];
  readonly selector?: string;
  readonly strictness: (typeof STRICTNESS)[number];
  readonly apply: boolean;
  readonly maxMatches: number;
  readonly timeoutMs: number;
  readonly includeHidden?: boolean;
  readonly followSymlinks?: boolean;
  readonly force?: boolean;
}

/**
 * Length in UNICODE CODE POINTS, not UTF-16 code units.
 *
 * The contract's per-string maxLength values are character counts, so a path,
 * glob or selector built from astral characters (each of which occupies two
 * UTF-16 units) must be accepted at exactly the limit. A naive `.length` check
 * would silently halve the usable length for any non-BMP string.
 *
 * NOTE: `pattern` and `rewrite` are deliberately NOT measured this way — the
 * contract bounds those in KiB, so they stay byte-measured via Buffer.byteLength.
 */
function codePointLength(value: string): number {
  return [...value].length;
}

const KNOWN_KEYS = new Set([
  "pattern", "rewrite", "language", "paths", "workdir", "globs", "selector",
  "strictness", "apply", "maxMatches", "timeoutMs", "includeHidden", "followSymlinks", "force",
]);

function parseRewriteInput(input: unknown): RewriteInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Input must be an object");
  }
  const obj = input as Record<string, unknown>;

  for (const key of Object.keys(obj)) {
    if (!KNOWN_KEYS.has(key)) throw new Error(`Unknown property: ${key}`);
  }

  if (typeof obj.pattern !== "string" || obj.pattern.length === 0) throw new Error("pattern must be a non-empty string");
  if (Buffer.byteLength(obj.pattern, "utf8") > MAX_PATTERN_BYTES) throw new Error("pattern must be at most 16KiB");

  // The rewrite template is required but MAY be empty: an empty string deletes the match.
  if (typeof obj.rewrite !== "string") throw new Error("rewrite must be a string");
  if (Buffer.byteLength(obj.rewrite, "utf8") > MAX_REWRITE_BYTES) throw new Error("rewrite must be at most 64KiB");

  if (typeof obj.language !== "string" || !(LANGUAGES as readonly string[]).includes(obj.language)) {
    throw new Error(`language must be one of: ${LANGUAGES.join(", ")}`);
  }

  if (!Array.isArray(obj.paths)) throw new Error("paths must be an array");
  if (obj.paths.length < 1 || obj.paths.length > MAX_PATHS) throw new Error(`paths must have 1-${MAX_PATHS} entries`);
  for (const path of obj.paths) {
    if (typeof path !== "string" || path.length === 0) throw new Error("each path must be a non-empty string");
    if (codePointLength(path) > MAX_PATH_CHARS) {
      throw new Error(`each path must be at most ${MAX_PATH_CHARS} characters`);
    }
  }

  if (obj.workdir !== undefined) {
    if (typeof obj.workdir !== "string" || obj.workdir.length === 0) {
      throw new Error("workdir must be a non-empty string");
    }
    if (codePointLength(obj.workdir) > MAX_WORKDIR_CHARS) {
      throw new Error(`workdir must be at most ${MAX_WORKDIR_CHARS} characters`);
    }
  }

  if (obj.globs !== undefined) {
    if (!Array.isArray(obj.globs)) throw new Error("globs must be an array");
    if (obj.globs.length > MAX_GLOBS) throw new Error(`globs must have at most ${MAX_GLOBS} entries`);
    for (const glob of obj.globs) {
      if (typeof glob !== "string" || glob.length === 0) throw new Error("each glob must be a non-empty string");
      if (codePointLength(glob) > MAX_GLOB_CHARS) {
        throw new Error(`each glob must be at most ${MAX_GLOB_CHARS} characters`);
      }
    }
  }

  if (obj.selector !== undefined) {
    if (typeof obj.selector !== "string" || obj.selector.length === 0) {
      throw new Error("selector must be a non-empty string");
    }
    if (codePointLength(obj.selector) > MAX_SELECTOR_CHARS) {
      throw new Error(`selector must be at most ${MAX_SELECTOR_CHARS} characters`);
    }
  }

  let strictness: (typeof STRICTNESS)[number] = "smart";
  if (obj.strictness !== undefined) {
    if (typeof obj.strictness !== "string" || !(STRICTNESS as readonly string[]).includes(obj.strictness)) {
      throw new Error(`strictness must be one of: ${STRICTNESS.join(", ")}`);
    }
    strictness = obj.strictness as (typeof STRICTNESS)[number];
  }

  if (obj.apply !== undefined && typeof obj.apply !== "boolean") throw new Error("apply must be a boolean");

  let maxMatches = DEFAULT_MATCHES;
  if (obj.maxMatches !== undefined) {
    if (
      typeof obj.maxMatches !== "number" ||
      !Number.isInteger(obj.maxMatches) ||
      obj.maxMatches < 1 ||
      obj.maxMatches > MAX_MATCHES
    ) {
      throw new Error(`maxMatches must be an integer between 1 and ${MAX_MATCHES}`);
    }
    maxMatches = obj.maxMatches;
  }

  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (obj.timeoutMs !== undefined) {
    if (
      typeof obj.timeoutMs !== "number" ||
      !Number.isInteger(obj.timeoutMs) ||
      obj.timeoutMs < MIN_TIMEOUT_MS ||
      obj.timeoutMs > MAX_TIMEOUT_MS
    ) {
      throw new Error(`timeoutMs must be an integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}`);
    }
    timeoutMs = obj.timeoutMs;
  }

  for (const flag of ["includeHidden", "followSymlinks", "force"] as const) {
    if (obj[flag] !== undefined && typeof obj[flag] !== "boolean") throw new Error(`${flag} must be a boolean`);
  }

  return {
    pattern: obj.pattern,
    rewrite: obj.rewrite,
    language: obj.language as RewriteInput["language"],
    paths: obj.paths as readonly string[],
    workdir: obj.workdir as string | undefined,
    globs: obj.globs as readonly string[] | undefined,
    selector: obj.selector as string | undefined,
    strictness,
    apply: (obj.apply as boolean | undefined) ?? false,
    maxMatches,
    timeoutMs,
    includeHidden: obj.includeHidden as boolean | undefined,
    followSymlinks: obj.followSymlinks as boolean | undefined,
    force: obj.force as boolean | undefined,
  };
}

export const rewriteInputSchema = {
  parse(input: unknown): RewriteInput {
    return parseRewriteInput(input);
  },
};

// ---- CLI translation ----

function scopeArgs(input: RewriteInput): string[] {
  const args: string[] = ["--strictness", input.strictness];
  if (input.selector) args.push("--selector", input.selector);
  if (input.globs) for (const glob of input.globs) args.push("--globs", glob);
  if (input.includeHidden) args.push("--no-ignore", "hidden");
  if (input.followSymlinks) args.push("--follow");
  return args;
}

function baseArgs(input: RewriteInput): string[] {
  return ["run", "-p", input.pattern, "-r", input.rewrite, "--lang", input.language];
}

/** Pass 1: JSON preview. Never mutates — `sg` only writes with `--update-all`. */
export function buildRewriteArgs(input: RewriteInput): string[] {
  return [...baseArgs(input), "--json=stream", ...scopeArgs(input), ...input.paths];
}

/** Pass 2: mutation. `--update-all` with NO `--json` (the combo previews without writing). */
export function buildRewriteApplyArgs(input: RewriteInput): string[] {
  return [...baseArgs(input), "--update-all", ...scopeArgs(input), ...input.paths];
}

// ---- output ----

export type RewriteErrorCode =
  | "ABORTED"
  | "ENCODING_ERROR"
  | "INVALID_ARGUMENT"
  | "OUTPUT_PARSE_FAILED"
  | "OUTPUT_TOO_LARGE"
  | "PATTERN_HINT_REJECTED"
  | "PATTERN_PARSE_FAILED"
  | "PREVIEW_TRUNCATED"
  | "REWRITE_METAVARIABLE_KIND_MISMATCH"
  | "REWRITE_STALE_PREVIEW"
  | "REWRITE_UNBOUND_METAVARIABLE"
  | "SG_FAILED"
  | "TIMEOUT"
  | "UNSUPPORTED_LANGUAGE";

export type RewritePhase = "preflight" | "preview" | "apply";

export interface RewriteMatch extends NormalizedMatch {
  readonly replacement: string;
}

export interface RewriteSuccessPayload {
  readonly schemaVersion: 1;
  readonly ok: true;
  readonly kind: "rewrite";
  readonly workdir: string;
  readonly applied: boolean;
  readonly matches: readonly RewriteMatch[];
  readonly counts: { readonly plannedMatches: number; readonly plannedFiles: number };
  readonly truncation: {
    readonly truncated: boolean;
    readonly reason: "match_limit" | "output_cap" | "sg_output_truncated" | null;
    readonly maxMatches: number;
    readonly maxPayloadBytes: number;
    readonly salvagedRecords: number;
  };
  readonly application: {
    readonly requested: boolean;
    readonly performed: boolean;
    readonly countsArePreviewBased: true;
    readonly idempotencyChecked: false;
    readonly secondPassExitCode: number | null;
  };
  readonly warnings: readonly string[];
  readonly durationMs: number;
}

export interface RewriteErrorPayload {
  readonly schemaVersion: 1;
  readonly ok: false;
  readonly kind: "rewrite";
  readonly error: {
    readonly code: RewriteErrorCode;
    readonly message: string;
    readonly retryable: boolean;
    readonly phase: RewritePhase;
    readonly language: string;
    readonly details: { readonly stderr?: string; readonly hints?: readonly string[] };
  };
  readonly durationMs: number;
}

export type RewritePayload = RewriteSuccessPayload | RewriteErrorPayload;

/** Test seam: lets a test stage a filesystem change between the preview and apply passes. */
export interface RewriteHooks {
  readonly onPreviewComplete?: () => void | Promise<void>;
}

const RETRYABLE: ReadonlySet<RewriteErrorCode> = new Set<RewriteErrorCode>([
  "ABORTED",
  "OUTPUT_PARSE_FAILED",
  "REWRITE_STALE_PREVIEW",
  "TIMEOUT",
]);

// `sg` emits "Warning: Pattern contains an ERROR node" on stderr for a malformed
// query even when it exits 0, so a clean exit alone does not prove the pattern parsed.
const ERROR_NODE_RE = /Pattern contains an ERROR node/i;

function failure(
  code: RewriteErrorCode,
  message: string,
  phase: RewritePhase,
  language: string,
  durationMs: number,
  details: { stderr?: string; hints?: readonly string[] } = {},
): RewriteErrorPayload {
  return {
    schemaVersion: 1,
    ok: false,
    kind: "rewrite",
    error: { code, message, retryable: RETRYABLE.has(code), phase, language, details },
    durationMs,
  };
}

function toRewriteMatches(records: readonly Record<string, unknown>[], workdir: string): RewriteMatch[] {
  return normalizeRecords(records, workdir).map((match) => ({
    ...match,
    replacement: typeof match.replacement === "string" ? match.replacement : "",
  }));
}

function preflightCode(code: string | null): RewriteErrorCode {
  switch (code) {
    case "REWRITE_UNBOUND_METAVARIABLE":
      return "REWRITE_UNBOUND_METAVARIABLE";
    case "REWRITE_CARDINALITY_MISMATCH":
      return "REWRITE_METAVARIABLE_KIND_MISMATCH";
    case "LANGUAGE_UNSUPPORTED":
      return "UNSUPPORTED_LANGUAGE";
    case "PATTERN_HINT_REJECTED":
      return "PATTERN_HINT_REJECTED";
    default:
      return "INVALID_ARGUMENT";
  }
}

// ---- main entry ----

export async function executeRewrite(
  rawInput: RewriteInput,
  sgPath: string,
  signal?: AbortSignal,
  hooks?: RewriteHooks,
): Promise<RewritePayload> {
  const startedAt = performance.now();
  const elapsed = () => Math.max(0, Math.round(performance.now() - startedAt));

  let input: RewriteInput;
  try {
    input = parseRewriteInput(rawInput);
  } catch (error) {
    return failure(
      "INVALID_ARGUMENT",
      error instanceof Error ? error.message : String(error),
      "preflight",
      typeof (rawInput as { language?: unknown })?.language === "string"
        ? (rawInput as { language: string }).language
        : "unknown",
      elapsed(),
    );
  }

  const workdir = input.workdir ?? process.env.OMO_AST_GREP_PROJECT_CWD ?? process.cwd();

  // Preflight. Unbound and cardinality rejections are always-reject inside
  // validateRewriteHints, so `force` can never reach the spawn with them.
  const validation = validateRewriteHints(input.pattern, input.rewrite, input.language, {
    force: input.force,
    paths: input.paths,
    limit: input.maxMatches,
  });
  if (validation.rejected) {
    const blocking = validation.hints.find(
      (hint) => hint.severity === "always-reject" || hint.severity === "reject",
    );
    return failure(
      preflightCode(validation.code),
      blocking?.message ?? "Rewrite preflight rejected the request.",
      "preflight",
      input.language,
      elapsed(),
      { hints: validation.hints.map((hint) => hint.message) },
    );
  }
  const warnings = validation.hints.map((hint) => hint.message);

  // Pass 1 — JSON preview.
  let preview: Awaited<ReturnType<typeof spawnSgRunner>>;
  try {
    preview = await spawnSgRunner({
      sgPath,
      args: buildRewriteArgs(input),
      workdir,
      maxMatches: input.maxMatches,
      timeoutMs: input.timeoutMs,
      signal,
    });
  } catch (error) {
    if (error instanceof SgRunnerError) {
      return failure(error.code as RewriteErrorCode, error.message, "preview", input.language, error.durationMs, {
        stderr: error.stderr,
      });
    }
    return failure(
      "SG_FAILED",
      error instanceof Error ? error.message : String(error),
      "preview",
      input.language,
      elapsed(),
    );
  }

  if (ERROR_NODE_RE.test(preview.stderr)) {
    return failure(
      "PATTERN_PARSE_FAILED",
      "ast-grep reported an ERROR node while parsing the pattern; the query failed rather than finding nothing.",
      "preview",
      input.language,
      elapsed(),
      { stderr: preview.stderr },
    );
  }

  const matches = toRewriteMatches(preview.records, workdir);
  const truncation = {
    truncated: preview.truncated,
    reason: preview.reason,
    maxMatches: input.maxMatches,
    maxPayloadBytes: preview.maxPayloadBytes,
    salvagedRecords: preview.salvagedRecords,
  } as const;
  const counts = {
    plannedMatches: matches.length,
    plannedFiles: new Set(matches.map((match) => match.path)).size,
  } as const;

  const dryRun = (secondPassExitCode: number | null, extraWarnings: readonly string[] = []): RewriteSuccessPayload => ({
    schemaVersion: 1,
    ok: true,
    kind: "rewrite",
    workdir,
    applied: false,
    matches,
    counts,
    truncation,
    application: {
      requested: input.apply,
      performed: false,
      countsArePreviewBased: true,
      idempotencyChecked: false,
      secondPassExitCode,
    },
    warnings: [...warnings, ...extraWarnings],
    durationMs: elapsed(),
  });

  if (!input.apply) return dryRun(null);

  // Apply gating — every condition must hold before a mutating process is spawned.
  if (truncation.truncated) {
    return failure(
      "PREVIEW_TRUNCATED",
      `Preview exceeded maxMatches=${input.maxMatches} or was only partially salvaged; a truncated preview is never applied. Narrow paths or globs, then retry.`,
      "preview",
      input.language,
      elapsed(),
      { stderr: preview.stderr },
    );
  }
  if (matches.length === 0) {
    return dryRun(null, ["Nothing to apply: the preview found no matches."]);
  }
  await hooks?.onPreviewComplete?.();

  // Budget is recomputed HERE — after every preceding await — so that time spent
  // in the preview, in normalization, and in the staging window all count against
  // the whole-call deadline. Computing it earlier would let a slow staging window
  // push the mutation past the deadline the caller asked us to honor.
  const remainingBudgetMs = input.timeoutMs - elapsed();
  if (remainingBudgetMs <= 0) {
    return failure(
      "TIMEOUT",
      "The tool deadline expired before the mutation pass could start; nothing was modified.",
      "apply",
      input.language,
      elapsed(),
      { stderr: preview.stderr },
    );
  }

  // Pass 2 — mutation. No --json: `--update-all --json` previews without writing.
  let applyExitCode: number | null;
  let applyStderr = "";
  try {
    const applied = await spawnSgRunner({
      sgPath,
      args: buildRewriteApplyArgs(input),
      workdir,
      maxMatches: input.maxMatches,
      timeoutMs: remainingBudgetMs,
      signal,
    });
    applyExitCode = applied.exitCode;
    applyStderr = applied.stderr;
  } catch (error) {
    if (error instanceof SgRunnerError) {
      return failure(error.code as RewriteErrorCode, error.message, "apply", input.language, elapsed(), {
        stderr: error.stderr,
      });
    }
    return failure(
      "SG_FAILED",
      error instanceof Error ? error.message : String(error),
      "apply",
      input.language,
      elapsed(),
    );
  }

  // Exit 1 from the mutation pass after a non-empty preview means `sg` no longer
  // sees those matches: the tree changed between passes. Never claim success.
  if (applyExitCode === 1) {
    return failure(
      "REWRITE_STALE_PREVIEW",
      "The preview found matches but the mutation pass found none; the files or search scope changed between passes. Re-run the preview before applying.",
      "apply",
      input.language,
      elapsed(),
      { stderr: applyStderr },
    );
  }

  return {
    schemaVersion: 1,
    ok: true,
    kind: "rewrite",
    workdir,
    applied: true,
    matches,
    counts,
    truncation,
    application: {
      requested: true,
      performed: true,
      countsArePreviewBased: true,
      idempotencyChecked: false,
      secondPassExitCode: applyExitCode,
    },
    warnings: [...warnings, APPLY_PREVIEW_WARNING],
    durationMs: elapsed(),
  };
}
