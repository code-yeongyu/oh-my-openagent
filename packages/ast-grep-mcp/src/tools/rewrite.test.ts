import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  REWRITE_TOOL_DESCRIPTION,
  REWRITE_TOOL_NAME,
  buildRewriteArgs,
  buildRewriteApplyArgs,
  executeRewrite,
  rewriteInputSchema,
  type RewriteErrorPayload,
  type RewriteInput,
  type RewriteSuccessPayload,
} from "./rewrite";

const SG_PATH = "/opt/homebrew/bin/sg";
const SG_AVAILABLE = existsSync(SG_PATH);
const directories: string[] = [];

function fixtureRepo(files?: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-rewrite-"));
  directories.push(dir);
  mkdirSync(join(dir, "src"), { recursive: true });
  const contents = files ?? {
    "src/a.ts": 'console.log("hello");\nconsole.log("world");\nconst x = 1;\nconsole.log(x);\n',
    "src/b.ts": 'console.log("from-b");\n',
  };
  for (const [relative, body] of Object.entries(contents)) {
    const target = join(dir, relative);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, body);
  }
  return dir;
}

function sha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function baseInput(dir: string, overrides: Partial<RewriteInput> = {}): RewriteInput {
  return {
    pattern: "console.log($MSG)",
    rewrite: "logger.info($MSG)",
    language: "typescript",
    paths: [join(dir, "src")],
    workdir: dir,
    strictness: "smart",
    maxMatches: 50,
    timeoutMs: 60_000,
    apply: false,
    ...overrides,
  } as RewriteInput;
}

afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// ---- constants ----

describe("rewrite tool: constants", () => {
  it("#given the module #when imported #then exports the raw tool name", () => {
    expect(REWRITE_TOOL_NAME).toBe("rewrite");
  });

  it("#given the description #when read #then it is the verbatim plan text", () => {
    expect(REWRITE_TOOL_DESCRIPTION).toBe(
      "Preview or apply an AST-aware rewrite. The pattern follows the same metavariable rules as `search`; the replacement may only reference metavariables captured by the pattern, and an empty replacement deletes the match. Dry-run is the default. Apply uses a JSON preview followed by a separate `--update-all` process because `sg` cannot safely combine JSON output and mutation. Truncated previews are never applied, and rewrite idempotency is not guaranteed.",
    );
  });
});

// ---- schema ----

describe("rewrite tool: schema", () => {
  it("#given valid input #when parsed #then apply defaults to false", () => {
    const parsed = rewriteInputSchema.parse({
      pattern: "console.log($MSG)",
      rewrite: "logger.info($MSG)",
      language: "typescript",
      paths: ["src"],
    });
    expect(parsed.apply).toBe(false);
    expect(parsed.strictness).toBe("smart");
    expect(parsed.maxMatches).toBe(50);
    expect(parsed.timeoutMs).toBe(300_000);
  });

  it("#given an empty rewrite string #when parsed #then it is accepted as a deletion", () => {
    const parsed = rewriteInputSchema.parse({
      pattern: "console.log($MSG)",
      rewrite: "",
      language: "typescript",
      paths: ["src"],
    });
    expect(parsed.rewrite).toBe("");
  });

  it("#given a missing rewrite #when parsed #then it rejects", () => {
    expect(() =>
      rewriteInputSchema.parse({ pattern: "console.log($MSG)", language: "typescript", paths: ["src"] }),
    ).toThrow();
  });

  it("#given a rewrite template over 64KiB #when parsed #then it rejects", () => {
    expect(() =>
      rewriteInputSchema.parse({
        pattern: "console.log($MSG)",
        rewrite: "x".repeat(65_537),
        language: "typescript",
        paths: ["src"],
      }),
    ).toThrow();
  });

  it("#given a pattern over 16KiB #when parsed #then it rejects", () => {
    expect(() =>
      rewriteInputSchema.parse({
        pattern: "x".repeat(16_385),
        rewrite: "y",
        language: "typescript",
        paths: ["src"],
      }),
    ).toThrow();
  });

  it("#given paths beyond 64 entries #when parsed #then it rejects", () => {
    expect(() =>
      rewriteInputSchema.parse({
        pattern: "console.log($MSG)",
        rewrite: "logger.info($MSG)",
        language: "typescript",
        paths: Array.from({ length: 65 }, (_unused, index) => `src/${index}`),
      }),
    ).toThrow();
  });

  it("#given an unknown property #when parsed #then it rejects (additionalProperties:false)", () => {
    expect(() =>
      rewriteInputSchema.parse({
        pattern: "console.log($MSG)",
        rewrite: "logger.info($MSG)",
        language: "typescript",
        paths: ["src"],
        updateAll: true,
      }),
    ).toThrow();
  });

  it("#given a non-boolean apply #when parsed #then it rejects", () => {
    expect(() =>
      rewriteInputSchema.parse({
        pattern: "console.log($MSG)",
        rewrite: "logger.info($MSG)",
        language: "typescript",
        paths: ["src"],
        apply: "yes",
      }),
    ).toThrow();
  });

  it("#given maxMatches above 500 #when parsed #then it rejects", () => {
    expect(() =>
      rewriteInputSchema.parse({
        pattern: "console.log($MSG)",
        rewrite: "logger.info($MSG)",
        language: "typescript",
        paths: ["src"],
        maxMatches: 501,
      }),
    ).toThrow();
  });
});

// ---- per-string bounds (ub §4: same bounds as search) ----

describe("rewrite tool: per-string bounds", () => {
  const oversized: Array<[string, Record<string, unknown>]> = [
    ["a path string longer than 4096", { paths: ["x".repeat(4097)] }],
    ["a workdir longer than 4096", { workdir: "x".repeat(4097) }],
    ["a glob entry longer than 1024", { globs: ["x".repeat(1025)] }],
    ["a selector longer than 128", { selector: "x".repeat(129) }],
  ];

  for (const [label, overrides] of oversized) {
    it(`#given ${label} #when parsed #then it rejects`, () => {
      expect(() =>
        rewriteInputSchema.parse({
          pattern: "console.log($MSG)",
          rewrite: "logger.info($MSG)",
          language: "typescript",
          paths: ["src"],
          ...overrides,
        }),
      ).toThrow();
    });

    it(`#given ${label} #when executed #then INVALID_ARGUMENT before any spawn`, async () => {
      const dir = fixtureRepo();
      const before = sha256(join(dir, "src/a.ts"));
      const result = await executeRewrite(
        {
          pattern: "console.log($MSG)",
          rewrite: "logger.info($MSG)",
          language: "typescript",
          paths: [join(dir, "src")],
          workdir: dir,
          strictness: "smart",
          apply: true,
          maxMatches: 50,
          timeoutMs: 60_000,
          ...overrides,
        } as unknown as RewriteInput,
        SG_PATH,
      );
      expect(result.ok).toBe(false);
      expect((result as RewriteErrorPayload).error.code).toBe("INVALID_ARGUMENT");
      expect((result as RewriteErrorPayload).error.phase).toBe("preflight");
      expect(sha256(join(dir, "src/a.ts"))).toBe(before);
    });
  }

  it("#given a path string exactly at 4096 #when parsed #then it is accepted", () => {
    expect(() =>
      rewriteInputSchema.parse({
        pattern: "console.log($MSG)",
        rewrite: "logger.info($MSG)",
        language: "typescript",
        paths: ["x".repeat(4096)],
        workdir: "y".repeat(4096),
        globs: ["z".repeat(1024)],
        selector: "s".repeat(128),
      }),
    ).not.toThrow();
  });
});

// ---- per-string bounds are measured in UNICODE CODE POINTS, not UTF-16 units ----

describe("rewrite tool: astral per-string bounds", () => {
  // U+1D11E MUSICAL SYMBOL G CLEF: one code point, TWO UTF-16 code units.
  // A naive `.length` check counts it as 2 and would reject a string that is
  // exactly at the limit in the unit the contract actually specifies.
  const ASTRAL = "\u{1D11E}";

  const fields: Array<[string, number, (value: string) => Record<string, unknown>]> = [
    ["path", 4096, (value) => ({ paths: [value] })],
    ["workdir", 4096, (value) => ({ workdir: value })],
    ["glob", 1024, (value) => ({ globs: [value] })],
    ["selector", 128, (value) => ({ selector: value })],
  ];

  function parseWith(overrides: Record<string, unknown>) {
    return rewriteInputSchema.parse({
      pattern: "console.log($MSG)",
      rewrite: "logger.info($MSG)",
      language: "typescript",
      paths: ["src"],
      ...overrides,
    });
  }

  it("#given the astral test character #when measured #then it is 1 code point but 2 UTF-16 units", () => {
    // Guards the suite below from becoming vacuous if ASTRAL is ever edited.
    expect([...ASTRAL].length).toBe(1);
    expect(ASTRAL.length).toBe(2);
  });

  for (const [label, limit, build] of fields) {
    it(`#given an all-astral ${label} of exactly ${limit} code points #when parsed #then it is accepted`, () => {
      const value = ASTRAL.repeat(limit);
      expect([...value].length).toBe(limit);
      expect(value.length).toBe(limit * 2); // would fail a naive UTF-16 .length check
      expect(() => parseWith(build(value))).not.toThrow();
    });

    it(`#given an all-astral ${label} of ${limit + 1} code points #when parsed #then it rejects`, () => {
      const value = ASTRAL.repeat(limit + 1);
      expect([...value].length).toBe(limit + 1);
      expect(() => parseWith(build(value))).toThrow();
    });

    it(`#given a mixed astral/ASCII ${label} straddling the limit #when parsed #then only limit+1 rejects`, () => {
      // Half astral, half ASCII: exercises the boundary on a realistic mixed string.
      const atLimit = ASTRAL.repeat(limit / 2) + "a".repeat(limit / 2);
      const overLimit = `${atLimit}a`;
      expect([...atLimit].length).toBe(limit);
      expect([...overLimit].length).toBe(limit + 1);
      expect(() => parseWith(build(atLimit))).not.toThrow();
      expect(() => parseWith(build(overLimit))).toThrow();
    });

    it(`#given an over-limit astral ${label} #when executed #then INVALID_ARGUMENT before any spawn`, async () => {
      const dir = fixtureRepo();
      const before = sha256(join(dir, "src/a.ts"));
      const result = await executeRewrite(
        {
          pattern: "console.log($MSG)",
          rewrite: "logger.info($MSG)",
          language: "typescript",
          paths: [join(dir, "src")],
          workdir: dir,
          strictness: "smart",
          apply: true,
          maxMatches: 50,
          timeoutMs: 60_000,
          ...build(ASTRAL.repeat(limit + 1)),
        } as unknown as RewriteInput,
        SG_PATH,
      );
      expect(result.ok).toBe(false);
      expect((result as RewriteErrorPayload).error.code).toBe("INVALID_ARGUMENT");
      expect(sha256(join(dir, "src/a.ts"))).toBe(before);
    });
  }
});

// ---- CLI translation ----

describe("rewrite tool: CLI translation", () => {
  it("#given a preview #when building args #then it emits -p -r --json=stream and never --update-all", () => {
    const args = buildRewriteArgs(baseInput("/tmp/x"));
    expect(args.slice(0, 7)).toEqual([
      "run",
      "-p",
      "console.log($MSG)",
      "-r",
      "logger.info($MSG)",
      "--lang",
      "typescript",
    ]);
    expect(args).toContain("--json=stream");
    expect(args).not.toContain("--update-all");
    expect(args).not.toContain("-C");
  });

  it("#given an apply pass #when building args #then it emits --update-all and never --json=stream", () => {
    const args = buildRewriteApplyArgs(baseInput("/tmp/x", { apply: true }));
    expect(args).toContain("--update-all");
    expect(args).not.toContain("--json=stream");
    expect(args).not.toContain("-C");
  });

  it("#given globs, hidden and follow #when building args #then both passes carry identical scope flags", () => {
    const input = baseInput("/tmp/x", {
      globs: ["*.ts", "!*.test.ts"],
      includeHidden: true,
      followSymlinks: true,
      selector: "call_expression",
    });
    const preview = buildRewriteArgs(input).filter((arg) => arg !== "--json=stream");
    const apply = buildRewriteApplyArgs(input).filter((arg) => arg !== "--update-all");
    expect(preview).toEqual(apply);
    expect(preview).toContain("--globs");
    expect(preview).toContain("!*.test.ts");
    expect(preview).toContain("--no-ignore");
    expect(preview).toContain("hidden");
    expect(preview).toContain("--follow");
    expect(preview).toContain("--selector");
  });
});

// ---- preflight (never bypassed by force) ----

describe("rewrite tool: preflight", () => {
  it("#given an unbound replacement metavariable #when executed with force #then REWRITE_UNBOUND_METAVARIABLE and no spawn", async () => {
    const dir = fixtureRepo();
    const before = sha256(join(dir, "src/a.ts"));
    const result = await executeRewrite(
      baseInput(dir, { rewrite: "logger.info($OTHER)", apply: true, force: true }),
      SG_PATH,
    );
    expect(result.ok).toBe(false);
    const error = result as RewriteErrorPayload;
    expect(error.error.code).toBe("REWRITE_UNBOUND_METAVARIABLE");
    expect(sha256(join(dir, "src/a.ts"))).toBe(before);
  });

  it("#given a single/multi cardinality mismatch #when executed with force #then REWRITE_METAVARIABLE_KIND_MISMATCH and no mutation", async () => {
    const dir = fixtureRepo();
    const before = sha256(join(dir, "src/a.ts"));
    const result = await executeRewrite(
      baseInput(dir, {
        pattern: "console.log($ARGS)",
        rewrite: "logger.info($$$ARGS)",
        apply: true,
        force: true,
      }),
      SG_PATH,
    );
    expect(result.ok).toBe(false);
    const error = result as RewriteErrorPayload;
    expect(error.error.code).toBe("REWRITE_METAVARIABLE_KIND_MISMATCH");
    expect(sha256(join(dir, "src/a.ts"))).toBe(before);
  });

  it("#given a regex-misuse pattern without force #when executed #then PATTERN_HINT_REJECTED", async () => {
    const dir = fixtureRepo();
    const result = await executeRewrite(
      baseInput(dir, { pattern: "console.log(.*)", rewrite: "logger.info()" }),
      SG_PATH,
    );
    expect(result.ok).toBe(false);
    expect((result as RewriteErrorPayload).error.code).toBe("PATTERN_HINT_REJECTED");
  });

  it("#given a regex-misuse pattern WITH force #when executed #then the heuristic is bypassed", async () => {
    const dir = fixtureRepo();
    const result = await executeRewrite(
      baseInput(dir, { pattern: "console.log(.*)", rewrite: "logger.info()", force: true }),
      SG_PATH,
    );
    if (!result.ok) expect((result as RewriteErrorPayload).error.code).not.toBe("PATTERN_HINT_REJECTED");
  });
});

// ---- live two-pass behavior ----

describe.skipIf(!SG_AVAILABLE)("rewrite tool: dry run (default)", () => {
  it("#given apply omitted #when executed #then it previews with replacements and never mutates", async () => {
    const dir = fixtureRepo();
    const target = join(dir, "src/a.ts");
    const before = sha256(target);

    const result = await executeRewrite(
      rewriteInputSchema.parse({
        pattern: "console.log($MSG)",
        rewrite: "logger.info($MSG)",
        language: "typescript",
        paths: [join(dir, "src")],
        workdir: dir,
      }),
      SG_PATH,
    );

    expect(result.ok).toBe(true);
    const payload = result as RewriteSuccessPayload;
    expect(payload.schemaVersion).toBe(1);
    expect(payload.kind).toBe("rewrite");
    expect(payload.applied).toBe(false);
    expect(payload.matches).toHaveLength(4);
    expect(payload.matches[0].replacement).toBe('logger.info("hello")');
    expect(payload.counts.plannedMatches).toBe(4);
    expect(payload.counts.plannedFiles).toBe(2);
    expect(payload.application.requested).toBe(false);
    expect(payload.application.performed).toBe(false);
    expect(payload.application.countsArePreviewBased).toBe(true);
    expect(payload.application.idempotencyChecked).toBe(false);
    expect(payload.application.secondPassExitCode).toBeNull();
    expect(sha256(target)).toBe(before);
  });

  it("#given an empty rewrite #when previewed #then the replacement is the empty deletion string", async () => {
    const dir = fixtureRepo({ "src/a.ts": 'console.log("hello");\n' });
    const target = join(dir, "src/a.ts");
    const before = sha256(target);
    const result = await executeRewrite(
      baseInput(dir, { rewrite: "", pattern: "console.log($MSG)" }),
      SG_PATH,
    );
    expect(result.ok).toBe(true);
    const payload = result as RewriteSuccessPayload;
    expect(payload.matches[0].replacement).toBe("");
    expect(sha256(target)).toBe(before);
  });

  it("#given an empty rewrite #when applied #then the matched node is deleted from the file", async () => {
    const dir = fixtureRepo({ "src/a.ts": 'console.log("hello");\nconst x = 1;\n' });
    const target = join(dir, "src/a.ts");

    const result = await executeRewrite(
      baseInput(dir, { rewrite: "", pattern: "console.log($MSG)", apply: true }),
      SG_PATH,
    );

    expect(result.ok).toBe(true);
    expect((result as RewriteSuccessPayload).applied).toBe(true);
    expect(readFileSync(target, "utf8")).toBe(";\nconst x = 1;\n");
  });

  it("#given a multi metavariable #when previewed #then the replacement expands the captured nodes", async () => {
    const dir = fixtureRepo({ "src/a.ts": "foo(1, 2, 3);\n" });
    const result = await executeRewrite(
      baseInput(dir, { pattern: "foo($$$ARGS)", rewrite: "bar($$$ARGS)" }),
      SG_PATH,
    );
    expect(result.ok).toBe(true);
    const payload = result as RewriteSuccessPayload;
    expect(payload.matches[0].replacement).toBe("bar(1, 2, 3)");
    expect(payload.matches[0].metavariables.multi.ARGS).toBe("1, 2, 3");
  });
});

describe.skipIf(!SG_AVAILABLE)("rewrite tool: apply gating", () => {
  it("#given a clean non-truncated preview with matches #when apply=true #then the files are mutated", async () => {
    const dir = fixtureRepo();
    const target = join(dir, "src/a.ts");
    const before = sha256(target);

    const result = await executeRewrite(baseInput(dir, { apply: true }), SG_PATH);

    expect(result.ok).toBe(true);
    const payload = result as RewriteSuccessPayload;
    expect(payload.applied).toBe(true);
    expect(payload.application.requested).toBe(true);
    expect(payload.application.performed).toBe(true);
    expect(payload.application.secondPassExitCode).toBe(0);
    expect(payload.application.countsArePreviewBased).toBe(true);
    expect(payload.application.idempotencyChecked).toBe(false);
    expect(payload.warnings.some((warning) => warning.includes("preview"))).toBe(true);
    expect(sha256(target)).not.toBe(before);
    expect(readFileSync(target, "utf8")).toContain('logger.info("hello")');
    expect(readFileSync(target, "utf8")).not.toContain("console.log");
  });

  it("#given a preview truncated by maxMatches #when apply=true #then PREVIEW_TRUNCATED and the file is untouched", async () => {
    const dir = fixtureRepo();
    const target = join(dir, "src/a.ts");
    const before = sha256(target);

    const result = await executeRewrite(baseInput(dir, { apply: true, maxMatches: 2 }), SG_PATH);

    expect(result.ok).toBe(false);
    const error = result as RewriteErrorPayload;
    expect(error.error.code).toBe("PREVIEW_TRUNCATED");
    expect(error.error.phase).toBe("preview");
    expect(sha256(target)).toBe(before);
  });

  it("#given zero matches #when apply=true #then no second pass runs and applied stays false", async () => {
    const dir = fixtureRepo();
    const target = join(dir, "src/a.ts");
    const before = sha256(target);

    const result = await executeRewrite(
      baseInput(dir, { apply: true, pattern: "process.exit($CODE)", rewrite: "shutdown($CODE)" }),
      SG_PATH,
    );

    expect(result.ok).toBe(true);
    const payload = result as RewriteSuccessPayload;
    expect(payload.applied).toBe(false);
    expect(payload.counts.plannedMatches).toBe(0);
    expect(payload.application.requested).toBe(true);
    expect(payload.application.performed).toBe(false);
    expect(payload.application.secondPassExitCode).toBeNull();
    expect(sha256(target)).toBe(before);
  });

  it("#given the fixture changes between passes #when apply=true #then REWRITE_STALE_PREVIEW", async () => {
    const dir = fixtureRepo({ "src/a.ts": 'console.log("hello");\n' });
    const target = join(dir, "src/a.ts");

    const result = await executeRewrite(baseInput(dir, { apply: true }), SG_PATH, undefined, {
      onPreviewComplete: () => {
        writeFileSync(target, "const untouched = 1;\n");
      },
    });

    expect(result.ok).toBe(false);
    const error = result as RewriteErrorPayload;
    expect(error.error.code).toBe("REWRITE_STALE_PREVIEW");
    expect(error.error.phase).toBe("apply");
    expect(error.error.retryable).toBe(true);
    expect(readFileSync(target, "utf8")).toBe("const untouched = 1;\n");
  });

  it("#given the deadline expires while staging between passes #when apply=true #then TIMEOUT and no mutation", async () => {
    // Time itself is the behavior under test: the whole-call budget must be
    // re-checked immediately before the mutating pass, after every prior await.
    const dir = fixtureRepo({ "src/a.ts": 'console.log("hello");\n' });
    const target = join(dir, "src/a.ts");
    const before = sha256(target);

    const result = await executeRewrite(baseInput(dir, { apply: true, timeoutMs: 1_000 }), SG_PATH, undefined, {
      onPreviewComplete: async () => {
        await new Promise((resolve) => setTimeout(resolve, 1_100));
      },
    });

    expect(result.ok).toBe(false);
    const error = result as RewriteErrorPayload;
    expect(error.error.code).toBe("TIMEOUT");
    expect(error.durationMs).toBeGreaterThanOrEqual(1_000);
    expect(sha256(target)).toBe(before);
    expect(readFileSync(target, "utf8")).toContain("console.log");
  });

  it("#given a malformed pattern #when apply=true #then PATTERN_PARSE_FAILED and no mutation", async () => {
    const dir = fixtureRepo();
    const target = join(dir, "src/a.ts");
    const before = sha256(target);

    const result = await executeRewrite(
      baseInput(dir, { apply: true, pattern: "console.log($MSG", rewrite: "logger.info($MSG)", force: true }),
      SG_PATH,
    );

    expect(result.ok).toBe(false);
    expect((result as RewriteErrorPayload).error.code).toBe("PATTERN_PARSE_FAILED");
    expect(sha256(target)).toBe(before);
  });
});
