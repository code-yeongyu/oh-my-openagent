#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPostToolUseHook } from "../dist/codex-hook.js";
import { createEngine, defaultConfig } from "../dist/rules/engine.js";

const ITERATIONS = 40;
const WARMUP_ITERATIONS = 5;
const RULE_COUNT = 120;
const DISTINCT_TARGET_COUNT = 80;
const DUPLICATE_TARGET_COUNT = 240;

const args = process.argv.slice(2);
const writeBaselinePath = readOption("--write-baseline");
const comparePath = readOption("--compare");

const result = await runBenchmark();

if (writeBaselinePath !== undefined) {
	writeFileSync(writeBaselinePath, `${JSON.stringify(result, null, "\t")}\n`);
}

if (comparePath !== undefined) {
	const baseline = JSON.parse(readFileSync(comparePath, "utf8"));
	const failures = compareResults(baseline, result);
	if (failures.length > 0) {
		for (const failure of failures) {
			process.stderr.write(`${failure}\n`);
		}
		process.exitCode = 1;
	}
}

process.stdout.write(`${JSON.stringify(result, null, "\t")}\n`);

function readOption(name) {
	const index = args.indexOf(name);
	if (index === -1) {
		return undefined;
	}

	const value = args[index + 1];
	if (value === undefined || value.startsWith("--")) {
		throw new Error(`${name} requires a value`);
	}
	return value;
}

async function runBenchmark() {
	const scenarios = [
		runScenario("duplicate-targets", duplicateTargets, DUPLICATE_TARGET_COUNT),
		runScenario("distinct-targets", distinctTargets, DISTINCT_TARGET_COUNT),
	];
	return {
		commit: gitCommit(),
		iterations: ITERATIONS,
		warmupIterations: WARMUP_ITERATIONS,
		ruleCount: RULE_COUNT,
		scenarios,
		hookFastPath: await runHookFastPathScenario(),
	};
}

async function runHookFastPathScenario() {
	const durations = [];
	let repeatOutputBytes = 0;

	for (let iteration = 0; iteration < ITERATIONS + WARMUP_ITERATIONS; iteration += 1) {
		const run = await measureHookFastPathRun();
		if (iteration >= WARMUP_ITERATIONS) {
			durations.push(run.repeatDurationMs);
			repeatOutputBytes += run.repeatOutputBytes;
		}
	}

	return {
		name: "repeat-post-tool-use",
		medianRepeatMs: median(durations),
		minRepeatMs: Math.min(...durations),
		maxRepeatMs: Math.max(...durations),
		repeatOutputBytes,
	};
}

async function measureHookFastPathRun() {
	const projectRoot = mkdtempSync(join(tmpdir(), "codex-rules-hook-bench-"));
	const pluginData = mkdtempSync(join(tmpdir(), "codex-rules-hook-data-"));
	try {
		mkdirSync(join(projectRoot, "src"), { recursive: true });
		mkdirSync(join(projectRoot, ".omo", "rules"), { recursive: true });
		writeFileSync(join(projectRoot, "package.json"), JSON.stringify({ name: "bench" }));
		writeFileSync(join(projectRoot, "src", "app.ts"), "export const app = true;\n");
		for (let index = 0; index < RULE_COUNT; index += 1) {
			writeFileSync(join(projectRoot, ".omo", "rules", `rule-${index}.md`), ruleContent(`rule-${index}`));
		}

		const input = {
			session_id: "bench-session",
			turn_id: "bench-turn",
			transcript_path: null,
			cwd: projectRoot,
			hook_event_name: "PostToolUse",
			model: "gpt-5.5",
			permission_mode: "default",
			tool_name: "mcp__filesystem__read_file",
			tool_input: { path: join(projectRoot, "src", "app.ts") },
			tool_response: { text: "file contents" },
			tool_use_id: "bench-call",
		};

		await runPostToolUseHook(input, {
			pluginDataRoot: pluginData,
			env: { CODEX_RULES_ENABLED_SOURCES: ".omo/rules" },
		});
		const start = process.hrtime.bigint();
		const repeatOutput = await runPostToolUseHook(input, {
			pluginDataRoot: pluginData,
			env: { CODEX_RULES_ENABLED_SOURCES: ".omo/rules" },
		});
		return {
			repeatDurationMs: Number(process.hrtime.bigint() - start) / 1_000_000,
			repeatOutputBytes: Buffer.byteLength(repeatOutput),
		};
	} finally {
		rmSync(projectRoot, { recursive: true, force: true });
		rmSync(pluginData, { recursive: true, force: true });
	}
}

function runScenario(name, targetFactory, targetCount) {
	const durations = [];
	let counters = { findProjectRoot: 0, findCandidates: 0, readFile: 0 };

	for (let iteration = 0; iteration < ITERATIONS + WARMUP_ITERATIONS; iteration += 1) {
		const run = measureRun(targetFactory);
		if (iteration >= WARMUP_ITERATIONS) {
			durations.push(run.durationMs);
			counters = addCounters(counters, run.counters);
		}
	}

	return {
		name,
		targetCount,
		medianMs: median(durations),
		minMs: Math.min(...durations),
		maxMs: Math.max(...durations),
		counters,
	};
}

function measureRun(targetPaths) {
	const projectRoot = mkdtempSync(join(tmpdir(), "codex-rules-bench-"));
	try {
		const candidates = makeCandidates(projectRoot);
		mkdirSync(join(projectRoot, ".omo", "rules"), { recursive: true });
		for (const candidate of candidates) {
			writeFileSync(candidate.path, "");
		}
		const counters = { findProjectRoot: 0, findCandidates: 0, readFile: 0 };
		const engine = createEngine(defaultConfig(), {
			findProjectRoot: () => {
				counters.findProjectRoot += 1;
				return projectRoot;
			},
			findCandidates: () => {
				counters.findCandidates += 1;
				return candidates;
			},
			readFile: (path) => {
				counters.readFile += 1;
				return ruleContent(path);
			},
		});
		const generatedTargetPaths = targetPaths(projectRoot);
		const start = process.hrtime.bigint();
		engine.loadDynamicRules(projectRoot, generatedTargetPaths);
		const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
		return { durationMs, counters };
	} finally {
		rmSync(projectRoot, { recursive: true, force: true });
	}
}

function duplicateTargets(projectRoot) {
	const targetPath = join(projectRoot, "src", "app.ts");
	return Array.from({ length: DUPLICATE_TARGET_COUNT }, () => targetPath);
}

function distinctTargets(projectRoot) {
	return Array.from({ length: DISTINCT_TARGET_COUNT }, (_, index) => join(projectRoot, "src", `file-${index}.ts`));
}

function makeCandidates(projectRoot) {
	return Array.from({ length: RULE_COUNT }, (_, index) => ({
		path: join(projectRoot, ".omo", "rules", `rule-${index}.md`),
		realPath: join(projectRoot, ".omo", "rules", `rule-${index}.md`),
		source: ".omo/rules",
		distance: 0,
		isGlobal: false,
		isSingleFile: false,
		relativePath: `.omo/rules/rule-${index}.md`,
	}));
}

function ruleContent(path) {
	return ["---", "globs: **/*.ts", "---", "", `Rule from ${path}`].join("\n");
}

function addCounters(left, right) {
	return {
		findProjectRoot: left.findProjectRoot + right.findProjectRoot,
		findCandidates: left.findCandidates + right.findCandidates,
		readFile: left.readFile + right.readFile,
	};
}

function median(values) {
	const sorted = [...values].sort((left, right) => left - right);
	const index = Math.floor(sorted.length / 2);
	return sorted[index] ?? 0;
}

function gitCommit() {
	try {
		return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
	} catch {
		return "unknown";
	}
}

function compareResults(baseline, current) {
	const failures = [];
	for (const scenario of current.scenarios) {
		const baselineScenario = baseline.scenarios.find((candidate) => candidate.name === scenario.name);
		if (baselineScenario === undefined) {
			failures.push(`missing baseline scenario: ${scenario.name}`);
			continue;
		}

		for (const counterName of ["findProjectRoot", "findCandidates", "readFile"]) {
			if (scenario.counters[counterName] > baselineScenario.counters[counterName]) {
				failures.push(
					`${scenario.name}.${counterName} regressed: ${scenario.counters[counterName]} > ${baselineScenario.counters[counterName]}`,
				);
			}
		}
	}
	if (baseline.hookFastPath === undefined) {
		failures.push("missing baseline hookFastPath scenario");
	} else {
		if (current.hookFastPath.repeatOutputBytes > baseline.hookFastPath.repeatOutputBytes) {
			failures.push(
				`hookFastPath.repeatOutputBytes regressed: ${current.hookFastPath.repeatOutputBytes} > ${baseline.hookFastPath.repeatOutputBytes}`,
			);
		}

		const maxMedianRepeatMs = baseline.hookFastPath.medianRepeatMs * 1.5;
		if (current.hookFastPath.medianRepeatMs > maxMedianRepeatMs) {
			failures.push(
				`hookFastPath.medianRepeatMs regressed: ${current.hookFastPath.medianRepeatMs} > ${maxMedianRepeatMs}`,
			);
		}
	}
	return failures;
}
