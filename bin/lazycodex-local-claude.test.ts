/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPlatformPackageCandidates } from "./platform.js";

const testRoots: string[] = [];

afterEach(async () => {
  await Promise.all(testRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("lazycodex local Claude reviewer", () => {
  test("runs claude-probe through local Claude without forwarding ANTHROPIC_API_KEY", async () => {
    // #given
    const fixture = await createLocalClaudeFixture();
    const nodePath = Bun.which("node") ?? "node";

    // #when
    const result = spawnSync(nodePath, [fixture.lazycodexBin, "claude-probe", "--json"], {
      encoding: "utf8",
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: "must-not-reach-claude",
        CAPTURE_DIR: fixture.captureDir,
        PATH: `${fixture.fakeBinDir}:${process.env.PATH ?? ""}`,
      },
    });

    // #then
    const payload = JSON.parse(result.stdout);
    const claudeEnv = JSON.parse(await readFile(join(fixture.captureDir, "claude-env.json"), "utf8"));
    const claudeArgs = JSON.parse(await readFile(join(fixture.captureDir, "claude-args.json"), "utf8"));
    expect(result.status).toBe(0);
    expect(payload.ok).toBe(true);
    expect(payload.apiKeyRemovedForClaudeCall).toBe(true);
    expect(claudeEnv.ANTHROPIC_API_KEY).toBeUndefined();
    expect(claudeArgs).toContain("--permission-mode");
    expect(claudeArgs).toContain("plan");
    expect(claudeArgs).toContain("--tools");
    expect(claudeArgs).toContain("--no-session-persistence");
  });

  test("runs standalone claude-probe without installed platform packages", async () => {
    // #given
    const fixture = await createLocalClaudeFixture({ platformPackages: false });
    const nodePath = Bun.which("node") ?? "node";

    // #when
    const result = spawnSync(nodePath, [fixture.lazycodexBin, "claude-probe", "--json"], {
      encoding: "utf8",
      env: {
        ...process.env,
        CAPTURE_DIR: fixture.captureDir,
        PATH: `${fixture.fakeBinDir}:${process.env.PATH ?? ""}`,
      },
    });

    // #then
    const payload = JSON.parse(result.stdout);
    expect(result.status).toBe(0);
    expect(payload.ok).toBe(true);
  });

  test("fails claude-review when Claude returns malformed review JSON", async () => {
    // #given
    const fixture = await createLocalClaudeFixture({ claudeResult: "this is not review json" });
    const nodePath = Bun.which("node") ?? "node";

    // #when
    const result = spawnSync(nodePath, [fixture.lazycodexBin, "claude-review", "--json"], {
      encoding: "utf8",
      env: {
        ...process.env,
        CAPTURE_DIR: fixture.captureDir,
        PATH: `${fixture.fakeBinDir}:${process.env.PATH ?? ""}`,
      },
    });

    // #then
    const payload = JSON.parse(result.stdout);
    expect(result.status).toBe(1);
    expect(payload.ok).toBe(false);
    expect(payload.parseOk).toBe(false);
    expect(payload.parseError).toContain("required JSON review shape");
  });

  test("does not run Claude review when delegated lazycodex run fails", async () => {
    // #given
    const fixture = await createLocalClaudeFixture({ platformStatus: 42 });
    const nodePath = Bun.which("node") ?? "node";

    // #when
    const result = spawnSync(nodePath, [fixture.lazycodexBin, "run", "--with-local-claude-review", "do work"], {
      encoding: "utf8",
      env: {
        ...process.env,
        CAPTURE_DIR: fixture.captureDir,
        PATH: `${fixture.fakeBinDir}:${process.env.PATH ?? ""}`,
      },
    });

    // #then
    const platformArgs = (await readFile(join(fixture.captureDir, "platform-args"), "utf8")).trim().split("\n");
    expect(result.status).toBe(42);
    expect(platformArgs).toEqual(["run", "do work"]);
    expect(result.stdout).not.toContain("local Claude read-only review");
  });

  test("reviews the delegated run directory and preserves run flags", async () => {
    // #given
    const fixture = await createLocalClaudeFixture({ claudeResult: validReviewResult() });
    const wrapperRepo = await createCommittedRepo(fixture.root, "wrapper-repo", "WRAPPER_DIFF_MARKER");
    const targetRepo = await createCommittedRepo(fixture.root, "target-repo", "TARGET_DIFF_MARKER");
    const nodePath = Bun.which("node") ?? "node";

    // #when
    const result = spawnSync(nodePath, [
      fixture.lazycodexBin,
      "run",
      "--with-local-claude-review",
      "--json",
      "--directory",
      targetRepo,
      "do work",
    ], {
      cwd: wrapperRepo,
      encoding: "utf8",
      env: {
        ...process.env,
        CAPTURE_DIR: fixture.captureDir,
        PATH: `${fixture.fakeBinDir}:${process.env.PATH ?? ""}`,
      },
    });

    // #then
    const platformArgs = (await readFile(join(fixture.captureDir, "platform-args"), "utf8")).trim().split("\n");
    const claudeArgs = JSON.parse(await readFile(join(fixture.captureDir, "claude-args.json"), "utf8"));
    expect(result.status).toBe(0);
    expect(platformArgs).toEqual(["run", "--json", "--directory", targetRepo, "do work"]);
    expect(claudeArgs[1]).toContain("TARGET_DIFF_MARKER");
    expect(claudeArgs[1]).not.toContain("WRAPPER_DIFF_MARKER");
  });

  test("reports benchmark metrics when Claude returns a valid review", async () => {
    // #given
    const review = JSON.stringify({
      findings: [
        {
          confidence: "high",
          file: "bin/lazycodex-local-claude.js",
          issue: "sample issue",
          line: 1,
          minimal_fix: "sample fix",
          severity: "high",
        },
      ],
      quality_score: 8,
      risk_score: 2,
      summary: "sample review",
    });
    const fixture = await createLocalClaudeFixture({ claudeResult: review });
    const nodePath = Bun.which("node") ?? "node";

    // #when
    const result = spawnSync(nodePath, [fixture.lazycodexBin, "claude-benchmark", "--test-command", "true", "--json"], {
      encoding: "utf8",
      env: {
        ...process.env,
        CAPTURE_DIR: fixture.captureDir,
        PATH: `${fixture.fakeBinDir}:${process.env.PATH ?? ""}`,
      },
    });

    // #then
    const payload = JSON.parse(result.stdout);
    expect(result.status).toBe(0);
    expect(payload.baseline.checks.status).toBe(0);
    expect(payload.augmented.checks.status).toBe(0);
    expect(payload.augmented.claude.parseOk).toBe(true);
    expect(payload.augmented.qualitySignals.externalReviewerFindings).toBe(1);
    expect(payload.augmented.qualitySignals.highOrCriticalFindings).toBe(1);
  });

  test("includes staged and untracked content in review diffs", async () => {
    // #given
    const fixture = await createLocalClaudeFixture({ claudeResult: validReviewResult() });
    const repo = await createCommittedRepo(fixture.root, "diff-repo", "BASELINE_MARKER");
    await writeFile(join(repo, "tracked.txt"), "STAGED_MARKER\n");
    spawnSync("git", ["add", "tracked.txt"], { cwd: repo });
    await writeFile(join(repo, "new-file.txt"), "UNTRACKED_MARKER\n");
    const nodePath = Bun.which("node") ?? "node";

    // #when
    const result = spawnSync(nodePath, [fixture.lazycodexBin, "claude-review", "--diff", "--json"], {
      cwd: repo,
      encoding: "utf8",
      env: {
        ...process.env,
        CAPTURE_DIR: fixture.captureDir,
        PATH: `${fixture.fakeBinDir}:${process.env.PATH ?? ""}`,
      },
    });

    // #then
    const claudeArgs = JSON.parse(await readFile(join(fixture.captureDir, "claude-args.json"), "utf8"));
    expect(result.status).toBe(0);
    expect(claudeArgs[1]).toContain("STAGED_MARKER");
    expect(claudeArgs[1]).toContain("UNTRACKED_MARKER");
  });

  test("does not follow untracked symlinks outside the repo", async () => {
    // #given
    const fixture = await createLocalClaudeFixture({ claudeResult: validReviewResult() });
    const repo = await createCommittedRepo(fixture.root, "symlink-repo", "BASELINE_MARKER");
    const outsideSecret = join(fixture.root, "outside-secret.txt");
    await writeFile(outsideSecret, "OUTSIDE_SECRET_MARKER\n");
    await symlink(outsideSecret, join(repo, "linked-secret"));
    const nodePath = Bun.which("node") ?? "node";

    // #when
    const result = spawnSync(nodePath, [fixture.lazycodexBin, "claude-review", "--diff", "--json"], {
      cwd: repo,
      encoding: "utf8",
      env: {
        ...process.env,
        CAPTURE_DIR: fixture.captureDir,
        PATH: `${fixture.fakeBinDir}:${process.env.PATH ?? ""}`,
      },
    });

    // #then
    const claudeArgs = JSON.parse(await readFile(join(fixture.captureDir, "claude-args.json"), "utf8"));
    expect(result.status).toBe(0);
    expect(claudeArgs[1]).not.toContain("OUTSIDE_SECRET_MARKER");
  });
});

async function createLocalClaudeFixture(options: { readonly claudeResult?: string; readonly platformPackages?: boolean; readonly platformStatus?: number } = {}) {
  const root = await mkdtemp(join(tmpdir(), "lazycodex-local-claude-"));
  testRoots.push(root);

  const binDir = join(root, "bin");
  const fakeBinDir = join(root, "fake-bin");
  const captureDir = join(root, "capture");
  await mkdir(binDir, { recursive: true });
  await mkdir(fakeBinDir, { recursive: true });
  await mkdir(captureDir, { recursive: true });

  await cp(fileURLToPath(new URL("./oh-my-opencode.js", import.meta.url)), join(binDir, "lazycodex"));
  await cp(fileURLToPath(new URL("./platform.js", import.meta.url)), join(binDir, "platform.js"));
  await cp(fileURLToPath(new URL("./lazycodex-local-claude.js", import.meta.url)), join(binDir, "lazycodex-local-claude.js"));
  await cp(fileURLToPath(new URL("./lazycodex-local-claude-core.js", import.meta.url)), join(binDir, "lazycodex-local-claude-core.js"));
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "lazycodex", type: "module" }));
  if (options.platformPackages !== false) await writePlatformPackages(root, options.platformStatus ?? 0);
  await writeFakeClaude(fakeBinDir, options.claudeResult ?? "LOCAL_CLAUDE_OK");

  return {
    captureDir,
    fakeBinDir,
    lazycodexBin: join(binDir, "lazycodex"),
    root,
  };
}

async function createCommittedRepo(root: string, name: string, marker: string): Promise<string> {
  const repo = join(root, name);
  await mkdir(repo, { recursive: true });
  spawnSync("git", ["init"], { cwd: repo });
  await writeFile(join(repo, "tracked.txt"), "baseline\n");
  spawnSync("git", ["add", "tracked.txt"], { cwd: repo });
  spawnSync("git", ["-c", "user.name=Test User", "-c", "user.email=test@example.com", "commit", "-m", "init"], { cwd: repo });
  await writeFile(join(repo, "tracked.txt"), `${marker}\n`);
  return repo;
}

function validReviewResult(): string {
  return JSON.stringify({
    findings: [
      {
        confidence: "high",
        file: "bin/lazycodex-local-claude.js",
        issue: "sample issue",
        line: 1,
        minimal_fix: "sample fix",
        severity: "high",
      },
    ],
    quality_score: 8,
    risk_score: 2,
    summary: "sample review",
  });
}

async function writeFakeClaude(fakeBinDir: string, resultText: string): Promise<void> {
  const fakeClaude = join(fakeBinDir, "claude");
  await writeFile(
    fakeClaude,
    [
      "#!/usr/bin/env node",
      'import { writeFileSync } from "node:fs";',
      'writeFileSync(`${process.env.CAPTURE_DIR}/claude-env.json`, JSON.stringify({ ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? undefined, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR ?? undefined }));',
      'writeFileSync(`${process.env.CAPTURE_DIR}/claude-args.json`, JSON.stringify(process.argv.slice(2)));',
      `process.stdout.write(${JSON.stringify(JSON.stringify({ duration_ms: 10, result: resultText, total_cost_usd: 0 }))});`,
      "",
    ].join("\n"),
  );
  await chmod(fakeClaude, 0o755);
}

async function writePlatformPackages(root: string, status: number): Promise<void> {
  const packages = getPlatformPackageCandidates({
    arch: process.arch,
    libcFamily: process.platform === "linux" ? "glibc" : undefined,
    packageBaseName: "oh-my-openagent",
    platform: process.platform,
  });
  for (const packageName of packages) {
    const binaryPath = join(root, "node_modules", packageName, "bin", "oh-my-opencode.js");
    await mkdir(dirname(binaryPath), { recursive: true });
    await writeFile(
      binaryPath,
      [
        "#!/usr/bin/env node",
        'import { writeFileSync } from "node:fs";',
        'writeFileSync(`${process.env.CAPTURE_DIR}/platform-args`, `${process.argv.slice(2).join("\\n")}\\n`);',
        `process.exit(${status});`,
        "",
      ].join("\n"),
    );
    await chmod(binaryPath, 0o755);
  }

  if (process.platform === "linux") {
    const detectLibcPath = join(root, "node_modules", "detect-libc", "index.js");
    await mkdir(dirname(detectLibcPath), { recursive: true });
    await writeFile(detectLibcPath, 'exports.familySync = () => "glibc";\n');
  }
}
