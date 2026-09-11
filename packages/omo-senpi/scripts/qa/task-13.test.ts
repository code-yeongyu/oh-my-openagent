// allow: SIZE_OK - this existing task-13 executable-contract suite keeps its shared dynamic-import harness local.
declare const process: {
	cwd(): string;
	env: Record<string, string | undefined>;
	execPath: string;
	platform: string;
};

import registerMockProvider, {
	createLocalAssistantMessageEventStream,
	stepToAssistantMessage,
} from "./mock-provider/index.ts";

interface Matcher {
	not: Matcher;
	toBe(expected: unknown): void;
	toContain(expected: unknown): void;
	toContainEqual(expected: unknown): void;
	toMatch(expected: RegExp): void;
}

declare function describe(name: string, fn: () => void): void;
declare function expect(value: unknown): Matcher;
declare namespace expect {
	function objectContaining(value: Record<string, unknown>): unknown;
}
declare function test(name: string, fn: () => void | Promise<void>): void;

interface ChildProcessModule {
	spawnSync(
		command: string,
		args: string[],
		options: {
			cwd?: string;
			encoding?: string;
			env?: Record<string, string | undefined>;
			timeout?: number;
		},
	): { status: number | null; stdout: string; stderr: string };
}

interface FsModule {
	mkdtempSync(prefix: string): string;
	readFileSync(path: string, encoding: "utf8"): string;
	rmSync(
		path: string,
		options?: { force?: boolean; recursive?: boolean },
	): void;
	writeFileSync(path: string, data: string): void;
}

interface OsModule {
	tmpdir(): string;
}

interface PathModule {
	join(...paths: string[]): string;
}

const loadModule = new Function("specifier", "return import(specifier)") as <T>(
	specifier: string,
) => Promise<T>;
const { mkdtempSync, readFileSync, rmSync, writeFileSync } =
	await loadModule<FsModule>("node:fs");
const { tmpdir } = await loadModule<OsModule>("node:os");
const { join } = await loadModule<PathModule>("node:path");
const { spawnSync } =
	await loadModule<ChildProcessModule>("node:child_process");

const repoRoot = process.cwd();
const driveScript = join(
	repoRoot,
	"packages",
	"omo-senpi",
	"scripts",
	"qa",
	"drive.mjs",
);
const isolationScript = join(
	repoRoot,
	"packages",
	"omo-senpi",
	"scripts",
	"qa",
	"isolation-state.mjs",
);
const { snapshotDirectory, changedSnapshotPaths, directoryIdentityAvailable } =
	await loadModule<{
		directoryIdentityAvailable(): boolean;
		snapshotDirectory(root: string): {
			snapshot: Map<string, string>;
			complete: boolean;
		};
		changedSnapshotPaths(
			before: Map<string, string>,
			after: Map<string, string>,
		): string[];
	}>(isolationScript);
const probeScript = join(
	repoRoot,
	"packages",
	"omo-senpi",
	"scripts",
	"qa",
	"probe-continuation.mjs",
);
const mockProviderScript = join(
	repoRoot,
	"packages",
	"omo-senpi",
	"scripts",
	"qa",
	"mock-provider",
	"index.ts",
);

interface CapturedProvider {
	streamSimple(
		model: unknown,
		context: { cwd?: string },
		options?: { signal?: AbortSignal },
	): AsyncIterable<unknown> & {
		result?: () => Promise<{
			stopReason?: string;
			content?: Array<{ type?: string }>;
		}>;
	};
}

function runNode(args: string[], env: Record<string, string | undefined> = {}) {
	return spawnSync(process.execPath, args, {
		cwd: repoRoot,
		env: { ...process.env, ...env },
		encoding: "utf8",
		timeout: 30_000,
	});
}

function isolatedHomeEnv(home: string) {
	return { HOME: home, USERPROFILE: home };
}

function parseLastJsonLine(stdout: string): Record<string, unknown> {
	const line = stdout
		.trim()
		.split(/\r?\n/)
		.reverse()
		.find((candidate) => candidate.trim().startsWith("{"));

	if (line === undefined) {
		throw new Error(`missing final JSON line in stdout:\n${stdout}`);
	}

	return JSON.parse(line);
}

const fdIt = test.skipIf(process.platform !== "linux");

describe("task 13 senpi QA scripts", () => {
	test("#given QA scripts resolve PATH binaries #when source is inspected #then they do not shell out through command lookup", () => {
		for (const script of [driveScript, probeScript]) {
			const source = readFileSync(script, "utf8");

			expect(source).not.toContain("shell: true");
			expect(source).not.toContain('spawnSync("command"');
		}
	});

	test("#given drive.mjs self-test #when executed #then sandbox helpers validate successfully", () => {
		const result = runNode([driveScript, "--self-test"]);

		expect(result.stderr).toBe("");
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("SELF-TEST OK");
	});

	fdIt(
		"#given settings.json changes only its interactive stamps #when the complete-tree snapshot is compared #then the home is untouched",
		() => {
			const root = mkdtempSync(join(tmpdir(), "omo-senpi-settings-snapshot-"));
			const settings = join(root, "settings.json");
			try {
				writeFileSync(
					settings,
					JSON.stringify({
						theme: "dark",
						tipsHistory: { first: 1 },
						lastChangelogVersion: "1.0.0",
						modelLastOnThinkingLevels: { model: "low" },
					}),
				);
				const before = snapshotDirectory(root);
				writeFileSync(
					settings,
					JSON.stringify({
						theme: "dark",
						tipsHistory: { second: 2 },
						lastChangelogVersion: "2.0.0",
						modelLastOnThinkingLevels: { model: "high" },
					}),
				);
				const after = snapshotDirectory(root);

				expect(changedSnapshotPaths(before.snapshot, after.snapshot)).toEqual(
					[],
				);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		},
	);

	test("#given probe-continuation self-test #when executed #then continuation helpers validate successfully", () => {
		const result = runNode([probeScript, "--self-test"]);

		expect(result.stderr).toBe("");
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("SELF-TEST OK");
	});

	test("#given fake omo status #when continuation probe is inspected #then it uses the current ulw-loop JSON shape", () => {
		const source = readFileSync(probeScript, "utf8");

		expect(source).not.toContain('\\"active\\":true');
		expect(source).not.toContain('"active":true');
		expect(source).toContain('"ok":true');
		expect(source).toContain('"plan"');
		expect(source).toContain('"summary"');
	});

	test("#given print mode exits before follow-up #when tmux fallback is inspected #then it drives interactive Senpi", () => {
		const source = readFileSync(probeScript, "utf8");
		const tmuxFallbackSource = source.slice(source.indexOf('"new-session"'));

		expect(tmuxFallbackSource).not.toContain('"-p"');
	});

	test("#given continuation probe runs Senpi #when source is inspected #then it forces a sandbox session directory", () => {
		const source = readFileSync(probeScript, "utf8");

		expect(source).toContain("SENPI_CODING_AGENT_SESSION_DIR");
	});

	test("#given mock provider self-test #when executed #then text and tool-call script steps validate", () => {
		const result = runNode([mockProviderScript, "--self-test"]);

		expect(result.stderr).toBe("");
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("SELF-TEST OK");
	});

	test("#given a scripted tool call #when converted to an assistant message #then it stops with toolUse", () => {
		const message = stepToAssistantMessage(
			{ type: "tool_call", name: "write", arguments: { path: "x.ts" } },
			7,
		);

		expect(message.stopReason).toBe("toolUse");
	});

	test("#given terminal stream events #when result is awaited #then done and error events settle the promise", async () => {
		const toolMessage = stepToAssistantMessage(
			{ type: "tool_call", name: "write", arguments: { path: "x.ts" } },
			1,
		);
		const doneStream = createLocalAssistantMessageEventStream();

		doneStream.push({
			type: "done",
			reason: toolMessage.stopReason,
			message: toolMessage,
		});
		const doneResult = await expectSettles(doneStream.result());

		expect(doneResult.stopReason).toBe("toolUse");

		const errorMessage = { ...toolMessage, stopReason: "aborted" as const };
		const errorStream = createLocalAssistantMessageEventStream();

		errorStream.push({ type: "error", reason: "aborted", error: errorMessage });
		const errorResult = await expectSettles(errorStream.result());

		expect(errorResult.stopReason).toBe("aborted");
	});

	test("#given a tool-use mock script #when streamSimple runs #then it returns a Senpi-compatible result", async () => {
		let capturedProvider: CapturedProvider | undefined;
		const fakePi: Parameters<typeof registerMockProvider>[0] = {
			registerProvider(_id: string, provider: CapturedProvider) {
				capturedProvider = provider;
			},
		};
		const cwd = mkdtempSync(join(tmpdir(), "omo-senpi-mock-provider-"));

		try {
			writeFileSync(
				join(cwd, "mock-script.json"),
				JSON.stringify({
					steps: [
						{
							type: "tool_call",
							name: "write",
							arguments: { path: "x.ts", content: "const x = 1\n" },
						},
					],
				}),
			);
			registerMockProvider(fakePi);
			if (capturedProvider === undefined)
				throw new Error("mock provider was not registered");

			const stream = capturedProvider.streamSimple({ id: "mock-1" }, { cwd });
			expect(typeof stream.result).toBe("function");

			const events = [];
			for await (const event of stream) events.push(event);
			const message = await stream.result?.();

			expect(message?.stopReason).toBe("toolUse");
			expect(message?.content?.[0]?.type).toBe("toolCall");
			expect(events).toContainEqual(
				expect.objectContaining({ type: "done", reason: "toolUse" }),
			);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	test("#given caller SENPI_CODING_AGENT_DIR #when drive.mjs runs #then it self-creates an isolated sandbox", () => {
		const callerAgentDir = mkdtempSync(
			join(tmpdir(), "omo-senpi-caller-agent-"),
		);
		const callerHome = mkdtempSync(join(tmpdir(), "omo-senpi-caller-home-"));

		try {
			const result = runNode([driveScript], {
				...isolatedHomeEnv(callerHome),
				SENPI_CODING_AGENT_DIR: callerAgentDir,
				SENPI_BIN: "/nonexistent/senpi",
			});

			expect(result.status).toBe(0);
			const payload = parseLastJsonLine(result.stdout);
			expect(payload.providedSenpiCodingAgentDir).toBe("IGNORED");
			expect(payload.sandboxAgentDir).not.toBe(callerAgentDir);
			expect(String(payload.sandboxAgentDir)).toContain("omo-senpi-qa-");
			expect(payload.isolationCertified).toBe(false);
			const directoryIdentity = directoryIdentityAvailable();
			expect(payload.realHomeIsolationCertified).toBe(directoryIdentity);
			expect(payload.certificationEnvironmentObserved).toBe(false);
			expect(payload.certificationRootsComplete).toBe(directoryIdentity);
			expect(payload.certificationRootsTruncated).toBe(false);
			expect(payload.certificationChangedPaths).toEqual([]);
			expect(
				payload.certificationErrors.map(
					(error: { code: string }) => error.code,
				),
			).toEqual(
				directoryIdentity
					? []
					: Array(8).fill("DIRECTORY_IDENTITY_UNAVAILABLE"),
			);
			expect(payload.certificationLimits).toEqual({
				maxFiles: 10_000,
				maxBytes: 67_108_864,
				maxEntries: 20_000,
			});
			expect(payload.realSenpiUntouched).toBe(directoryIdentity);
			expect(payload.realSenpiChangedPaths).toEqual([]);
			expect(payload.realSenpiProtectedStateComplete).toBe(
				process.platform !== "win32",
			);
			expect(
				payload.realSenpiProtectedErrors.map(
					(error: { code: string }) => error.code,
				),
			).toEqual(
				process.platform === "win32"
					? Array(12).fill("NO_FOLLOW_UNAVAILABLE")
					: [],
			);
			expect(payload.realOmoUntouched).toBe(directoryIdentity);
			expect(payload.realOmoChangedPaths).toEqual([]);
			expect(payload.realOmoProtectedStateComplete).toBe(
				process.platform !== "win32",
			);
			expect(
				payload.realOmoProtectedErrors.map(
					(error: { code: string }) => error.code,
				),
			).toEqual(
				process.platform === "win32"
					? Array(12).fill("NO_FOLLOW_UNAVAILABLE")
					: [],
			);
			expect(payload.realSenpiObservedChangedPaths).toEqual([]);
			expect(payload.realOmoObservedChangedPaths).toEqual([]);
			expect(payload.realSenpiObservationDomain).toBe("nonvolatile-home");
			expect(payload.realSenpiNonvolatileObservationComplete).toBe(
				directoryIdentity,
			);
			expect(payload.realSenpiNonvolatileObservationTruncated).toBe(false);
			expect(
				payload.realSenpiNonvolatileObservationErrors.map(
					(error: { code: string }) => error.code,
				),
			).toEqual(
				directoryIdentity
					? []
					: Array(2).fill("DIRECTORY_IDENTITY_UNAVAILABLE"),
			);
			expect(typeof payload.realSenpiNonvolatileObservationBytesRead).toBe(
				"number",
			);
			expect(payload.realOmoObservationDomain).toBe("nonvolatile-home");
			expect(payload.realOmoNonvolatileObservationComplete).toBe(
				directoryIdentity,
			);
			expect(payload.realOmoNonvolatileObservationTruncated).toBe(false);
			expect(
				payload.realOmoNonvolatileObservationErrors.map(
					(error: { code: string }) => error.code,
				),
			).toEqual(
				directoryIdentity
					? []
					: Array(2).fill("DIRECTORY_IDENTITY_UNAVAILABLE"),
			);
			expect(typeof payload.realOmoNonvolatileObservationBytesRead).toBe(
				"number",
			);
			expect(payload.protectedStateFiles).toEqual([
				"auth.json",
				"settings.json",
				"models.json",
				"models-store.json",
				"trust.json",
				"hooks-state.json",
			]);
			expect(payload.observationLimits).toEqual({
				maxFiles: 10_000,
				maxBytes: 67_108_864,
				maxEntries: 20_000,
			});
			expect(payload.realHomesChecked).toEqual([
				join(callerHome, ".senpi", "agent"),
				join(callerHome, ".omo", "agent"),
			]);
			expect(String(payload.result)).toMatch(/^(SKIP|FAIL)$/);
		} finally {
			rmSync(callerAgentDir, { recursive: true, force: true });
			rmSync(callerHome, { recursive: true, force: true });
		}
	});

	test("#given an isolated child home #when cross-platform variables are built #then HOME and USERPROFILE match", () => {
		const home = join(tmpdir(), "omo-senpi-cross-platform-home");
		expect(isolatedHomeEnv(home)).toEqual({ HOME: home, USERPROFILE: home });
	});
});

async function expectSettles<T>(promise: Promise<T>): Promise<T> {
	const timeout = new Promise<never>((_resolve, reject) => {
		setTimeout(
			() =>
				reject(new Error("stream result() did not settle from terminal event")),
			50,
		);
	});
	return Promise.race([promise, timeout]);
}
