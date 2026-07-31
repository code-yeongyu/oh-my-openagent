#!/usr/bin/env node
// Live QA for the fallback-architect nudge. Drives a real senpi process against an isolated agent
// directory and a two-model mock provider, so the refusal -> fallback -> injection path is proven
// end to end instead of being asserted at the seam.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createSandbox, seedSandbox } from "./drive.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const mockProvider = join(scriptDir, "fallback-architect-mock-provider.ts");
const realSenpiAgentDir = join(homedir(), ".senpi", "agent");

const DIRECTIVE_TYPE = "omo-fallback-architect:directive";
const NOTICE_TYPE = "omo-fallback-architect:notice";
const REMINDER_TAG = "<omo-fallback-architect-reminder>";
const PRIMARY = "omo-mock/claude-fable-5";
const FALLBACK = "omo-mock/mock-weak";

const SCENARIOS = [
	{ name: "A-classifier-refusal", primaryOutcome: "refusal", architect: true, expectDirective: true },
	{ name: "B-policy-rejection", primaryOutcome: "policy_error", architect: true, expectDirective: true },
	{ name: "C-transient-fallback", primaryOutcome: "transient", architect: true, expectDirective: false },
	{ name: "D-architect-absent", primaryOutcome: "refusal", architect: false, expectDirective: false },
];

function seedScenario(scenario) {
	const sandbox = createSandbox();
	seedSandbox(sandbox);
	const sessionDir = join(sandbox.root, "sessions");
	mkdirSync(sessionDir, { recursive: true });
	// The omo config loader reads the USER scope from $HOME/.omo. Without an isolated home the
	// developer's own architect category answers the gate and the negative scenarios pass vacuously.
	const home = join(sandbox.root, "home");
	mkdirSync(home, { recursive: true });

	const settings = JSON.parse(readFileSync(join(sandbox.agentDir, "settings.json"), "utf8"));
	settings.retry = {
		enabled: true,
		maxRetries: 1,
		baseDelayMs: 1,
		modelFallback: true,
		fallbackChains: { [PRIMARY]: [FALLBACK] },
	};
	writeFileSync(join(sandbox.agentDir, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`);

	mkdirSync(join(sandbox.cwd, ".omo"), { recursive: true });
	const categories = scenario.architect
		? { architect: { model: "anthropic/claude-fable-5", variant: "xhigh" } }
		: { quick: { model: "anthropic/claude-opus-5" } };
	writeFileSync(join(sandbox.cwd, ".omo", "omo.json"), `${JSON.stringify({ categories }, null, 2)}\n`);
	writeFileSync(
		join(sandbox.cwd, "mock-script.json"),
		`${JSON.stringify({ primaryOutcome: scenario.primaryOutcome }, null, 2)}\n`,
	);

	return { sandbox, sessionDir, home };
}

function driveSenpi(senpiBin, scenario) {
	return spawnSync(
		senpiBin,
		[
			"-e",
			mockProvider,
			"-p",
			"--provider",
			"omo-mock",
			"--model",
			"claude-fable-5",
			"--session-dir",
			scenario.sessionDir,
			"design a caching layer for the fixture service",
		],
		{
			cwd: scenario.sandbox.cwd,
			env: {
				...process.env,
				HOME: scenario.home,
				USERPROFILE: scenario.home,
				SENPI_CODING_AGENT_DIR: scenario.sandbox.agentDir,
				XDG_CONFIG_HOME: scenario.sandbox.xdgConfigHome,
				SENPI_CODING_AGENT_SESSION_DIR: scenario.sessionDir,
				OMO_SENPI_QA: "1",
			},
			encoding: "utf8",
			timeout: 120_000,
			maxBuffer: 64 * 1024 * 1024,
		},
	);
}

function readSessionEntries(sessionDir) {
	if (!existsSync(sessionDir)) return [];
	const entries = [];
	const walk = (dir) => {
		for (const name of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, name.name);
			if (name.isDirectory()) walk(full);
			else if (name.name.endsWith(".jsonl")) {
				for (const line of readFileSync(full, "utf8").split("\n")) {
					if (line.trim() === "") continue;
					try {
						entries.push(JSON.parse(line));
					} catch {
						// A partially flushed trailing line is not evidence either way.
					}
				}
			}
		}
	};
	walk(sessionDir);
	return entries;
}

function collectDirectives(entries) {
	return entries.filter((entry) => collectCustomTypes(entry).includes(DIRECTIVE_TYPE));
}

function collectNotices(entries) {
	return entries.filter((entry) => collectCustomTypes(entry).includes(NOTICE_TYPE));
}

function findCustomPayload(entry, customType) {
	const stack = [entry];
	while (stack.length > 0) {
		const current = stack.pop();
		if (typeof current !== "object" || current === null) continue;
		if (Reflect.get(current, "customType") === customType) return current;
		for (const nested of Object.values(current)) stack.push(nested);
	}
	return undefined;
}

// The regression this guards: the reminder used to ride APPENDED to the user's own queued text,
// which rendered it inside the user's bubble in the TUI. No user-authored message may ever carry
// the reminder tag again.
function userMessagesLeakingReminder(entries) {
	return entries.filter((entry) => {
		if (entry?.type !== "message" || entry?.message?.role !== "user") return false;
		return JSON.stringify(entry.message.content ?? "").includes(REMINDER_TAG);
	});
}

function collectCustomTypes(value, depth = 0) {
	if (depth > 4 || typeof value !== "object" || value === null) return [];
	const found = [];
	for (const [key, nested] of Object.entries(value)) {
		if (key === "customType" && typeof nested === "string") found.push(nested);
		else found.push(...collectCustomTypes(nested, depth + 1));
	}
	return found;
}

function directiveContent(entry) {
	return customMessageDetails(entry, DIRECTIVE_TYPE).content;
}

function customMessageDetails(entry, customType) {
	const stack = [entry];
	while (stack.length > 0) {
		const current = stack.pop();
		if (typeof current !== "object" || current === null) continue;
		if (Reflect.get(current, "customType") === customType) {
			const content = Reflect.get(current, "content");
			return { content: typeof content === "string" ? content : "", display: Reflect.get(current, "display") };
		}
		for (const nested of Object.values(current)) stack.push(nested);
	}
	return { content: "", display: undefined };
}

function runScenario(senpiBin, scenario) {
	const seeded = seedScenario(scenario);
	try {
		const run = driveSenpi(senpiBin, seeded);
		const entries = readSessionEntries(seeded.sessionDir);
		const directives = collectDirectives(entries);
		const content = directives.length === 0 ? "" : directiveContent(directives[0]);
		const notices = collectNotices(entries);
		const noticePayload = notices.length === 0 ? undefined : findCustomPayload(notices[0], NOTICE_TYPE);
		const noticeOk = scenario.expectDirective
			? notices.length === 1 &&
				noticePayload?.display === true &&
				noticePayload?.details?.from === PRIMARY &&
				noticePayload?.details?.to === FALLBACK &&
				String(noticePayload?.content ?? "").includes('task(category: "architect")')
			: notices.length === 0;
		const reminderLeaks = userMessagesLeakingReminder(entries);

		// Criterion 1 is "exactly ONE directive", so the count is the observable, never a boolean.
		const expectedCount = scenario.expectDirective ? 1 : 0;
		const contentOk = scenario.expectDirective
			? content.includes(PRIMARY) &&
				content.includes(FALLBACK) &&
				content.includes('task(category: "architect")') &&
				content.includes("Decompose the current problem into independent parts") &&
				content.includes("ONE self-contained query per part") &&
				content.includes("security- and biology-related content") &&
				content.includes("indirectly-phrased sub-questions") &&
				content.includes("did not drop the question")
			: true;
		const exitOk = run.status === 0;

		return {
			scenario: scenario.name,
			expectedDirectives: expectedCount,
			observedDirectives: directives.length,
			contentOk,
			observedNotices: notices.length,
			noticeOk,
			reminderLeaks: reminderLeaks.length,
			exitStatus: run.status,
			entries: entries.length,
			result:
				directives.length === expectedCount && contentOk && noticeOk && reminderLeaks.length === 0 && exitOk
					? "PASS"
					: "FAIL",
			stderrTail: exitOk ? undefined : String(run.stderr ?? "").slice(-400),
		};
	} finally {
		rmSync(seeded.sandbox.root, { recursive: true, force: true });
	}
}

// Per-file digests instead of drive.mjs credentialDigest: a LIVE senpi session on the developer
// machine legitimately rewrites settings.json (tipsHistory) and models.json mid-run, so a single
// all-files digest can never pass concurrently. Corruption of auth.json/trust.json is the real
// tripwire; live-session churn is reported informationally.
const CREDENTIAL_FILES = ["auth.json", "trust.json"];
const LIVE_SESSION_FILES = ["settings.json", "models.json"];

function fileDigests(agentDir) {
	const digests = {};
	for (const name of [...CREDENTIAL_FILES, ...LIVE_SESSION_FILES]) {
		const path = join(agentDir, name);
		digests[name] = existsSync(path)
			? createHash("sha256").update(readFileSync(path)).digest("hex")
			: "absent";
	}
	return digests;
}

function changedFiles(before, after) {
	return Object.keys(before).filter((name) => before[name] !== after[name]);
}

function findOnPath(bin) {
	if (bin.includes("/")) return existsSync(bin) ? bin : null;
	for (const dir of (process.env.PATH ?? "").split(delimiter)) {
		const candidate = resolve(dir || ".", bin);
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

function runSelfTest() {
	const entries = [
		{ type: "custom", message: { customType: DIRECTIVE_TYPE, content: `${PRIMARY} ${FALLBACK} task(category: "architect")` } },
		{ type: "user", content: "hello" },
	];
	if (collectDirectives(entries).length !== 1) throw new Error("self-test: directive entry not detected exactly once");
	if (!directiveContent(collectDirectives(entries)[0]).includes(PRIMARY)) throw new Error("self-test: directive content not read");
	if (collectDirectives([{ type: "user", content: "hello" }]).length !== 0) throw new Error("self-test: false positive");
	const duplicated = [...entries, entries[0]];
	if (collectDirectives(duplicated).length !== 2) throw new Error("self-test: duplicate directives must be counted, not collapsed");
	if (SCENARIOS.filter((s) => s.expectDirective).length !== 2) throw new Error("self-test: expected two positive scenarios");
	const noticeEntry = {
		type: "custom_message",
		customType: NOTICE_TYPE,
		content: 'task(category: "architect")',
		display: true,
		details: { from: PRIMARY, to: FALLBACK },
	};
	if (collectNotices([noticeEntry, { type: "user" }]).length !== 1) throw new Error("self-test: notice entry not detected");
	if (findCustomPayload(noticeEntry, NOTICE_TYPE)?.display !== true) throw new Error("self-test: notice payload not read");
	const leakingUser = { type: "message", message: { role: "user", content: [{ type: "text", text: `hi\n${REMINDER_TAG}` }] } };
	if (userMessagesLeakingReminder([leakingUser]).length !== 1) throw new Error("self-test: reminder leak not detected");
	if (userMessagesLeakingReminder([{ type: "message", message: { role: "user", content: "clean" } }]).length !== 0) {
		throw new Error("self-test: reminder leak false positive");
	}
	const beforeDigests = { "auth.json": "a", "trust.json": "b", "settings.json": "c", "models.json": "d" };
	const liveChurn = changedFiles(beforeDigests, { ...beforeDigests, "settings.json": "x" });
	if (liveChurn.length !== 1 || liveChurn.every((name) => CREDENTIAL_FILES.includes(name))) {
		throw new Error("self-test: live-session churn must be detected as non-credential");
	}
	const credentialChange = changedFiles(beforeDigests, { ...beforeDigests, "auth.json": "x" });
	if (!credentialChange.some((name) => CREDENTIAL_FILES.includes(name))) {
		throw new Error("self-test: credential change must trip the isolation gate");
	}
	console.log(JSON.stringify({ selfTest: "PASS", scenarios: SCENARIOS.map((s) => s.name) }, null, 2));
}

function main() {
	if (process.argv.includes("--self-test")) return runSelfTest();

	const beforeDigests = fileDigests(realSenpiAgentDir);
	const senpiBin = process.env.SENPI_BIN?.trim() || "senpi";
	const resolved = findOnPath(senpiBin);
	if (resolved === null) {
		console.log(JSON.stringify({ result: "SKIP", reason: "senpi-binary-unavailable" }, null, 2));
		return;
	}

	const scenarios = SCENARIOS.map((scenario) => runScenario(resolved, scenario));
	const changed = changedFiles(beforeDigests, fileDigests(realSenpiAgentDir));
	const isolated = changed.every((name) => !CREDENTIAL_FILES.includes(name));
	const liveSessionActivity = changed.filter((name) => LIVE_SESSION_FILES.includes(name));
	const result = scenarios.every((s) => s.result === "PASS") && isolated ? "PASS" : "FAIL";

	console.log(JSON.stringify({ result, isolatedRealAgentDir: isolated, liveSessionActivity, scenarios }, null, 2));
	if (result !== "PASS") process.exitCode = 1;
}

main();
