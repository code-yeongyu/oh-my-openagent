import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";
import { EngineProcess, isMessage, type Message, REPO_ROOT, TEST_TIMEOUT_MS } from "./support/engine";

// Replays the conformance corpus (`senpi-desktop-core/fixtures/conformance`) against the located engine binary,
// exactly as the Rust twin `crates/senpi-desktop-engine/tests/conformance_replay.rs` does: each step's messages
// deep-equal the expected ones modulo the declared `variable` JSON pointers (present, any value), in any order
// within the step, and nothing is left over after the last step. Both report `<case>: steps/<i>/expect/<j>`.
// `SENPI_DESKTOP_CONFORMANCE_DIR` replays another corpus directory.

const CORPUS =
	process.env.SENPI_DESKTOP_CONFORMANCE_DIR ??
	path.join(REPO_ROOT, "crates", "senpi-desktop-core", "fixtures", "conformance");

interface Expected {
	readonly message: Message;
	readonly variable: readonly string[];
}

interface Step {
	readonly send: Message;
	readonly expect: readonly Expected[];
}

interface Case {
	readonly name: string;
	readonly scenario: string;
	readonly env: Readonly<Record<string, string>>;
	readonly steps: readonly Step[];
}

function field<T>(value: Message, key: string, guard: (member: unknown) => member is T, fallback?: T): T {
	const member = value[key] ?? fallback;
	if (!guard(member)) throw new Error(`conformance fixture member ${key} is malformed: ${JSON.stringify(value)}`);
	return member;
}

const isString = (value: unknown): value is string => typeof value === "string";
const isArray = (value: unknown): value is readonly unknown[] => Array.isArray(value);
const isStringRecord = (value: unknown): value is Readonly<Record<string, string>> =>
	isMessage(value) && Object.values(value).every(isString);
const isStringArray = (value: unknown): value is readonly string[] => isArray(value) && value.every(isString);

function parseCase(file: string): Case {
	const parsed: unknown = JSON.parse(readFileSync(path.join(CORPUS, file), "utf8"));
	if (!isMessage(parsed)) throw new Error(`${file} is not a JSON object`);
	const steps = field(parsed, "steps", isArray).map((step): Step => {
		if (!isMessage(step)) throw new Error(`${file}: a step is not an object`);
		const expected = field(step, "expect", isArray).map((slot): Expected => {
			if (!isMessage(slot)) throw new Error(`${file}: an expectation is not an object`);
			return { message: field(slot, "message", isMessage), variable: field(slot, "variable", isStringArray, []) };
		});
		return { send: field(step, "send", isMessage), expect: expected };
	});
	return {
		name: path.basename(file, ".json"),
		scenario: field(parsed, "scenario", isString),
		env: field(parsed, "env", isStringRecord, {}),
		steps,
	};
}

/** `message` with every `variable` member nulled; `undefined` when one is absent. */
function masked(message: Message, variable: readonly string[]): unknown {
	const copy: unknown = structuredClone(message);
	for (const pointer of variable) {
		const keys = pointer
			.split("/")
			.slice(1)
			.map((key) => key.replaceAll("~1", "/").replaceAll("~0", "~"));
		const last = keys.pop();
		let parent: unknown = copy;
		for (const key of keys) parent = isMessage(parent) || isArray(parent) ? Reflect.get(parent, key) : undefined;
		if (last === undefined || !(isMessage(parent) || isArray(parent)) || !(last in parent)) return undefined;
		Reflect.set(parent, last, null);
	}
	return copy;
}

function matches(expected: Expected, actual: Message): boolean {
	const actualMasked = masked(actual, expected.variable);
	return actualMasked !== undefined && isDeepStrictEqual(masked(expected.message, expected.variable), actualMasked);
}

/** Resolves the first mismatch as `<case>: steps/<i>/...`, or `null` when the engine replays the case exactly. */
async function replay(testCase: Case): Promise<string | null> {
	const scenario = path.join(REPO_ROOT, testCase.scenario);
	if (!existsSync(scenario)) return `${testCase.name}: scenario ${testCase.scenario} does not exist`;
	const engine = new EngineProcess({ SENPI_DESKTOP_BACKEND: `fake:${scenario}`, ...testCase.env });
	try {
		for (const [index, step] of testCase.steps.entries()) {
			engine.send(step.send);
			const actual: Message[] = [];
			while (actual.length < step.expect.length) actual.push(await engine.next());
			for (const [slot, expected] of step.expect.entries()) {
				const found = actual.findIndex((message) => matches(expected, message));
				if (found === -1) {
					return `${testCase.name}: steps/${index}/expect/${slot}: no message matched ${JSON.stringify(expected.message)}; got ${JSON.stringify(actual)}`;
				}
				actual.splice(found, 1);
			}
		}
		const trailing = await engine.drain();
		return trailing.length === 0
			? null
			: `${testCase.name}: unexpected trailing messages ${JSON.stringify(trailing)}`;
	} finally {
		engine.kill();
	}
}

const cases = readdirSync(CORPUS)
	.filter((file) => file.endsWith(".json"))
	.sort()
	.map(parseCase);

describe("conformance corpus replayed against the located engine binary", { timeout: TEST_TIMEOUT_MS }, () => {
	it("holds at least one case", () => {
		expect(cases.length).toBeGreaterThan(0);
	});

	it.concurrent.for(cases)("$name", async (testCase, { expect }) => {
		expect(await replay(testCase)).toBeNull();
	});
});
