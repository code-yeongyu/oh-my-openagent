import { resolve } from "node:path";
import {
  buildReviewPrompt,
  callClaude,
  collectDiff,
  hasValidReviewShape,
  parseLocalClaudeArgs,
  parseReviewJson,
  runCommand,
  summarizeChecks,
} from "./lazycodex-local-claude-core.js";

const LOCAL_CLAUDE_COMMANDS = new Set(["claude-probe", "claude-review", "claude-benchmark"]);

export function shouldHandleLazyCodexLocalClaude(invocationName, argv) {
  if (invocationName !== "lazycodex" && invocationName !== "lazycodex-ai") return false;
  const command = argv[0];
  return shouldHandleLazyCodexStandaloneLocalClaude(invocationName, argv) ||
    (command === "run" && argv.includes("--with-local-claude-review"));
}

export function shouldHandleLazyCodexStandaloneLocalClaude(invocationName, argv) {
  if (invocationName !== "lazycodex" && invocationName !== "lazycodex-ai") return false;
  return LOCAL_CLAUDE_COMMANDS.has(argv[0]);
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function runProbe(options) {
  const probe = callClaude("Reply with exactly: LOCAL_CLAUDE_OK", options);
  const payload = {
    apiKeyRemovedForClaudeCall: true,
    claudeConfigDir: probe.claudeConfigDir,
    claudeDurationMs: probe.parsed?.duration_ms ?? null,
    durationMs: probe.durationMs,
    modelUsage: probe.parsed?.modelUsage ?? null,
    ok: probe.status === 0 && probe.text.includes("LOCAL_CLAUDE_OK"),
    stderr: probe.stderr.trim(),
    timedOut: probe.timedOut,
    timeoutMs: probe.timeoutMs,
    totalCostUsd: probe.parsed?.total_cost_usd ?? null,
  };
  if (options.json) printJson(payload);
  else {
    console.log(`local Claude probe: ${payload.ok ? "OK" : "FAILED"} (${payload.durationMs}ms)`);
    console.log(`api key removed for call: ${payload.apiKeyRemovedForClaudeCall}`);
    if (payload.totalCostUsd !== null) console.log(`reported cost/credit draw: $${payload.totalCostUsd}`);
  }
  return payload.ok ? 0 : 1;
}

function runReview(options) {
  const diff = options.diff ? collectDiff() : { chars: 0, stat: "", text: "", truncated: false };
  const review = callClaude(buildReviewPrompt(options.task, diff), options);
  const parsedReview = parseReviewJson(review.text);
  const reviewOk = review.status === 0 && hasValidReviewShape(parsedReview);
  const payload = {
    diff,
    durationMs: review.durationMs,
    ok: reviewOk,
    parseError: reviewOk ? null : "Claude review output did not match the required JSON review shape.",
    parseOk: reviewOk,
    rawText: reviewOk ? undefined : review.text,
    review: parsedReview,
    stderr: review.stderr.trim(),
    timedOut: review.timedOut,
    timeoutMs: review.timeoutMs,
    totalCostUsd: review.parsed?.total_cost_usd ?? null,
  };
  if (options.json) printJson(payload);
  else if (reviewOk) {
    console.log(`Claude review: OK (${payload.durationMs}ms)`);
    console.log(`findings=${parsedReview.findings.length} quality=${parsedReview.quality_score ?? "n/a"} risk=${parsedReview.risk_score ?? "n/a"}`);
    console.log(parsedReview.summary ?? "");
  } else {
    console.error(payload.parseError);
    console.log(review.text);
  }
  return reviewOk ? 0 : 1;
}

function runBenchmark(options) {
  const task = options.task || "Review current diff for concrete bugs and missing tests.";
  const testCommand = options.testCommand || "git diff --check";
  const diff = collectDiff();
  const baselineStarted = Date.now();
  const baselineCheck = runCommand(testCommand, [], { shell: true });
  const baseline = {
    checks: summarizeChecks(baselineCheck),
    durationMs: Date.now() - baselineStarted,
    mode: "codex_only_checks",
    qualitySignals: { externalReviewerFindings: 0, staticIssueLines: summarizeChecks(baselineCheck).issueLineCount },
  };

  const augmentedStarted = Date.now();
  const augmentedCheck = runCommand(testCommand, [], { shell: true });
  const review = callClaude(buildReviewPrompt(task, diff), options);
  const parsedReview = parseReviewJson(review.text);
  const reviewOk = review.status === 0 && hasValidReviewShape(parsedReview);
  const findings = reviewOk ? parsedReview.findings : [];
  const augmented = {
    checks: summarizeChecks(augmentedCheck),
    claude: {
      claudeDurationMs: review.parsed?.duration_ms ?? null,
      durationMs: review.durationMs,
      parseError: reviewOk ? null : "Claude review output did not match the required JSON review shape.",
      parseOk: reviewOk,
      status: review.status,
      timedOut: review.timedOut,
      timeoutMs: review.timeoutMs,
      totalCostUsd: review.parsed?.total_cost_usd ?? null,
    },
    durationMs: Date.now() - augmentedStarted,
    mode: "codex_checks_plus_local_claude_review",
    qualitySignals: {
      externalReviewerFindings: findings.length,
      highOrCriticalFindings: findings.filter((finding) => ["critical", "high"].includes(String(finding.severity))).length,
      qualityScore: reviewOk ? parsedReview.quality_score ?? null : null,
      riskScore: reviewOk ? parsedReview.risk_score ?? null : null,
      staticIssueLines: summarizeChecks(augmentedCheck).issueLineCount,
    },
    rawText: reviewOk ? undefined : review.text,
    review: parsedReview,
  };

  const payload = {
    augmented,
    baseline,
    comparison: {
      addedHighOrCriticalFindings: augmented.qualitySignals.highOrCriticalFindings,
      addedReviewerFindings: augmented.qualitySignals.externalReviewerFindings,
      elapsedDeltaMs: augmented.durationMs - baseline.durationMs,
      elapsedRatio: baseline.durationMs > 0 ? Number((augmented.durationMs / baseline.durationMs).toFixed(2)) : null,
    },
    diff: { chars: diff.chars, stat: diff.stat, truncated: diff.truncated },
    task,
    testCommand,
  };
  if (options.json) printJson(payload);
  else {
    console.log(`Baseline: ${baseline.durationMs}ms, static issue lines=${baseline.qualitySignals.staticIssueLines}`);
    console.log(`Claude-augmented: ${augmented.durationMs}ms, reviewer findings=${augmented.qualitySignals.externalReviewerFindings}`);
    console.log(`Delta: ${payload.comparison.elapsedDeltaMs}ms (${payload.comparison.elapsedRatio}x)`);
  }
  return baselineCheck.status === 0 && augmentedCheck.status === 0 && reviewOk ? 0 : 1;
}

function parseRunWithLocalClaudeArgs(argv) {
  const options = { _: [], delegateArgs: [], reviewCwd: process.cwd() };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--with-local-claude-review") options.withLocalClaudeReview = true;
    else if (arg === "--claude-config-dir") options.claudeConfigDir = argv[++index];
    else if (arg.startsWith("--claude-config-dir=")) options.claudeConfigDir = arg.slice("--claude-config-dir=".length);
    else if (arg === "--claude-timeout-ms") options.claudeTimeoutMs = Number(argv[++index]);
    else if (arg.startsWith("--claude-timeout-ms=")) options.claudeTimeoutMs = Number(arg.slice("--claude-timeout-ms=".length));
    else {
      options._.push(arg);
      options.delegateArgs.push(arg);
    }
  }
  options.reviewCwd = resolveRunDirectory(options.delegateArgs);
  return options;
}

function resolveRunDirectory(delegateArgs) {
  for (let index = 0; index < delegateArgs.length; index += 1) {
    const arg = delegateArgs[index];
    if (arg === "--directory" || arg === "-d") return resolveDirectory(delegateArgs[index + 1]);
    if (arg.startsWith("--directory=")) return resolveDirectory(arg.slice("--directory=".length));
  }
  return process.cwd();
}

function resolveDirectory(value) {
  return value ? resolve(value) : process.cwd();
}

function runWithLocalClaudeReview(options, runDelegate) {
  const runResult = runDelegate(["run", ...options.delegateArgs]);
  if (runResult.signal) return runResult.signalExitCode;
  if ((runResult.status ?? 1) !== 0) return runResult.status ?? 1;

  const review = callClaude(buildReviewPrompt(options._.join(" "), collectDiff({ cwd: options.reviewCwd })), options);
  const parsedReview = parseReviewJson(review.text);
  const reviewOk = review.status === 0 && hasValidReviewShape(parsedReview);
  console.log("\n--- local Claude read-only review ---");
  if (reviewOk) console.log(JSON.stringify(parsedReview, null, 2));
  else {
    console.error("lazycodex: local Claude review did not return the required JSON review shape.");
    console.log(review.text);
  }
  return reviewOk ? review.status : 1;
}

export function runLazyCodexLocalClaude(argv, runDelegate) {
  const command = argv[0];
  if (command === "run") {
    const runOptions = parseRunWithLocalClaudeArgs(argv.slice(1));
    if (runOptions.withLocalClaudeReview) return runWithLocalClaudeReview(runOptions, runDelegate);
    return 1;
  }
  const options = parseLocalClaudeArgs(argv.slice(1));
  if (command === "claude-probe") return runProbe(options);
  if (command === "claude-review") return runReview(options);
  if (command === "claude-benchmark") return runBenchmark(options);
  return 1;
}
