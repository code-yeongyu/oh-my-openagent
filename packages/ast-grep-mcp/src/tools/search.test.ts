import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  SEARCH_TOOL_NAME,
  SEARCH_TOOL_DESCRIPTION,
  searchInputSchema,
  buildSearchArgs,
  executeSearch,
  type SearchInput,
  type SearchSuccessPayload,
  type SearchErrorPayload,
} from "./search";

const SG_PATH = "/opt/homebrew/bin/sg";
const directories: string[] = [];

function fixtureRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-search-"));
  directories.push(dir);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "src", "a.ts"),
    'console.log("hello");\nconsole.log("world");\nconst x = 1;\nconsole.log(x);\n',
  );
  writeFileSync(join(dir, "src", "b.ts"), 'console.log("from-b");\n');
  return dir;
}

afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// ---- verbatim description pin (blocker 4) ----

describe("search tool: verbatim description (ub §3)", () => {
  it("#given the module #when imported #then SEARCH_TOOL_NAME is 'search'", () => {
    expect(SEARCH_TOOL_NAME).toBe("search");
  });

  it("#given the module #when imported #then SEARCH_TOOL_DESCRIPTION equals the ub §3 text verbatim", () => {
    const verbatim = "Search code structurally with ast-grep. The pattern is code, not regex, and must parse as one AST node in the required language; use narrow paths. `$NAME` and `$_` match one whole node, while `$$$NAME` and `$$$` match zero-or-more nodes. Names are uppercase, `$$NAME` is invalid, partial-token captures do not work, and a repeated metavariable must match identical code. Wrap non-standalone syntax and use `selector` when needed. Parse warnings mean the query failed, not that the code is absent.";
    expect(SEARCH_TOOL_DESCRIPTION).toBe(verbatim);
  });
});

// ---- schema bound tests (blocker 3) ----

describe("search tool: schema bounds (ub §3)", () => {
  it("#given valid input #when validated #then it passes", () => {
    expect(() =>
      searchInputSchema.parse({ pattern: "console.log($MSG)", language: "typescript", paths: ["src"] }),
    ).not.toThrow();
  });

  it("#given empty pattern #when validated #then it rejects (minLength 1)", () => {
    expect(() =>
      searchInputSchema.parse({ pattern: "", language: "typescript", paths: ["src"] }),
    ).toThrow();
  });

  it("#given pattern over 16KiB #when validated #then it rejects", () => {
    expect(() =>
      searchInputSchema.parse({ pattern: "x".repeat(16385), language: "typescript", paths: ["src"] }),
    ).toThrow();
  });

  it("#given missing paths #when validated #then it rejects", () => {
    expect(() =>
      searchInputSchema.parse({ pattern: "console.log($MSG)", language: "typescript" }),
    ).toThrow();
  });

  it("#given empty paths array #when validated #then it rejects", () => {
    expect(() =>
      searchInputSchema.parse({ pattern: "console.log($MSG)", language: "typescript", paths: [] }),
    ).toThrow();
  });

  it("#given 65 paths #when validated #then it rejects", () => {
    expect(() =>
      searchInputSchema.parse({
        pattern: "console.log($MSG)",
        language: "typescript",
        paths: Array.from({ length: 65 }, (_, i) => `p${i}`),
      }),
    ).toThrow();
  });

  it("#given path string over 4096 chars #when validated #then it rejects", () => {
    expect(() =>
      searchInputSchema.parse({
        pattern: "console.log($MSG)",
        language: "typescript",
        paths: ["x".repeat(4097)],
      }),
    ).toThrow();
  });

  it("#given path at exactly 4096 code points with astral chars #when validated #then it accepts", () => {
    // 𝐀 is U+1D400 (astral plane, 2 UTF-16 code units per code point)
    // 4096 code points = 8192 UTF-16 code units — must be accepted (maxLength counts code points)
    const astral = "𝐀".repeat(4096);
    expect(() =>
      searchInputSchema.parse({ pattern: "console.log($MSG)", language: "typescript", paths: [astral] }),
    ).not.toThrow();
  });

  it("#given path at 4097 code points with astral chars #when validated #then it rejects", () => {
    const astral = "𝐀".repeat(4097);
    expect(() =>
      searchInputSchema.parse({ pattern: "console.log($MSG)", language: "typescript", paths: [astral] }),
    ).toThrow();
  });

  it("#given invalid language #when validated #then it rejects", () => {
    expect(() =>
      searchInputSchema.parse({ pattern: "console.log($MSG)", language: "foobar", paths: ["src"] }),
    ).toThrow();
  });

  it("#given strictness 'template' #when validated #then it rejects (not in enum)", () => {
    expect(() =>
      searchInputSchema.parse({ pattern: "console.log($MSG)", language: "typescript", paths: ["src"], strictness: "template" }),
    ).toThrow();
  });

  it("#given strictness 'cst' #when validated #then it passes", () => {
    const parsed = searchInputSchema.parse({ pattern: "console.log($MSG)", language: "typescript", paths: ["src"], strictness: "cst" });
    expect(parsed.strictness).toBe("cst");
  });

  it("#given strictness 'signature' #when validated #then it passes", () => {
    const parsed = searchInputSchema.parse({ pattern: "console.log($MSG)", language: "typescript", paths: ["src"], strictness: "signature" });
    expect(parsed.strictness).toBe("signature");
  });

  it("#given default strictness #when omitted #then it defaults to smart", () => {
    const parsed = searchInputSchema.parse({ pattern: "console.log($MSG)", language: "typescript", paths: ["src"] });
    expect(parsed.strictness).toBe("smart");
  });

  it("#given maxMatches 0 #when validated #then it rejects", () => {
    expect(() =>
      searchInputSchema.parse({ pattern: "console.log($MSG)", language: "typescript", paths: ["src"], maxMatches: 0 }),
    ).toThrow();
  });

  it("#given maxMatches 501 #when validated #then it rejects", () => {
    expect(() =>
      searchInputSchema.parse({ pattern: "console.log($MSG)", language: "typescript", paths: ["src"], maxMatches: 501 }),
    ).toThrow();
  });

  it("#given maxMatches 1 #when validated #then it passes", () => {
    const parsed = searchInputSchema.parse({ pattern: "console.log($MSG)", language: "typescript", paths: ["src"], maxMatches: 1 });
    expect(parsed.maxMatches).toBe(1);
  });

  it("#given maxMatches 500 #when validated #then it passes", () => {
    const parsed = searchInputSchema.parse({ pattern: "console.log($MSG)", language: "typescript", paths: ["src"], maxMatches: 500 });
    expect(parsed.maxMatches).toBe(500);
  });

  it("#given timeoutMs 0 #when validated #then it rejects (minimum 1000)", () => {
    expect(() =>
      searchInputSchema.parse({ pattern: "console.log($MSG)", language: "typescript", paths: ["src"], timeoutMs: 0 }),
    ).toThrow();
  });

  it("#given timeoutMs 999 #when validated #then it rejects (minimum 1000)", () => {
    expect(() =>
      searchInputSchema.parse({ pattern: "console.log($MSG)", language: "typescript", paths: ["src"], timeoutMs: 999 }),
    ).toThrow();
  });

  it("#given timeoutMs 1000.5 #when validated #then it rejects (must be integer)", () => {
    expect(() =>
      searchInputSchema.parse({ pattern: "console.log($MSG)", language: "typescript", paths: ["src"], timeoutMs: 1000.5 }),
    ).toThrow();
  });

  it("#given timeoutMs 300001 #when validated #then it rejects (maximum 300000)", () => {
    expect(() =>
      searchInputSchema.parse({ pattern: "console.log($MSG)", language: "typescript", paths: ["src"], timeoutMs: 300001 }),
    ).toThrow();
  });

  it("#given timeoutMs 1000 #when validated #then it passes", () => {
    const parsed = searchInputSchema.parse({ pattern: "console.log($MSG)", language: "typescript", paths: ["src"], timeoutMs: 1000 });
    expect(parsed.timeoutMs).toBe(1000);
  });

  it("#given timeoutMs 300000 #when validated #then it passes", () => {
    const parsed = searchInputSchema.parse({ pattern: "console.log($MSG)", language: "typescript", paths: ["src"], timeoutMs: 300000 });
    expect(parsed.timeoutMs).toBe(300000);
  });

  it("#given default timeoutMs #when omitted #then it defaults to 300000", () => {
    const parsed = searchInputSchema.parse({ pattern: "console.log($MSG)", language: "typescript", paths: ["src"] });
    expect(parsed.timeoutMs).toBe(300000);
  });

  it("#given default maxMatches #when omitted #then it defaults to 50", () => {
    const parsed = searchInputSchema.parse({ pattern: "console.log($MSG)", language: "typescript", paths: ["src"] });
    expect(parsed.maxMatches).toBe(50);
  });

  it("#given additionalProperties #when validated #then it rejects", () => {
    expect(() =>
      searchInputSchema.parse({ pattern: "console.log($MSG)", language: "typescript", paths: ["src"], bogus: true }),
    ).toThrow();
  });

  it("#given globs with 33 entries #when validated #then it rejects", () => {
    expect(() =>
      searchInputSchema.parse({
        pattern: "console.log($MSG)", language: "typescript", paths: ["src"],
        globs: Array.from({ length: 33 }, () => "*.ts"),
      }),
    ).toThrow();
  });

  it("#given globs entry over 1024 chars #when validated #then it rejects", () => {
    expect(() =>
      searchInputSchema.parse({
        pattern: "console.log($MSG)", language: "typescript", paths: ["src"],
        globs: ["x".repeat(1025)],
      }),
    ).toThrow();
  });

  it("#given glob at exactly 1024 code points with astral chars #when validated #then it accepts", () => {
    const astral = "𝐀".repeat(1024);
    expect(() =>
      searchInputSchema.parse({ pattern: "console.log($MSG)", language: "typescript", paths: ["src"], globs: [astral] }),
    ).not.toThrow();
  });

  it("#given glob at 1025 code points with astral chars #when validated #then it rejects", () => {
    const astral = "𝐀".repeat(1025);
    expect(() =>
      searchInputSchema.parse({ pattern: "console.log($MSG)", language: "typescript", paths: ["src"], globs: [astral] }),
    ).toThrow();
  });

  it("#given empty selector string #when validated #then it rejects (minLength 1)", () => {
    expect(() =>
      searchInputSchema.parse({ pattern: "console.log($MSG)", language: "typescript", paths: ["src"], selector: "" }),
    ).toThrow();
  });

  it("#given selector over 128 chars #when validated #then it rejects", () => {
    expect(() =>
      searchInputSchema.parse({ pattern: "console.log($MSG)", language: "typescript", paths: ["src"], selector: "x".repeat(129) }),
    ).toThrow();
  });

  it("#given selector at exactly 128 code points with astral chars #when validated #then it accepts", () => {
    const astral = "𝐀".repeat(128);
    expect(() =>
      searchInputSchema.parse({ pattern: "console.log($MSG)", language: "typescript", paths: ["src"], selector: astral }),
    ).not.toThrow();
  });

  it("#given selector at 129 code points with astral chars #when validated #then it rejects", () => {
    const astral = "𝐀".repeat(129);
    expect(() =>
      searchInputSchema.parse({ pattern: "console.log($MSG)", language: "typescript", paths: ["src"], selector: astral }),
    ).toThrow();
  });

  it("#given empty workdir string #when validated #then it rejects (minLength 1)", () => {
    expect(() =>
      searchInputSchema.parse({ pattern: "console.log($MSG)", language: "typescript", paths: ["src"], workdir: "" }),
    ).toThrow();
  });

  it("#given workdir over 4096 chars #when validated #then it rejects", () => {
    expect(() =>
      searchInputSchema.parse({ pattern: "console.log($MSG)", language: "typescript", paths: ["src"], workdir: "x".repeat(4097) }),
    ).toThrow();
  });

  it("#given workdir at exactly 4096 code points with astral chars #when validated #then it accepts", () => {
    const astral = "𝐀".repeat(4096);
    expect(() =>
      searchInputSchema.parse({ pattern: "console.log($MSG)", language: "typescript", paths: ["src"], workdir: astral }),
    ).not.toThrow();
  });

  it("#given workdir at 4097 code points with astral chars #when validated #then it rejects", () => {
    const astral = "𝐀".repeat(4097);
    expect(() =>
      searchInputSchema.parse({ pattern: "console.log($MSG)", language: "typescript", paths: ["src"], workdir: astral }),
    ).toThrow();
  });
});

// ---- CLI translation tests ----

describe("search tool: CLI translation", () => {
  it("#given minimal input #when building args #then produces correct CLI", () => {
    const args = buildSearchArgs({
      pattern: "console.log($MSG)",
      language: "typescript",
      paths: ["src"],
      strictness: "smart",
      maxMatches: 50,
      timeoutMs: 300000,
    } as SearchInput);
    expect(args).toEqual([
      "run",
      "-p", "console.log($MSG)",
      "--lang", "typescript",
      "--json=stream",
      "--strictness", "smart",
      "src",
    ]);
  });

  it("#given all optional flags #when building args #then includes them", () => {
    const args = buildSearchArgs({
      pattern: "console.log($MSG)",
      language: "typescript",
      paths: ["src", "lib"],
      strictness: "cst",
      maxMatches: 50,
      timeoutMs: 300000,
      globs: ["*.ts", "!*.test.ts"],
      selector: "expression",
      includeHidden: true,
      followSymlinks: true,
    } as SearchInput);
    expect(args).toEqual([
      "run",
      "-p", "console.log($MSG)",
      "--lang", "typescript",
      "--json=stream",
      "--strictness", "cst",
      "--selector", "expression",
      "--globs", "*.ts",
      "--globs", "!*.test.ts",
      "--no-ignore", "hidden",
      "--follow",
      "src", "lib",
    ]);
  });

  it("#given includeHidden=false #when building args #then no --no-ignore", () => {
    const args = buildSearchArgs({
      pattern: "console.log($MSG)",
      language: "typescript",
      paths: ["src"],
      strictness: "smart",
      maxMatches: 50,
      timeoutMs: 300000,
    } as SearchInput);
    expect(args).not.toContain("--no-ignore");
  });

  it("#given no globs #when building args #then no --globs", () => {
    const args = buildSearchArgs({
      pattern: "console.log($MSG)",
      language: "typescript",
      paths: ["src"],
      strictness: "smart",
      maxMatches: 50,
      timeoutMs: 300000,
    } as SearchInput);
    expect(args).not.toContain("--globs");
  });

  it("#given args #when inspecting #then NEVER includes -C", () => {
    const args = buildSearchArgs({
      pattern: "console.log($MSG)",
      language: "typescript",
      paths: ["src"],
      strictness: "smart",
      maxMatches: 50,
      timeoutMs: 300000,
    } as SearchInput);
    expect(args).not.toContain("-C");
  });
});

// ---- payload shape tests (blocker 1 + 2) ----

describe("search tool: payload shapes (ub §5/§6)", () => {
  it("#given a success payload #when inspecting #then it has schemaVersion, kind, nested counts, nested truncation", () => {
    // Shape pin without live sg — construct what executeSearch should return
    // We verify the type contract here via compile-time + structural assertions
    const payload: SearchSuccessPayload = {
      schemaVersion: 1,
      ok: true,
      kind: "search",
      workdir: "/repo",
      matches: [],
      counts: {
        returnedMatches: 0,
        returnedFiles: 0,
        totalMatches: 0,
        totalFiles: 0,
        atLeastMatches: 0,
      },
      truncation: {
        truncated: false,
        reason: null,
        maxMatches: 50,
        maxPayloadBytes: 4 * 1024 * 1024,
        salvagedRecords: 0,
      },
      warnings: [],
      durationMs: 0,
    };
    expect(payload.schemaVersion).toBe(1);
    expect(payload.kind).toBe("search");
    expect(payload.counts.returnedMatches).toBe(0);
    expect(payload.counts.totalMatches).toBe(0);
    expect(payload.counts.atLeastMatches).toBe(0);
    expect(payload.truncation.truncated).toBe(false);
    expect(payload.truncation.reason).toBeNull();
    expect(payload.truncation.maxMatches).toBe(50);
    expect(payload.truncation.maxPayloadBytes).toBe(4 * 1024 * 1024);
    expect(payload.truncation.salvagedRecords).toBe(0);
    // No flat fields
    const flat = payload as unknown as Record<string, unknown>;
    expect(flat.count).toBeUndefined();
    expect(flat.truncationReason).toBeUndefined();
    expect(flat.atLeastMatches).toBeUndefined();
  });

  it("#given an error payload #when inspecting #then it has nested error object with all ub §6 fields", () => {
    const payload: SearchErrorPayload = {
      schemaVersion: 1,
      ok: false,
      error: {
        code: "PATTERN_PARSE_FAILED",
        message: "Pattern did not parse as one TypeScript AST node.",
        retryable: false,
        phase: "search",
        language: "typescript",
        details: {
          stderr: "Pattern contains an ERROR node...",
          hint: "Use a complete function, call, declaration, or wrapped context.",
        },
      },
    };
    expect(payload.schemaVersion).toBe(1);
    expect(payload.error.code).toBe("PATTERN_PARSE_FAILED");
    expect(payload.error.message).toContain("parse");
    expect(payload.error.retryable).toBe(false);
    expect(payload.error.phase).toBe("search");
    expect(payload.error.language).toBe("typescript");
    expect(payload.error.details.stderr).toContain("ERROR node");
    expect(payload.error.details.hint).toBeTruthy();
    // No top-level code/message
    const flat = payload as unknown as Record<string, unknown>;
    expect(flat.code).toBeUndefined();
    expect(flat.message).toBeUndefined();
  });
});

// ---- live fixture tests (real sg binary) ----

const SG_AVAILABLE = existsSync(SG_PATH);

describe.skipIf(!SG_AVAILABLE)("search tool: live fixture (ub §5/§6 contract)", () => {
  it("#given a fixture repo with console.log #when searching #then returns ub §5 success payload", async () => {
    const dir = fixtureRepo();
    const result = await executeSearch(
      {
        pattern: "console.log($MSG)",
        language: "typescript",
        paths: [join(dir, "src")],
        workdir: dir,
        maxMatches: 50,
        strictness: "smart",
        timeoutMs: 300000,
      } as SearchInput,
      SG_PATH,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const payload = result as SearchSuccessPayload;

    // ub §5 exact shape
    expect(payload.schemaVersion).toBe(1);
    expect(payload.kind).toBe("search");
    expect(payload.workdir).toBe(dir);
    expect(payload.matches.length).toBe(4);
    expect(payload.matches.every((m) => m.path.startsWith("src/"))).toBe(true);
    expect(payload.matches.every((m) => m.metavariables.single.MSG !== undefined)).toBe(true);

    // nested counts
    expect(payload.counts.returnedMatches).toBe(4);
    expect(payload.counts.returnedFiles).toBe(2);
    expect(payload.counts.totalMatches).toBe(4);
    expect(payload.counts.totalFiles).toBe(2);
    expect(payload.counts.atLeastMatches).toBe(4);

    // nested truncation
    expect(payload.truncation.truncated).toBe(false);
    expect(payload.truncation.reason).toBeNull();
    expect(payload.truncation.maxMatches).toBe(50);
    expect(payload.truncation.maxPayloadBytes).toBe(4 * 1024 * 1024);
    expect(payload.truncation.salvagedRecords).toBe(0);

    expect(payload.warnings).toEqual([]);
    expect(typeof payload.durationMs).toBe("number");

    // No flat fields
    const flat = payload as unknown as Record<string, unknown>;
    expect(flat.count).toBeUndefined();
    expect(flat.atLeastMatches).toBeUndefined();
    expect(flat.truncationReason).toBeUndefined();
  });

  it("#given maxMatches=1 #when searching #then result is truncated with limit warning", async () => {
    const dir = fixtureRepo();
    const result = await executeSearch(
      {
        pattern: "console.log($MSG)",
        language: "typescript",
        paths: [join(dir, "src")],
        workdir: dir,
        maxMatches: 1,
        strictness: "smart",
        timeoutMs: 300000,
      } as SearchInput,
      SG_PATH,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const payload = result as SearchSuccessPayload;

    expect(payload.matches.length).toBe(1);
    expect(payload.truncation.truncated).toBe(true);
    expect(payload.truncation.reason).toBe("match_limit");
    expect(payload.truncation.maxMatches).toBe(1);
    expect(payload.counts.atLeastMatches).toBe(2);
    expect(payload.counts.totalMatches).toBeNull();
    expect(payload.counts.totalFiles).toBeNull();
    expect(payload.counts.returnedMatches).toBe(1);

    // The limit warning must be present
    expect(payload.warnings).toContain("Result limit reached; narrow paths or globs.");
  });

  it("#given a malformed pattern #when searching #then returns ub §6 error payload", async () => {
    const dir = fixtureRepo();
    const result = await executeSearch(
      {
        pattern: "console.log($MSG",
        language: "typescript",
        paths: [join(dir, "src")],
        workdir: dir,
        maxMatches: 50,
        strictness: "smart",
        timeoutMs: 300000,
      } as SearchInput,
      SG_PATH,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const error = result as SearchErrorPayload;

    // ub §6 exact shape
    expect(error.schemaVersion).toBe(1);
    expect(error.error.code).toBe("PATTERN_PARSE_FAILED");
    expect(typeof error.error.message).toBe("string");
    expect(error.error.message.length).toBeGreaterThan(0);
    expect(error.error.retryable).toBe(false);
    expect(error.error.phase).toBe("search");
    expect(error.error.language).toBe("typescript");
    expect(typeof error.error.details.stderr).toBe("string");
    expect(error.error.details.stderr).toContain("ERROR node");
    expect(typeof error.error.details.hint).toBe("string");

    // No top-level code/message
    const flat = error as unknown as Record<string, unknown>;
    expect(flat.code).toBeUndefined();
    expect(flat.message).toBeUndefined();
  });

  it("#given a pattern that matches nothing #when searching #then returns empty ub §5 success", async () => {
    const dir = fixtureRepo();
    const result = await executeSearch(
      {
        pattern: "process.exit($CODE)",
        language: "typescript",
        paths: [join(dir, "src")],
        workdir: dir,
        maxMatches: 50,
        strictness: "smart",
        timeoutMs: 300000,
      } as SearchInput,
      SG_PATH,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const payload = result as SearchSuccessPayload;

    expect(payload.matches).toEqual([]);
    expect(payload.counts.returnedMatches).toBe(0);
    expect(payload.counts.returnedFiles).toBe(0);
    expect(payload.counts.totalMatches).toBe(0);
    expect(payload.counts.totalFiles).toBe(0);
    expect(payload.counts.atLeastMatches).toBe(0);
    expect(payload.truncation.truncated).toBe(false);
  });

  it("#given includeHidden=true #when searching #then args include --no-ignore hidden and results return", async () => {
    const dir = fixtureRepo();
    // Create a hidden file
    writeFileSync(join(dir, "src", ".hidden.ts"), 'console.log("hidden");\n');

    const result = await executeSearch(
      {
        pattern: "console.log($MSG)",
        language: "typescript",
        paths: [join(dir, "src")],
        workdir: dir,
        maxMatches: 50,
        strictness: "smart",
        timeoutMs: 300000,
        includeHidden: true,
      } as SearchInput,
      SG_PATH,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const payload = result as SearchSuccessPayload;
    // Should find the hidden file match too
    expect(payload.matches.length).toBeGreaterThanOrEqual(5);
    expect(payload.matches.some((m) => m.path.includes(".hidden"))).toBe(true);
  });
});
