/*
 * Runtime-contract fixture pin (recorded 2026-08-03): this environment successfully
 * provisioned and ran the OMO-pinned ast-grep 0.43.0 binary at
 * ~/.omo/runtime/ast-grep/<platform-arch>/sg. The matrix below pins all three probed
 * facts: --update-all + --json=stream does not mutate, plain --update-all mutates,
 * and a no-match scan exits 0 with an empty stream. No 0.45.0 fallback was needed.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { astGrepRuntimeDir } from "../../../utils/src/ast-grep/install-script";
import { SG_PINNED_VERSION } from "../../../utils/src/ast-grep/sg-manifest";
import {
  buildScanApplyArgs,
  buildScanArgs,
  executeScan,
  scanInputSchema,
  type ScanErrorPayload,
  type ScanInput,
  type ScanSuccessPayload,
} from "./scan";

const PINNED_SG_PATH = join(astGrepRuntimeDir(join(homedir(), ".omo")), process.platform === "win32" ? "sg.exe" : "sg");
const LOCAL_SG_PATH = "/opt/homebrew/bin/sg";
const SG_PATH = existsSync(PINNED_SG_PATH) ? PINNED_SG_PATH : LOCAL_SG_PATH;
const SG_AVAILABLE = existsSync(SG_PATH);
const directories: string[] = [];

const RULE = `id: no-console
language: TypeScript
severity: warning
message: Avoid console.log
note: Use logger.info instead
labels:
  MSG:
    style: primary
    message: logged value
metadata:
  category: quality
rule:
  pattern: console.log($MSG)
fix: logger.info($MSG)
`;

function fixtureRepo(contents = 'console.log("hello");\nconst x = 1;\nconsole.log(x);\n'): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-scan-"));
  directories.push(dir);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src/a.ts"), contents);
  writeFileSync(join(dir, "rule.yml"), RULE);
  return dir;
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function baseInput(dir: string, overrides: Partial<ScanInput> = {}): ScanInput {
  return scanInputSchema.parse({
    ruleFile: join(dir, "rule.yml"),
    paths: [join(dir, "src")],
    workdir: dir,
    ...overrides,
  });
}

afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("scan tool: schema and CLI", () => {
  it("#given both rule sources #when parsed #then oneOf rejects the input", () => {
    expect(() => scanInputSchema.parse({ ruleFile: "rule.yml", inlineRules: RULE, paths: ["src"] })).toThrow();
  });

  it("#given neither rule source #when parsed #then oneOf rejects the input", () => {
    expect(() => scanInputSchema.parse({ paths: ["src"] })).toThrow();
  });

  it("#given a oneOf violation #when executed #then INVALID_ARGUMENT is returned before spawn", async () => {
    const both = await executeScan({ ruleFile: "rule.yml", inlineRules: RULE, paths: ["src"] }, "/missing/sg");
    const neither = await executeScan({ paths: ["src"] }, "/missing/sg");
    expect(both.ok).toBe(false);
    expect((both as ScanErrorPayload).error.code).toBe("INVALID_ARGUMENT");
    expect(neither.ok).toBe(false);
    expect((neither as ScanErrorPayload).error.code).toBe("INVALID_ARGUMENT");
  });

  it("#given defaults #when parsed #then apply is false and search bounds are applied", () => {
    const input = scanInputSchema.parse({ inlineRules: RULE, paths: ["src"] });
    expect(input.apply).toBe(false);
    expect(input.includeMetadata).toBe(false);
    expect(input.maxMatches).toBe(50);
    expect(input.timeoutMs).toBe(300_000);
  });

  it("#given values outside search's shared bounds #when parsed #then they are rejected", () => {
    expect(() => scanInputSchema.parse({ inlineRules: RULE, paths: ["x".repeat(4_097)] })).toThrow();
    expect(() => scanInputSchema.parse({ inlineRules: RULE, paths: ["src"], workdir: "x".repeat(4_097) })).toThrow();
    expect(() => scanInputSchema.parse({ inlineRules: RULE, paths: ["src"], globs: ["x".repeat(1_025)] })).toThrow();
    expect(() => scanInputSchema.parse({ inlineRules: RULE, paths: ["src"], timeoutMs: 999 })).toThrow();
    expect(() => scanInputSchema.parse({ inlineRules: RULE, paths: ["src"], maxMatches: 501 })).toThrow();
  });

  it("#given oversized explicit rule sources #when parsed #then they are rejected before spawn", () => {
    expect(() => scanInputSchema.parse({ ruleFile: "x".repeat(4_097), paths: ["src"] })).toThrow();
    expect(() => scanInputSchema.parse({ inlineRules: "x".repeat(64 * 1_024 + 1), paths: ["src"] })).toThrow();
  });

  it("#given ruleFile #when building dry and apply args #then JSON is preview-only", () => {
    const project = join(tmpdir(), "project");
    const ruleFile = join(project, "rule.yml");
    const sourcePath = join(project, "src");
    const input = baseInput(project);
    expect(buildScanArgs(input)).toEqual([
      "scan", "--rule", ruleFile, "--json=stream", sourcePath,
    ]);
    expect(buildScanApplyArgs(input)).toEqual([
      "scan", "--rule", ruleFile, "--update-all", sourcePath,
    ]);
  });

  it("#given inline rules and scan flags #when building args #then source stays explicit and metadata uses the verified flag", () => {
    const input = scanInputSchema.parse({
      inlineRules: `${RULE}\n---\n${RULE.replace("no-console", "no-console-2")}`,
      paths: ["src"],
      includeMetadata: true,
      globs: ["*.ts"],
      includeHidden: true,
      followSymlinks: true,
    });
    const args = buildScanArgs(input);
    expect(args.slice(0, 3)).toEqual(["scan", "--inline-rules", input.inlineRules!]);
    expect(args).toContain("--include-metadata");
    expect(args).not.toContain("--report-style");
    expect(args).toContain("--globs");
    expect(args).toContain("--no-ignore");
    expect(args).toContain("--follow");
  });
});

describe("scan tool: astral per-string bounds", () => {
  // U+1D11E MUSICAL SYMBOL G CLEF: one Unicode code point, two UTF-16 code units.
  const ASTRAL = "\u{1D11E}";
  const fields: Array<[string, number, (value: string) => Record<string, unknown>]> = [
    ["ruleFile", 4_096, (value) => ({ ruleFile: value, paths: ["src"] })],
    ["path", 4_096, (value) => ({ inlineRules: RULE, paths: [value] })],
    ["workdir", 4_096, (value) => ({ inlineRules: RULE, paths: ["src"], workdir: value })],
    ["glob", 1_024, (value) => ({ inlineRules: RULE, paths: ["src"], globs: [value] })],
  ];

  it("#given the astral boundary character #when measured #then it is one code point and two UTF-16 units", () => {
    expect([...ASTRAL].length).toBe(1);
    expect(ASTRAL.length).toBe(2);
  });

  for (const [field, limit, build] of fields) {
    it(`#given an all-astral ${field} at exactly ${limit} code points #when parsed #then it is accepted`, () => {
      const value = ASTRAL.repeat(limit);
      expect([...value].length).toBe(limit);
      expect(value.length).toBe(limit * 2);
      expect(() => scanInputSchema.parse(build(value))).not.toThrow();
    });

    it(`#given an all-astral ${field} at ${limit + 1} code points #when parsed #then it is rejected`, () => {
      const value = ASTRAL.repeat(limit + 1);
      expect([...value].length).toBe(limit + 1);
      expect(value.length).toBe((limit + 1) * 2);
      expect(() => scanInputSchema.parse(build(value))).toThrow();
    });
  }
});

describe("scan tool: stderr compatibility", () => {
  it("#given the sg deprecation banner starts with WARNING #when scanned #then it is tolerated as a warning", async () => {
    if (process.platform === "win32") return;
    const dir = fixtureRepo();
    const fakeSg = join(dir, "fake-sg.sh");
    writeFileSync(fakeSg, `#!/bin/sh\nprintf '%s\\n' 'WARNING: the sg command name is deprecated; use ast-grep' >&2\nprintf '%s\\n' '${JSON.stringify({
      text: "console.log(x)",
      range: { byteOffset: { start: 0, end: 14 }, start: { line: 0, column: 0 }, end: { line: 0, column: 14 } },
      file: "src/a.ts",
      replacement: "logger.info(x)",
      replacementOffsets: { start: 0, end: 14 },
      language: "TypeScript",
      metaVariables: { single: {}, multi: {}, transformed: {} },
      ruleId: "no-console",
      severity: "warning",
      labels: [],
    }).replaceAll("'", "'\\''")} ' \n`);
    chmodSync(fakeSg, 0o755);
    const result = await executeScan(baseInput(dir), fakeSg);
    expect(result.ok).toBe(true);
    expect((result as ScanSuccessPayload).warnings[0]).toStartWith("WARNING:");
  }, { timeout: 15000 });
});

describe.skipIf(!SG_AVAILABLE)("scan tool: pinned real-binary fixtures", () => {
  it("#given the provisioned runtime #when inspected #then it is the 0.43.0 OMO pin", () => {
    expect(existsSync(PINNED_SG_PATH)).toBe(true);
    const version = spawnSync(PINNED_SG_PATH, ["--version"], { encoding: "utf8" });
    expect(version.status).toBe(0);
    expect(version.stdout).toContain(`ast-grep ${SG_PINNED_VERSION}`);
  });

  it("#given an inline no-console rule #when dry-scanned #then normalized matches carry a nested rule block", async () => {
    const dir = fixtureRepo();
    const target = join(dir, "src/a.ts");
    const before = sha256(target);
    const result = await executeScan(scanInputSchema.parse({
      inlineRules: RULE,
      paths: [join(dir, "src")],
      workdir: dir,
    }), SG_PATH);

    expect(result.ok).toBe(true);
    const payload = result as ScanSuccessPayload;
    expect(payload.applied).toBe(false);
    expect(payload.matches).toHaveLength(2);
    expect(payload.matches[0].path).toBe("src/a.ts");
    expect(payload.matches[0].range.start).toEqual({ line: 1, column: 0, byteOffset: 0 });
    expect(payload.matches[0].replacement).toBe('logger.info("hello")');
    expect(payload.matches[0].rule).toMatchObject({
      ruleId: "no-console",
      severity: "warning",
      note: "Use logger.info instead",
      message: "Avoid console.log",
    });
    expect(payload.matches[0].rule.labels).toHaveLength(1);
    expect(payload.matches[0].rule).not.toHaveProperty("metadata");
    expect(sha256(target)).toBe(before);
  });

  it("#given includeMetadata #when dry-scanned #then metadata is present only when requested", async () => {
    const dir = fixtureRepo();
    const without = await executeScan(baseInput(dir), SG_PATH);
    const withMetadata = await executeScan(baseInput(dir, { includeMetadata: true }), SG_PATH);
    expect(without.ok && without.matches[0].rule).not.toHaveProperty("metadata");
    expect(withMetadata.ok && withMetadata.matches[0].rule.metadata).toEqual({ category: "quality" });
  });

  it("#given the apply command matrix #when run #then JSON+update does not mutate but plain update does", () => {
    const dir = fixtureRepo('console.log("hello");\n');
    const target = join(dir, "src/a.ts");
    const before = sha256(target);
    const combo = spawnSync(SG_PATH, [
      "scan", "--rule", join(dir, "rule.yml"), "--update-all", "--json=stream", join(dir, "src"),
    ], { cwd: dir, encoding: "utf8" });
    expect(combo.status).toBe(0);
    expect(combo.stdout).toContain('"replacement":"logger.info');
    expect(sha256(target)).toBe(before);

    const plain = spawnSync(SG_PATH, [
      "scan", "--rule", join(dir, "rule.yml"), "--update-all", join(dir, "src"),
    ], { cwd: dir, encoding: "utf8" });
    expect(plain.status).toBe(0);
    expect(sha256(target)).not.toBe(before);
    expect(readFileSync(target, "utf8")).toContain("logger.info");
  });

  it("#given apply=true #when executed #then the tool performs a dry preview followed by plain update-all", async () => {
    const dir = fixtureRepo('console.log("hello");\n');
    const result = await executeScan(baseInput(dir, { apply: true }), SG_PATH);
    expect(result.ok).toBe(true);
    const payload = result as ScanSuccessPayload;
    expect(payload.applied).toBe(true);
    expect(payload.application.performed).toBe(true);
    expect(payload.application.secondPassExitCode).toBe(0);
    expect(readFileSync(join(dir, "src/a.ts"), "utf8")).toContain("logger.info");
  });

  it("#given no matching rule #when scanned #then exit 0 plus an empty stream is valid empty success", async () => {
    const dir = fixtureRepo("const x = 1;\n");
    const direct = spawnSync(SG_PATH, buildScanArgs(baseInput(dir)), { cwd: dir, encoding: "utf8" });
    expect(direct.status).toBe(0);
    expect(direct.stdout).toBe("");

    const result = await executeScan(baseInput(dir), SG_PATH);
    expect(result.ok).toBe(true);
    expect((result as ScanSuccessPayload).matches).toEqual([]);
  });

  it("#given unparseable YAML #when scanned #then RULE_PARSE_FAILED is returned", async () => {
    const dir = fixtureRepo();
    const result = await executeScan(scanInputSchema.parse({
      inlineRules: "id: [",
      paths: [join(dir, "src")],
      workdir: dir,
    }), SG_PATH);
    expect(result.ok).toBe(false);
    expect((result as ScanErrorPayload).error.code).toBe("RULE_PARSE_FAILED");
  });

  it("#given a hostile parent sgconfig #when an explicit inline rule scans a child #then ambient config is isolated", async () => {
    const parent = fixtureRepo();
    const child = join(parent, "child");
    mkdirSync(join(child, "src"), { recursive: true });
    writeFileSync(join(child, "src/a.ts"), 'console.log("isolated");\n');
    writeFileSync(join(parent, "sgconfig.yml"), "ruleDirs: [definitely-missing-rules]\n");
    const result = await executeScan(scanInputSchema.parse({
      inlineRules: RULE,
      paths: [join(child, "src")],
      workdir: child,
    }), SG_PATH);
    expect(result.ok).toBe(true);
    expect((result as ScanSuccessPayload).matches).toHaveLength(1);
  });

  it("#given a truncated preview #when apply=true #then PREVIEW_TRUNCATED refuses mutation", async () => {
    const dir = fixtureRepo();
    const target = join(dir, "src/a.ts");
    const before = sha256(target);
    const result = await executeScan(baseInput(dir, { apply: true, maxMatches: 1 }), SG_PATH);
    expect(result.ok).toBe(false);
    expect((result as ScanErrorPayload).error.code).toBe("PREVIEW_TRUNCATED");
    expect(sha256(target)).toBe(before);
  });
});
