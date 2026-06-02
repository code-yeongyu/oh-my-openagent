import { spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const DEFAULT_CLAUDE_TIMEOUT_MS = 180_000;

export function parseLocalClaudeArgs(argv) {
  const options = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--diff") options.diff = true;
    else if (arg === "--with-local-claude-review") options.withLocalClaudeReview = true;
    else if (arg === "--claude-config-dir") options.claudeConfigDir = argv[++index];
    else if (arg.startsWith("--claude-config-dir=")) options.claudeConfigDir = arg.slice("--claude-config-dir=".length);
    else if (arg === "--claude-timeout-ms") options.claudeTimeoutMs = Number(argv[++index]);
    else if (arg.startsWith("--claude-timeout-ms=")) options.claudeTimeoutMs = Number(arg.slice("--claude-timeout-ms=".length));
    else if (arg === "--task") options.task = argv[++index];
    else if (arg.startsWith("--task=")) options.task = arg.slice("--task=".length);
    else if (arg === "--test-command") options.testCommand = argv[++index];
    else if (arg.startsWith("--test-command=")) options.testCommand = arg.slice("--test-command=".length);
    else options._.push(arg);
  }
  return options;
}

export function runCommand(command, args, options = {}) {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
    env: options.env ?? process.env,
    maxBuffer: options.maxBuffer ?? 20 * 1024 * 1024,
    shell: options.shell ?? false,
    stdio: options.stdio ?? "pipe",
    timeout: options.timeout,
  });
  return {
    durationMs: Date.now() - started,
    error: result.error?.message,
    signal: result.signal,
    status: result.status ?? (result.error ? 1 : 0),
    stderr: result.stderr ?? "",
    stdout: result.stdout ?? "",
  };
}

export function expandHome(value) {
  return resolve(value.replace(/^~(?=$|\/)/, homedir()));
}

export function selectClaudeConfigDir(explicitConfigDir, env = process.env) {
  if (explicitConfigDir) return expandHome(explicitConfigDir);
  const configuredDirs = env.LAZYCODEX_CLAUDE_CONFIG_DIRS;
  if (!configuredDirs) return null;
  const dirs = configuredDirs.split(/[,:]/).map((item) => item.trim()).filter(Boolean).map(expandHome);
  if (dirs.length === 0) return null;

  const path = join(homedir(), ".local", "share", "lazycodex-claude", "state.json");
  let nextIndex = 0;
  try {
    const state = JSON.parse(readFileSync(path, "utf8"));
    if (Number.isInteger(state.nextClaudeConfigIndex)) nextIndex = state.nextClaudeConfigIndex;
  } catch {
    nextIndex = 0;
  }

  const selected = dirs[((nextIndex % dirs.length) + dirs.length) % dirs.length];
  try {
    mkdirSync(join(homedir(), ".local", "share", "lazycodex-claude"), { recursive: true });
    writeFileSync(path, JSON.stringify({ lastClaudeConfigDir: selected, nextClaudeConfigIndex: nextIndex + 1 }, null, 2));
  } catch (error) {
    ignoreBestEffortStateError(error);
  }
  return selected;
}

function ignoreBestEffortStateError(error) {
  if (!(error instanceof Error)) throw error;
  if (process.env.LAZYCODEX_CLAUDE_STATE_DEBUG === "1") console.error(`lazycodex: ${error.message}`);
}

export function claudeEnv(selectedConfigDir, env = process.env) {
  const childEnv = { ...env };
  delete childEnv.ANTHROPIC_API_KEY;
  if (selectedConfigDir) childEnv.CLAUDE_CONFIG_DIR = selectedConfigDir;
  return childEnv;
}

export function callClaude(prompt, options) {
  const selectedConfigDir = selectClaudeConfigDir(options.claudeConfigDir);
  const timeoutMs = Number.isFinite(options.claudeTimeoutMs) && options.claudeTimeoutMs > 0
    ? options.claudeTimeoutMs
    : DEFAULT_CLAUDE_TIMEOUT_MS;
  const result = runCommand("claude", [
    "-p",
    prompt,
    "--output-format",
    "json",
    "--max-turns",
    "1",
    "--permission-mode",
    "plan",
    "--tools",
    "",
    "--no-session-persistence",
  ], {
    env: claudeEnv(selectedConfigDir),
    maxBuffer: 30 * 1024 * 1024,
    timeout: timeoutMs,
  });

  let parsed = null;
  if (result.stdout.trim()) {
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      parsed = null;
    }
  }

  return {
    ...result,
    claudeConfigDir: selectedConfigDir,
    parsed,
    text: parsed?.result ?? result.stdout,
    timedOut: result.error === "spawnSync claude ETIMEDOUT",
    timeoutMs,
  };
}

export function collectDiff(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const unstagedStat = runCommand("git", ["diff", "--stat", "--no-ext-diff"], { cwd });
  const stagedStat = runCommand("git", ["diff", "--cached", "--stat", "--no-ext-diff"], { cwd });
  const unstagedDiff = runCommand("git", ["diff", "--no-ext-diff", "--no-color"], { cwd });
  const stagedDiff = runCommand("git", ["diff", "--cached", "--no-ext-diff", "--no-color"], { cwd });
  const untracked = collectUntrackedFiles(cwd);
  const text = [
    "## Staged diff",
    stagedStat.stdout,
    stagedDiff.stdout,
    "## Unstaged diff",
    unstagedStat.stdout,
    unstagedDiff.stdout,
    "## Untracked files",
    untracked.text,
  ].filter(Boolean).join("\n\n");
  const maxChars = 24_000;
  return {
    chars: text.length,
    stat: [stagedStat.stdout.trim(), unstagedStat.stdout.trim(), untracked.stat].filter(Boolean).join("\n"),
    text: text.length > maxChars ? `${text.slice(0, maxChars)}\n\n[diff truncated at ${maxChars} chars]` : text,
    truncated: text.length > maxChars,
  };
}

function collectUntrackedFiles(cwd) {
  const listed = runCommand("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd });
  if (listed.status !== 0 || !listed.stdout) return { stat: "", text: "" };
  const files = listed.stdout.split("\0").filter(Boolean).slice(0, 10);
  let remainingChars = 12_000;
  const sections = [];
  for (const file of files) {
    const path = join(cwd, file);
    const stat = lstatSync(path);
    if (!stat.isFile()) continue;
    if (stat.size > 64 * 1024) {
      sections.push(`### ${file}\n[untracked file skipped: ${stat.size} bytes exceeds 65536 byte inline limit]`);
      continue;
    }
    const content = readFileSync(path, "utf8");
    const clipped = content.slice(0, Math.max(0, remainingChars));
    remainingChars -= clipped.length;
    sections.push(`### ${file}\n${clipped}${content.length > clipped.length ? "\n[untracked file truncated]" : ""}`);
    if (remainingChars <= 0) break;
  }
  return {
    stat: files.length > 0 ? `Untracked files: ${files.join(", ")}` : "",
    text: sections.join("\n\n"),
  };
}

export function buildReviewPrompt(task, diff) {
  return `You are a read-only reviewer for a Codex/lazycodex workflow.
Do not ask questions. Do not edit files. Do not suggest broad rewrites.

Task:
${task || "Review the current working tree diff."}

Return strict JSON only:
{
  "summary": string,
  "findings": [
    {
      "severity": "critical" | "high" | "medium" | "low",
      "file": string,
      "line": number | null,
      "issue": string,
      "minimal_fix": string,
      "confidence": "low" | "medium" | "high"
    }
  ],
  "quality_score": number,
  "risk_score": number
}

Diff:
${diff.text}`;
}

export function parseReviewJson(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

export function hasValidReviewShape(value) {
  return Boolean(value && typeof value === "object" && Array.isArray(value.findings));
}

export function summarizeChecks(output) {
  const lines = `${output.stdout}\n${output.stderr}`.split(/\r?\n/).filter(Boolean);
  const issueLines = lines.filter((line) => /\b(error|fail|failed|warning|warn|todo)\b/i.test(line));
  return {
    durationMs: output.durationMs,
    issueLineCount: issueLines.length,
    sample: issueLines.slice(0, 12),
    status: output.status,
  };
}
