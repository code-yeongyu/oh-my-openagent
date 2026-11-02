#!/usr/bin/env node
// allow: SIZE_OK - one live proof of the advisor component: the decisions server, the mock provider,
// two sandboxed senpi runs and their transcript assertions are one indivisible lifecycle.
//
// Live QA for the advisor component (#12112). A REAL `senpi` process runs the built omo plugin out of
// an isolated agent directory with a mock provider and a local `/v1/decisions` server, so the whole
// path is proven end to end: tool results -> gate POST -> advisor child -> steered hint.
//
//   positive  advisor.enabled true, min_calls 2, cooldown 0, max_per_session 1: the session runs a
//             failing bash tool four times. The decisions server must receive exactly one POST whose
//             bearer key came from the configured environment variable and whose `state` carries the
//             task prompt, the transcript must hold an `omo-advisor:gate` entry with `triggered: true`
//             and an `omo-advisor:advice` custom message containing the mock advisor's hint token, and
//             the mock provider must show exactly one request on the advisor model.
//   negative  the same script with advisor.enabled false: zero decisions requests, no advice entry.
//
// The decisions server runs in THIS process, so every senpi child is spawned asynchronously - a
// spawnSync child would block the event loop and the server could never answer its own gate POST.
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createSandbox, seedSandbox } from "./drive.mjs";
import { isolatedChildEnv } from "./sandbox-child-env.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const mockProvider = join(scriptDir, "advisor-mock-provider.ts");
const realSenpiAgentDir = join(homedir(), ".senpi", "agent");

const PROVIDER = "omo-mock";
const MAIN_MODEL = "mock-main";
const ADVISOR_MODEL = "mock-advisor";
const ADVISOR_MODEL_REF = `${PROVIDER}/${ADVISOR_MODEL}`;
const HINT_TOKEN = "ADVISOR-HINT-7731";
const TASK_TOKEN = "QA-ADVISOR-TASK-7731";
const KEY_ENV = "OMO_ADVISOR_QA_KEY";
const KEY_VALUE = "qa-dummy";

const GATE_ENTRY_TYPE = "omo-advisor:gate";
const ADVICE_TYPE = "omo-advisor:advice";
const SCRIPT_FILE = "advisor-mock-script.json";
const REQUEST_LOG = "advisor-mock-requests.jsonl";

const PROMPT = `${TASK_TOKEN} the fixture suite keeps failing; get it green`;
// Four failing tool results, then a text answer. `read` on a missing path is a REAL error result -
// this engine runs shell work through `eval`, so a `bash` call would fail as an unknown tool and
// never reach the tool_result hook. The per-response delay holds the turn open while the in-process
// advisor child loads its runtime and answers.
const MAIN_DELAY_MS = 1500;
const MAIN_STEPS = [
	{ type: "tool_call", name: "read", arguments: { path: "missing-fixture-1.txt" } },
	{ type: "tool_call", name: "read", arguments: { path: "missing-fixture-2.txt" } },
	{ type: "tool_call", name: "read", arguments: { path: "missing-fixture-3.txt" } },
	{ type: "tool_call", name: "read", arguments: { path: "missing-fixture-4.txt" } },
	{ type: "text", text: "QA-ADVISOR-SESSION-COMPLETE" },
];
const SCRUBBED_ENV = [
	"OMO_CODING_AGENT_DIR",
	"PI_CODING_AGENT_DIR",
	"SENPI_CODING_AGENT_DIR",
	"SENPI_PACKAGE_DIR",
	"OMO_PACKAGE_DIR",
	"PI_PACKAGE_DIR",
	"SENPI_BIN",
	"SENPI_SESSION_FILE",
	"PI_SESSION_FILE",
	KEY_ENV,
];
const CREDENTIAL_FILES = ["auth.json", "trust.json"];
const LIVE_SESSION_FILES = ["settings.json", "models.json"];

function parseArgs(argv) {
	const options = { evidenceDir: undefined, keepSandbox: false, selfTest: argv.includes("--self-test") };
	const read = (flag) => {
		const at = argv.indexOf(flag);
		return at === -1 ? undefined : argv[at + 1];
	};
	const evidence = read("--evidence-dir");
	if (evidence !== undefined) options.evidenceDir = resolve(evidence);
	options.keepSandbox = argv.includes("--keep-sandbox");
	return options;
}

function startDecisionsServer() {
	const requests = [];
	const server = createServer((request, response) => {
		let body = "";
		request.setEncoding("utf8");
		request.on("data", (chunk) => {
			body += chunk;
		});
		request.on("end", () => {
			requests.push({
				method: request.method,
				url: request.url,
				authorization: headerValue(request.headers, "authorization"),
				contentType: headerValue(request.headers, "content-type"),
				body,
			});
			response.writeHead(200, { "content-type": "application/json" });
			response.end(JSON.stringify({ answers: { stuck: { type: "noul", noul: 0.9 }, kind: { type: "choice", choice: "error_streak", confidence: 0.9 } }, usage: { input_tokens: 10 } }));
		});
	});
	const listening = new Promise((resolvePort, rejectPort) => {
		server.once("error", rejectPort);
		server.listen(0, "127.0.0.1", () => resolvePort(server.address().port));
	});
	return {
		requests,
		listen: () => listening,
		close: () =>
			new Promise((done) => {
				server.closeAllConnections?.();
				server.close(() => done());
			}),
	};
}

function headerValue(headers, name) {
	const value = headers?.[name];
	return typeof value === "string" ? value : Array.isArray(value) ? String(value[0]) : undefined;
}

function writeAdvisorConfig(cwd, port, enabled) {
	mkdirSync(join(cwd, ".omo"), { recursive: true });
	writeFileSync(
		join(cwd, ".omo", "omo.jsonc"),
		`${JSON.stringify(
			{
				advisor: {
					enabled,
					min_calls: 2,
					cooldown: 0,
					max_per_session: 1,
					window: 24,
					threshold: 0.6,
					timeout_seconds: 60,
					decision_url: `http://127.0.0.1:${port}/v1/decisions`,
					decision_model: "qa-decision-model",
					api_key_env: KEY_ENV,
					model: ADVISOR_MODEL_REF,
				},
			},
			null,
			2,
		)}\n`,
	);
	writeFileSync(join(cwd, SCRIPT_FILE), `${JSON.stringify({ main: { steps: MAIN_STEPS, delayMs: MAIN_DELAY_MS } }, null, 2)}\n`);
}

function scenarioEnv(sandbox) {
	const base = { ...process.env };
	for (const name of SCRUBBED_ENV) delete base[name];
	return {
		...isolatedChildEnv(base, sandbox.agentDir),
		SENPI_CODING_AGENT_DIR: sandbox.agentDir,
		OMO_MEMORY_HOME: join(sandbox.root, "memory"),
		HOME: sandbox.homeDir,
		USERPROFILE: sandbox.homeDir,
		XDG_CONFIG_HOME: sandbox.xdgConfigHome,
		XDG_DATA_HOME: sandbox.xdgDataHome,
		XDG_CACHE_HOME: sandbox.xdgCacheHome,
		SENPI_CODING_AGENT_SESSION_DIR: sandbox.sessionDir,
		OMO_SENPI_QA: "1",
		[KEY_ENV]: KEY_VALUE,
	};
}

function runSenpi(senpiBin, sandbox, timeoutMs = 180_000) {
	return new Promise((settle) => {
		const child = spawn(
			senpiBin,
			[
				"-e",
				mockProvider,
				"-p",
				"--provider",
				PROVIDER,
				"--model",
				MAIN_MODEL,
				"--session-dir",
				sandbox.sessionDir,
				PROMPT,
			],
			{ cwd: sandbox.cwd, env: scenarioEnv(sandbox), stdio: ["ignore", "pipe", "pipe"] },
		);
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGKILL");
		}, timeoutMs);
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("close", (status, signal) => {
			clearTimeout(timer);
			settle({ status, signal, timedOut, stdout, stderr });
		});
	});
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

/** Every object in an entry tree whose `customType` matches; senpi nests these differently per type. */
function findCustomObjects(value, customType, depth = 0) {
	if (depth > 6 || typeof value !== "object" || value === null) return [];
	const found = [];
	if (Reflect.get(value, "customType") === customType) found.push(value);
	for (const nested of Object.values(value)) found.push(...findCustomObjects(nested, customType, depth + 1));
	return found;
}

function flatContent(value) {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) return value.map((block) => (typeof block === "string" ? block : flatContent(block?.text ?? ""))).join("\n");
	return "";
}

function gateTriggered(entries) {
	return entries.some((entry) =>
		findCustomObjects(entry, GATE_ENTRY_TYPE).some(
			(found) =>
				Reflect.get(found, "triggered") === true ||
				Reflect.get(Reflect.get(found, "data") ?? {}, "triggered") === true,
		),
	);
}

function adviceContents(entries) {
	return entries.flatMap((entry) =>
		findCustomObjects(entry, ADVICE_TYPE).flatMap((found) => {
			const content = flatContent(Reflect.get(found, "content"));
			const data = Reflect.get(found, "data");
			const nested = typeof data === "object" && data !== null ? flatContent(Reflect.get(data, "content")) : "";
			const text = typeof found.text === "string" ? found.text : "";
			return [content, nested, text].filter((part) => part.length > 0);
		}),
	);
}

function readRequestLog(cwd) {
	const path = join(cwd, REQUEST_LOG);
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf8")
		.split("\n")
		.filter((line) => line.trim() !== "")
		.flatMap((line) => {
			try {
				return [JSON.parse(line)];
			} catch {
				return [];
			}
		});
}

function parseBodies(requests) {
	return requests.flatMap((request) => {
		try {
			const parsed = JSON.parse(request.body);
			return [typeof parsed === "object" && parsed !== null ? parsed : {}];
		} catch {
			return [{}];
		}
	});
}

async function runScenario(senpiBin, decisions, enabled) {
	const sandbox = createSandbox();
	sandbox.sessionDir = join(sandbox.agentDir, "sessions");
	seedSandbox(sandbox);
	mkdirSync(sandbox.sessionDir, { recursive: true });
	writeAdvisorConfig(sandbox.cwd, await decisions.port(), enabled);

	const from = decisions.requests.length;
	const run = await runSenpi(senpiBin, sandbox);
	const requests = decisions.requests.slice(from);
	const entries = readSessionEntries(sandbox.sessionDir);
	const providerLog = readRequestLog(sandbox.cwd);
	const bodies = parseBodies(requests);
	const advice = adviceContents(entries);
	return {
		sandbox,
		run,
		requests,
		bodies,
		entries,
		providerLog,
		advice,
		transcripts: readTranscripts(sandbox.sessionDir),
	};
}

function readTranscripts(sessionDir) {
	if (!existsSync(sessionDir)) return [];
	const files = [];
	const walk = (dir) => {
		for (const name of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, name.name);
			if (name.isDirectory()) walk(full);
			else if (name.name.endsWith(".jsonl")) files.push({ name: full.slice(sessionDir.length + 1), body: readFileSync(full, "utf8") });
		}
	};
	walk(sessionDir);
	return files;
}

function positiveChecks(result) {
	const bodies = result.bodies;
	const tasks = bodies.map((body) => (typeof body.state === "string" ? body.state : JSON.stringify(body.state ?? "")));
	const advisorRequests = result.providerLog.filter((line) => line.model === ADVISOR_MODEL);
	return {
		exitOk: { ok: result.run.status === 0, observed: { status: result.run.status, signal: result.run.signal, timedOut: result.run.timedOut } },
		decisionsRequested: { ok: result.requests.length >= 1, observed: result.requests.length },
		bearerKey: {
			ok: result.requests.length > 0 && result.requests.every((request) => request.authorization === `Bearer ${KEY_VALUE}`),
			observed: result.requests.map((request) => request.authorization ?? null),
		},
		stateCarriesTask: { ok: tasks.some((state) => state.includes(TASK_TOKEN)), observed: tasks.map((state) => state.slice(0, 200)) },
		noulQuestion: {
			ok: bodies.every((body) => body.questions?.stuck?.type === "noul" && body.questions?.kind?.type === "choice"),
			observed: bodies.map((body) => [body.questions?.stuck?.type ?? null, body.questions?.kind?.type ?? null]),
		},
		gateTriggered: { ok: gateTriggered(result.entries), observed: result.entries.filter((entry) => JSON.stringify(entry).includes(GATE_ENTRY_TYPE)).length },
		adviceDelivered: {
			ok: result.advice.some((content) => content.includes(HINT_TOKEN)),
			observed: result.advice.map((content) => content.slice(0, 200)),
		},
		advisorChildRanOnMock: { ok: advisorRequests.length === 1, observed: advisorRequests.length },
		mainModelRanMock: {
			ok: result.providerLog.filter((line) => line.model === MAIN_MODEL).length >= MAIN_STEPS.length,
			observed: result.providerLog.filter((line) => line.model === MAIN_MODEL).length,
		},
	};
}

function negativeChecks(result) {
	return {
		exitOk: { ok: result.run.status === 0, observed: { status: result.run.status, signal: result.run.signal, timedOut: result.run.timedOut } },
		noDecisionsRequest: { ok: result.requests.length === 0, observed: result.requests.length },
		noAdvice: { ok: result.advice.length === 0, observed: result.advice.length },
		noGateEntry: { ok: !gateTriggered(result.entries), observed: result.entries.length },
	};
}

function fileDigests(agentDir) {
	const digests = {};
	for (const name of [...CREDENTIAL_FILES, ...LIVE_SESSION_FILES]) {
		const path = join(agentDir, name);
		digests[name] = existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : "absent";
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

function writeEvidence(dir, payload, scenarios) {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "advisor-live.json"), `${JSON.stringify(payload, null, 2)}\n`);
	for (const [name, result] of Object.entries(scenarios)) {
		writeFileSync(join(dir, `${name}-decisions-requests.json`), `${JSON.stringify(result.requests, null, 2)}\n`);
		writeFileSync(join(dir, `${name}-provider-requests.jsonl`), result.providerLog.map((line) => JSON.stringify(line)).join("\n"));
		writeFileSync(join(dir, `${name}-stdout.log`), result.run.stdout);
		writeFileSync(join(dir, `${name}-stderr.log`), result.run.stderr);
		for (const transcript of result.transcripts) {
			const target = join(dir, `${name}-transcript-${transcript.name.replace(/[^\w.-]+/g, "_")}`);
			writeFileSync(target, transcript.body);
		}
	}
}

function allOk(checks) {
	return Object.values(checks).every((check) => check.ok === true);
}

// A recursive delete can land before a late writer recreates `agent/auth.json`, so removal is retried
// a bounded number of times and then VERIFIED: the caller reports what is still there instead of
// claiming a clean teardown it cannot see. The late writer is the omo task engine's shared RPC host,
// spawned under the sandbox agent dir, which outlives the `-p` parent - it is terminated first.
async function removeSandbox(root) {
	for (let attempt = 0; attempt < 5; attempt += 1) {
		rmSync(root, { recursive: true, force: true });
		if (!existsSync(root)) return true;
		await new Promise((done) => setTimeout(done, 300));
	}
	rmSync(root, { recursive: true, force: true });
	return !existsSync(root);
}

function isAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error?.code === "EPERM";
	}
}

function processesUnder(root) {
	try {
		return execFileSync("pgrep", ["-f", root], { encoding: "utf8" })
			.split("\n")
			.map((line) => Number.parseInt(line, 10))
			.filter((pid) => Number.isInteger(pid) && pid !== process.pid);
	} catch {
		return [];
	}
}

async function stopSandboxProcesses(root) {
	const pids = processesUnder(root);
	const alive = new Set(pids.filter(isAlive));
	for (const pid of alive) {
		try {
			process.kill(pid, "SIGTERM");
		} catch {
			alive.delete(pid);
		}
	}
	const deadline = Date.now() + 5000;
	while ([...alive].some(isAlive) && Date.now() < deadline) await new Promise((done) => setTimeout(done, 100));
	for (const pid of alive) {
		if (!isAlive(pid)) continue;
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			// already gone
		}
	}
	while ([...alive].some(isAlive) && Date.now() < deadline + 2000) await new Promise((done) => setTimeout(done, 100));
	return { pids, survivors: [...alive].filter(isAlive) };
}

function runSelfTest() {
	const gate = { type: "custom", customType: GATE_ENTRY_TYPE, data: { triggered: true, gate: { kind: "scored", probability: 0.9 } } };
	const flatGate = { type: "custom", customType: GATE_ENTRY_TYPE, triggered: true };
	const advice = { type: "custom_message", customType: ADVICE_TYPE, content: `[advisor] ${HINT_TOKEN} read the error`, display: false };
	if (!gateTriggered([gate])) throw new Error("self-test: nested gate entry not detected");
	if (!gateTriggered([flatGate])) throw new Error("self-test: flat gate entry not detected");
	if (gateTriggered([{ type: "custom", customType: GATE_ENTRY_TYPE, data: { triggered: false } }])) {
		throw new Error("self-test: an untriggered gate entry must not count");
	}
	if (!adviceContents([advice]).some((content) => content.includes(HINT_TOKEN))) throw new Error("self-test: advice content not read");
	if (adviceContents([{ type: "message", message: { role: "user", content: "clean" } }]).length !== 0) {
		throw new Error("self-test: advice false positive");
	}
	const nestedAdvice = { type: "message", message: { role: "user", content: [{ type: "text", text: "hi" }], customType: ADVICE_TYPE, data: { content: HINT_TOKEN } } };
	if (!adviceContents([nestedAdvice]).some((content) => content.includes(HINT_TOKEN))) throw new Error("self-test: nested advice content not read");
	if (headerValue({ authorization: "Bearer qa-dummy" }, "authorization") !== "Bearer qa-dummy") throw new Error("self-test: header read");
	if (headerValue({}, "authorization") !== undefined) throw new Error("self-test: absent header must be undefined");
	if (findOnPath("definitely-not-a-real-binary-7731") !== null) throw new Error("self-test: PATH lookup false positive");
	const digested = changedFiles({ "auth.json": "a", "settings.json": "c" }, { "auth.json": "a", "settings.json": "x" });
	if (digested.length !== 1 || digested[0] !== "settings.json") throw new Error("self-test: live-session churn classification");
	console.log(JSON.stringify({ selfTest: "PASS" }));
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.selfTest) return runSelfTest();

	const beforeDigests = fileDigests(realSenpiAgentDir);
	const senpiBin = findOnPath(process.env.SENPI_BIN?.trim() || "senpi");
	if (senpiBin === null) {
		console.log(JSON.stringify({ status: "SKIP", reason: "senpi-binary-unavailable", checks: {}, isolatedAgentDir: null, realSenpiUntouched: null }));
		return;
	}

	const decisions = startDecisionsServer();
	decisions.port = () => decisions.listen();
	await decisions.port();
	let positive;
	let negative;
	try {
		positive = await runScenario(senpiBin, decisions, true);
		negative = await runScenario(senpiBin, decisions, false);
	} finally {
		await decisions.close();
	}

	const changed = changedFiles(beforeDigests, fileDigests(realSenpiAgentDir));
	const realSenpiUntouched = changed.every((name) => !CREDENTIAL_FILES.includes(name));
	const positiveResult = positiveChecks(positive);
	const negativeResult = negativeChecks(negative);
	const checks = { ...positiveResult, negative: negativeResult };
	const status = allOk(positiveResult) && allOk(negativeResult) && realSenpiUntouched ? "PASS" : "FAIL";
	const payload = {
		status,
		checks,
		isolatedAgentDir: positive.sandbox.agentDir,
		realSenpiUntouched,
		senpiBin,
		mainModel: `${PROVIDER}/${MAIN_MODEL}`,
		advisorModel: ADVISOR_MODEL_REF,
		realSenpiChangedPaths: changed,
		liveSessionActivity: changed.filter((name) => LIVE_SESSION_FILES.includes(name)),
		positiveSandboxRoot: positive.sandbox.root,
		negativeSandboxRoot: negative.sandbox.root,
	};

	const cleanup = [];
	for (const result of [positive, negative]) {
		const stopped = await stopSandboxProcesses(result.sandbox.root);
		const removed = options.keepSandbox ? false : await removeSandbox(result.sandbox.root);
		cleanup.push({ root: result.sandbox.root, stoppedPids: stopped.pids, survivors: stopped.survivors, removed });
	}
	payload.sandboxCleanup = cleanup;
	payload.sandboxRootsRemaining = cleanup.filter((entry) => !entry.removed && !options.keepSandbox).map((entry) => entry.root);

	if (options.evidenceDir !== undefined) {
		writeEvidence(options.evidenceDir, payload, { positive, negative });
		payload.evidenceDir = options.evidenceDir;
	}
	console.log(JSON.stringify(payload));
	if (status !== "PASS") process.exitCode = 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main();
}
